/**
 * The Read slice in the shell (read-shaping.md X2/X4): how a tab is read, and
 * the two services a rendered note needs that neither CM6 nor the vault can
 * give it on their own — where an embedded attachment's bytes live, and the
 * way out to a browser.
 *
 * Everything here is pure except `readState`, which is the device preference
 * mirrored reactively so that a tab which was never given a mode of its own
 * follows Settings the moment Settings changes (`Tab.mode` is deliberately
 * absent on such a tab — see `panes.ts`). The pattern is `theme.svelte.ts`'s:
 * one module owns the preference, Settings writes through it, and nothing
 * else reads config for it.
 */
import type { ReadLabels } from '@ohhi/editor-lang'
import { getLL } from '@ohhi/i18n'
import type { Command } from './commands.js'
import { readPrefs, setReadPrefs } from './config.js'
import { VIEW_MODES, type ViewMode } from './panes.js'

/**
 * The mode a tab with no mode of its own is read in. Seeded at import — this
 * is device config, so there is nothing vault-shaped to wait for — and only
 * ever written by `setDefaultMode`.
 */
export const readState = $state<{ defaultMode: ViewMode }>({
  defaultMode: readPrefs().defaultMode,
})

export function setDefaultMode(mode: ViewMode): void {
  readState.defaultMode = mode
  setReadPrefs({ defaultMode: mode })
}

// ---- the mode rules (Fork 2-A) ----

/**
 * `Mod+E` is Obsidian's pair, not a three-way cycle: editing ↔ Reading, where
 * "editing" is whichever of Live/Source this tab last had. A tab that has only
 * ever been read lands in Live, because that is what 36 of 36 measured leaves
 * are.
 */
export function afterToggleReading(current: ViewMode, lastEditing?: ViewMode): ViewMode {
  if (current !== 'reading') return 'reading'
  return lastEditing && lastEditing !== 'reading' ? lastEditing : 'live'
}

/** The exception a command reaches (0 Source leaves in the vault): Live ↔ Source. */
export function afterToggleSource(current: ViewMode): ViewMode {
  return current === 'source' ? 'live' : 'source'
}

// ---- the command table ----

/** Everything the shell must be able to do for a `view.*` command to exist. */
export interface ReadActions {
  /** False on an empty tab: there is nothing to change the view of. */
  hasNote(): boolean
  /** The focused tab's mode right now — what `edit.toggle-checkbox` is gated on. */
  mode(): ViewMode
  setMode(mode: ViewMode): void
  toggleReading(): void
  toggleSource(): void
  /** `toggleTask` in the focused pane's view; a no-op when no line qualifies. */
  toggleCheckbox(): void
}

export function readCommands(a: ReadActions): Command[] {
  const t = getLL().web.read
  const group = getLL().web.commands.groups.view()
  const hasNote = (): boolean => a.hasNote()
  return [
    {
      id: 'view.toggle-reading',
      title: t.commands.toggle_reading(),
      group,
      keys: 'Mod+e',
      when: hasNote,
      run: a.toggleReading,
    },
    // Unbound by decision (Fork 2-A): Source is the exception a command
    // reaches, not a step `Mod+E` has to walk through.
    {
      id: 'view.toggle-source',
      title: t.commands.toggle_source(),
      group,
      when: hasNote,
      run: a.toggleSource,
    },
    ...VIEW_MODES.map((mode) => ({
      id: `view.mode-${mode}`,
      title: t.commands.mode({ mode: t.modes[mode]() }),
      group,
      when: hasNote,
      run: () => a.setMode(mode),
    })),
    // Obsidian's own key for it. Reading has no commands (`EditorState.readOnly`
    // gates them), so the row is hidden there rather than silently doing
    // nothing — a click on the checkbox itself still works, which is R2.3.
    {
      id: 'edit.toggle-checkbox',
      title: t.commands.toggle_checkbox(),
      group,
      keys: 'Mod+l',
      when: () => a.hasNote() && a.mode() !== 'reading',
      run: a.toggleCheckbox,
    },
  ]
}

// ---- the host services (B2.2, B2.3, B5) ----

/**
 * The strings CM6's widgets print: decoration code has no `$LL`, so the copy
 * travels down with the rest of the host (the `ReadHost` contract). Read at
 * the point of use, so a locale switch reaches the next decoration build.
 */
export function readLabels(): ReadLabels {
  const t = getLL().web.read
  return {
    missingAttachment: t.missing_attachment(),
    task: t.task(),
    properties: (count) => t.properties({ count }),
    frontmatterUnsupported: t.frontmatter_unsupported(),
  }
}

/**
 * The vault-search query a click on a tag chip runs (`parseQuery` already
 * understands `tag:`). Tolerant of a leading `#` because the chip's DOM
 * carries the tag both ways depending on where it came from — the body or the
 * frontmatter strip — and `tag:##x` matches nothing at all.
 */
export function tagQuery(tag: string): string {
  return `tag:#${tag.replace(/^#+/, '')}`
}

/** The only schemes a note may send you to. A `file:`/`javascript:` link is text. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:'])

/**
 * Follow a bare URL or a `[text](url)` out of the editor.
 *
 * `window.open` everywhere, including under Tauri: `@tauri-apps/plugin-shell`
 * is not a dependency of this app and adding one is a lockfile change, so the
 * webview's own opener is the single path. The allow-list is the point —
 * anything a note can write is untrusted, and `javascript:` in a synced file
 * is script execution with the app's own origin.
 */
export function openExternal(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (!EXTERNAL_SCHEMES.has(parsed.protocol)) return
  if (typeof window === 'undefined') return
  window.open(parsed.href, '_blank', 'noopener')
}

/**
 * Where `![[name]]`'s bytes might be: beside the note first, then at the vault
 * root — Obsidian's own order for a link with no folder in it.
 *
 * Returns an EMPTY list for anything that is not a plain relative path inside
 * the vault. `../` out of the vault, an absolute path and a backslash path are
 * all refused here rather than at the adapter, because the adapter's job is to
 * read a path, not to decide whose path it is: the name comes out of a file
 * that a peer or an agent may have written.
 */
export function attachmentCandidates(name: string, fromPath?: string | null): string[] {
  // Obsidian writes size and alias after a pipe (`![[img.png|300]]`); a `|`
  // can never be part of a name we hold, so cutting there is always right.
  const rel = name.split('|')[0].split('#')[0].trim().replace(/^\.\//, '')
  if (!rel || rel.startsWith('/') || rel.includes('\\')) return []
  if (rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return []
  const cut = fromPath ? fromPath.lastIndexOf('/') : -1
  const dir = cut > 0 ? fromPath!.slice(0, cut) : ''
  const beside = dir ? `${dir}/${rel}` : rel
  return beside === rel ? [rel] : [beside, rel]
}

/**
 * The media type for a Blob built from an attachment's bytes. The adapter
 * reads bytes and knows nothing about them; `<img src>` needs the type, and a
 * wrong one shows a broken image rather than a picture.
 */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

export function attachmentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MEDIA_TYPES[ext] ?? ''
}
