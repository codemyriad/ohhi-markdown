/**
 * The shell, customised from files (quiet-shell F8–F11): the resource roots,
 * the keymap in force and the templates — the wiring that
 * used to be blocks in `App.svelte` (shell-structure: "a prop or a host
 * line, not a block").
 *
 * - `resources` reads `.ohhi/` → `~/.config/ohhi/` → built-in and owns the
 *   ONE `.ohhi/` change subscription; the keymap and the templates re-read
 *   on their kind's change (and on a vault switch, and on
 *   `app.reload-resources` → `reloadAll`). The layout subscribes the same
 *   way, from `createShellLayout`'s host.
 * - a file that cannot be used is a logged warning (`layout_invalid` /
 *   `keymap_invalid`); the keymap migration says what it wrote.
 * - the keymap in use, read again after its file changed (or on a reload)
 *   and now different, is announced once with an honest Undo
 *   (`resource-reload.ts`, settings-shaping ST6) — never for the app's own
 *   writes (Settings › Keys, the Undo itself).
 * - the keymap is applied to the registry first, then every live editor
 *   from it, so a `[]` unbinds the chord in CodeMirror too.
 *
 * A runes module built by a factory over an explicit host, so a test drives
 * it with a fake vault.
 */
import type { FormatBindings } from '@ohhi/editor'
import { getLL } from '@ohhi/i18n'
import type { CommandRegistry } from './commands.js'
import { clearHotkeys, hotkeys, keymapChoice, setKeymapChoice } from './config.js'
import { createKeymap, formatBindingsOf, type KeymapHost } from './keymap.svelte.js'
import { BUILTIN_KEYMAPS, type KeymapChoice } from './keymap-spec.js'
import type { FlashInput, NoticeInput } from './notices.js'
import { announceReload, reloadedFile, type ReloadedFile } from './resource-reload.js'
import { savableName } from './resource-kind.js'
import {
  createResources,
  type ResolvedKeymap,
  type ResourceChange,
  type ResourceEntry,
  type ResourceRoot,
  type VaultAppFiles,
} from './resources.svelte.js'
import { toast as showToast, type ToastData } from './ui/toaster.js'
import { createTemplates } from './templates.svelte.js'

/** The open vault, as far as customising goes: its app files and its notices. */
export interface CustomiseVault extends VaultAppFiles {
  notify(input: NoticeInput): void
  flash(input: FlashInput): void
}

export interface CustomiseHost {
  /** The open vault; null between vaults. Read reactively: a switch re-reads every kind. */
  workspace(): CustomiseVault | null
  /** The user root — desktop only; resolves to null in the browser. */
  userRoot(): Promise<ResourceRoot | null>
  /** The command registry the keymap is applied to. */
  registry: CommandRegistry
  /** Re-key every live editor (the `format.*` table and `edit.toggle-checkbox`). */
  setFormatBindings(bindings: FormatBindings): void
  /** Epoch ms — the injected clock (golden rule 5); templates render over it. */
  now(): number
  /** The focused note's path, or null (a template's `{{title}}`). */
  notePath(): string | null
  /** The vault's daily-note format (a template's `{{date}}`). */
  dateFormat(): string
  /** Insert at the focused editor's caret; false when no editable note holds the focus. */
  insertText(text: string): boolean
  /** The device's keymap choice and legacy `config.hotkeys`; absent → `config.ts`. */
  config?: Pick<KeymapHost, 'legacy' | 'clearLegacy' | 'choice' | 'setChoice'>
  /** The reload notice's toast (ST6); absent → the app's toaster. */
  toast?: (data: ToastData) => void
  /** Settings at a section — the reload notice's *Show*; absent → not offered. */
  openSettings?: (section: string) => void
}

export function createCustomise(host: CustomiseHost) {
  const resources = createResources({
    vault: () => host.workspace(),
    userRoot: () => host.userRoot(),
    warn: (name, error, kind) =>
      host.workspace()?.notify({
        level: 'warn',
        code: kind === 'keymaps' ? 'keymap_invalid' : 'layout_invalid',
        params: { name, error },
      }),
  })

  const config = host.config ?? {
    legacy: hotkeys,
    clearLegacy: clearHotkeys,
    choice: keymapChoice,
    setChoice: setKeymapChoice,
  }
  const keymap = createKeymap({
    resources,
    hasVault: () => host.workspace() !== null,
    ...config,
    apply: (bindings) => {
      host.registry.setKeymap(bindings)
      host.setFormatBindings(formatBindingsOf(host.registry))
    },
    migrated: (result) =>
      host.workspace()?.notify(
        'path' in result
          ? { level: 'info', code: 'keymap_migrated', params: { path: result.path } }
          : { level: 'warn', code: 'keymap_migrate_failed', params: { error: result.error } }
      ),
  })

  const templates = createTemplates({
    resources,
    now: () => host.now(),
    notePath: () => host.notePath(),
    dateFormat: () => host.dateFormat(),
    insertText: (text) => host.insertText(text),
    warn: (message) => host.workspace()?.notify({ level: 'warn', code: 'template_failed', params: { message } }),
  })

  const sideOf = (r: ResolvedKeymap, choice: string) => ({
    choice,
    entry: r.entry,
    error: r.error,
    content: JSON.stringify(r.bindings),
  })

  /** A file a reload names: its basename (`mine.json`), as `reloadedFile` names the active one. */
  const named = (entry: ResourceEntry): ReloadedFile => ({
    kind: 'keymaps',
    name: entry.name,
    root: entry.root,
    file: entry.root === 'builtin' ? entry.name : entry.path.slice(entry.path.lastIndexOf('/') + 1),
  })

  /**
   * Overlapping change events (the watcher can fire twice for one save, or a
   * reload lands mid-change) read once and say once: each re-read bumps the
   * generation, only the latest announces, and it compares against what was
   * in force before the FIRST of them (so nothing is lost, and nothing said
   * twice).
   */
  let reloads = 0
  let baseline: { choice: KeymapChoice; before: ResolvedKeymap | null; opened: boolean } | null = null

  /**
   * Re-read the keymap on its kind's change feed, then say so when the one
   * in use now says something else (ST6), naming the file that changed:
   *
   *  - the active file's own bytes changed → named, with an Undo that writes
   *    the bytes it had read back through the journal — only for a vault file
   *    the app may write, only when it is the same file, and only while the
   *    file still holds the bytes this reload read (`restoreKeymap`'s
   *    `expected`; anything newer refuses as stale);
   *  - only a keymap it `extends` changed → that parent is named, and there
   *    is no Undo (the active file is as it was; undoing it would do nothing);
   *  - the app's own write (Settings › Keys, an Undo) landing through the
   *    change feed → nothing.
   */
  async function reloadKeymap(why: ResourceChange): Promise<void> {
    const gen = ++reloads
    baseline ??= { choice: keymap.active, before: keymap.legacy ? null : keymap.resolved, opened: false }
    if (why === 'open') baseline.opened = true
    await keymap.reload()
    if (gen !== reloads) return
    const { choice, before, opened } = baseline
    baseline = null
    const after = keymap.resolved
    if (opened || !before || !after || keymap.legacy || after === before) return
    const changed = reloadedFile('keymaps', sideOf(before, choice), sideOf(after, keymap.active), why)
    if (!changed || !after.entry) return
    const entry = after.entry
    const sameFile = before.entry?.path === entry.path
    const announcer = {
      notify: (input: NoticeInput) => host.workspace()?.notify(input),
      toast: host.toast ?? showToast,
      ...(host.openSettings ? { openSettings: host.openSettings } : {}),
    }
    if (sameFile && before.text === after.text) {
      // The file in use is byte-for-byte what it was: a keymap it extends changed.
      const was = new Map((before.ancestors ?? []).map((a) => [a.entry.path, a.text]))
      const parent = (after.ancestors ?? []).find((a) => was.get(a.entry.path) !== a.text)
      if (parent && resources.isOwnWrite(parent.entry.path, parent.text)) return
      announceReload(announcer, parent ? named(parent.entry) : changed, null)
      return
    }
    // The app's own write (Keys, an Undo) landing through the change feed.
    if (resources.isOwnWrite(entry.path, after.text)) return
    const text = before.text
    const current = after.text
    const writable =
      entry.root === 'vault' &&
      sameFile &&
      text !== undefined &&
      current !== undefined &&
      savableName(entry.name, BUILTIN_KEYMAPS)
    announceReload(
      announcer,
      changed,
      writable
        ? async () => {
            // The choice moves back only if it is still the one this reload saw.
            await keymap.restore(entry.name, text, keymap.active === choice ? choice : null, current)
            return getLL().web.resources.undone_keymap({ file: changed.file })
          }
        : null
    )
  }

  resources.onChange('keymaps', (why) => void reloadKeymap(why))
  resources.onChange('templates', () => void templates.reload())

  return {
    resources,
    keymap,
    templates,
    /** `app.reload-resources` (quiet-shell F9): every kind re-reads; the layout re-seeds its columns. */
    reloadAll: (): void => resources.reloadAll(),
  }
}

export type Customise = ReturnType<typeof createCustomise>
