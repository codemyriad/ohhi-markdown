/**
 * "A file changed under you" (settings-shaping ST6, the first door outside
 * Settings): when the layout or keymap IN USE is read again — the desktop
 * watcher saw its file change, or *Reload files* / `app.reload-resources` ran
 * — and what it resolves to differs, the app says so once: a logged `info`
 * notice (`resource_reloaded`, so the Log's *Customise* chip keeps it) and
 * one toast with *Show* (Settings › Customise) and, only when it can be
 * honest, *Undo*:
 *
 *  - a **layout**: the app never writes layout files, so Undo puts back the
 *    spec it was showing, for this session; the file is untouched and says so
 *    (`shell-layout.svelte.ts` holds it until the file changes again, a pick,
 *    a vault switch or a reload);
 *  - a **keymap** in this vault that the app may write: Undo writes the bytes
 *    it had read back through the journal (`Keymap.restore`), as Settings ›
 *    Keys' own Undo does. Not offered for a file it cannot write (the config
 *    folder, a vault file named like a built-in) or a file that is new.
 *
 * Not announced: a vault opening (`open`), a different choice (a pick is not
 * a reload), the app's own writes, and a file that can no longer be used —
 * that is the fallback notice's (`layout_invalid` / `keymap_invalid`, a
 * warning that toasts with *Show problems*), so nothing is said twice.
 *
 * Pure decisions plus one announcer over an explicit host.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import type { EventParam } from '@ohhi/workspace'
import type { NoticeInput } from './notices.js'
import type { ResourceChange, ResourceEntry, RootId } from './resources.svelte.js'
import type { ToastData } from './ui/toaster.js'

export type ReloadKind = 'layouts' | 'keymaps'

/** One side of a reload: what was in force, as far as a notice cares. */
export interface ReloadSide {
  /** The device's choice (`default`, `custom:focus`). */
  choice: string
  entry: ResourceEntry | null
  error: string | null
  /** What it resolves to, as one comparable string (the spec or the bindings, serialised). */
  content: string
}

/** A file in use that was read again and now says something else. */
export interface ReloadedFile {
  kind: ReloadKind
  name: string
  /** The file's basename (`focus.json`); the name for a built-in. */
  file: string
  root: RootId
}

/** Whether a reload is worth saying, and what: null when it is not (see the module doc). */
export function reloadedFile(
  kind: ReloadKind,
  before: ReloadSide | null,
  after: ReloadSide,
  why: ResourceChange | undefined
): ReloadedFile | null {
  if (why !== 'change' && why !== 'reload') return null
  if (!before || before.choice !== after.choice) return null
  if (after.error !== null || after.entry === null) return null
  if (before.content === after.content) return null
  const { name, root, path } = after.entry
  return { kind, name, root, file: root === 'builtin' ? name : path.slice(path.lastIndexOf('/') + 1) }
}

/** The logged notice's params (`resource_reloaded`). */
export function reloadParams(f: ReloadedFile): Record<string, EventParam> {
  return { kind: f.kind, name: f.name, file: f.file, root: f.root }
}

/** The notice's words, from its params — the toast and the Log row say the same. */
export function reloadText(LL: TranslationFunctions, p: Record<string, EventParam> | undefined): string {
  const t = LL.web.resources
  const kind = String(p?.kind ?? '') === 'keymaps' ? t.kind.keymaps() : t.kind.layouts()
  const root = String(p?.root ?? '')
  if (root === 'vault' || root === 'user') {
    return t.reloaded({ kind, file: String(p?.file ?? ''), root: t.root[root]() })
  }
  return t.reloaded_builtin({ kind, name: String(p?.name ?? '') })
}

export interface ReloadAnnouncer {
  /** Log it (`workspace.notify`); absent between vaults. */
  notify?(input: NoticeInput): void
  toast(data: ToastData): void
  /** Settings at a section (*Show*); absent → no *Show*. */
  openSettings?(section: string): void
}

/**
 * Say it: log the notice, then one toast with *Undo* (when given) and
 * *Show*. `undo` resolves to the sentence saying what it did; it runs once.
 */
export function announceReload(
  host: ReloadAnnouncer,
  f: ReloadedFile,
  undo: (() => Promise<string>) | null,
  LL: TranslationFunctions = getLL()
): void {
  const params = reloadParams(f)
  host.notify?.({ level: 'info', code: 'resource_reloaded', params })
  const t = LL.web.resources
  const show = host.openSettings
    ? { label: t.show(), run: () => host.openSettings?.(f.kind === 'keymaps' ? 'keys' : 'customise') }
    : undefined
  let undone = false
  const undoAction = undo
    ? {
        label: t.undo(),
        run: () => {
          if (undone) return
          undone = true
          undo().then(
            (text) => host.toast({ level: 'info', title: text }),
            (err: unknown) =>
              host.toast({
                level: 'error',
                title: t.undo_failed({ error: err instanceof Error ? err.message : String(err) }),
              })
          )
        },
      }
    : undefined
  host.toast({
    level: 'info',
    title: reloadText(LL, params),
    ...(undoAction ? { description: f.kind === 'keymaps' ? t.undo_keymap_hint() : t.undo_layout_hint() } : {}),
    ...(undoAction ? { action: undoAction, ...(show ? { secondary: show } : {}) } : show ? { action: show } : {}),
  })
}
