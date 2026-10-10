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
  const a = getLL().web.attachments
  return {
    missingAttachment: t.missing_attachment(),
    task: t.task(),
    properties: (count) => t.properties({ count }),
    frontmatterUnsupported: t.frontmatter_unsupported(),
    remoteImage: {
      from: (host) => a.remote_from({ host }),
      load: a.remote_load(),
      failed: (host) => a.remote_failed({ host }),
      notLoaded: a.remote_not_loaded(),
    },
    copyCode: t.code_block.copy(),
    codeCopied: t.code_block.copied(),
    codeLanguage: (lang) => t.code_block.language({ lang }),
    codePlain: t.code_block.plain(),
    toggleCallout: (title) => t.callout.toggle({ title }),
    table: {
      toolbar: t.table_hint.toolbar(),
      nextCell: t.table_hint.next_cell(),
      nextRow: t.table_hint.next_row(),
      leave: t.table_hint.leave(),
      addRow: t.table_hint.add_row(),
      addColumn: t.table_hint.add_column(),
      align: t.table_hint.align(),
    },
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
 * Where `![[name]]`'s bytes might be, in the order to try them — Obsidian's
 * own resolution, vault-wide by name (editor-usability E5):
 *
 * 1. the name as a vault path (`Attachments/shot.png`);
 * 2. beside the note;
 * 3. any file whose path ends with the name, the SHORTEST path first (the
 *    vault root before a folder, a shallow folder before a deep one) — what
 *    makes `![[shot.png]]` find `Attachments/shot.png` with no folder in it;
 * 4. beside the note and the vault root again, unconditionally, for bytes the
 *    file list does not know (a file written by another app while we ran).
 *
 * `known` is the workspace's attachment paths (`kind: 'binary'` rows); names
 * match case-insensitively, as Obsidian's do, and come back spelled as the
 * file is. Without `known` only step 4 runs.
 *
 * Returns an EMPTY list for anything that is not a plain relative path inside
 * the vault. `../` out of the vault, an absolute path and a backslash path are
 * all refused here rather than at the adapter, because the adapter's job is to
 * read a path, not to decide whose path it is: the name comes out of a file
 * that a peer or an agent may have written.
 */
export function attachmentCandidates(
  name: string,
  fromPath?: string | null,
  known: readonly string[] = []
): string[] {
  // Obsidian writes size and alias after a pipe (`![[img.png|300]]`); a `|`
  // can never be part of a name we hold, so cutting there is always right.
  const rel = name.split('|')[0].split('#')[0].trim().replace(/^\.\//, '')
  if (!rel || rel.startsWith('/') || rel.includes('\\')) return []
  if (rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return []
  const cut = fromPath ? fromPath.lastIndexOf('/') : -1
  const dir = cut > 0 ? fromPath!.slice(0, cut) : ''
  const beside = dir ? `${dir}/${rel}` : rel
  const lower = rel.toLowerCase()
  const byLower = new Map<string, string>()
  for (const path of known) byLower.set(path.toLowerCase(), path)
  const exact = byLower.get(lower)
  const besideKnown = byLower.get(beside.toLowerCase())
  const suffix = known
    .filter((p) => p.toLowerCase().endsWith(`/${lower}`))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))
  const out: string[] = []
  for (const path of [exact, besideKnown, ...suffix, beside, rel]) {
    if (path && !out.includes(path)) out.push(path)
  }
  return out
}

/**
 * Where `![alt](src)`'s bytes might be. A markdown image's path is relative to
 * the NOTE (`../img/x.png` is ordinary), percent-encoded or in angle brackets
 * when it holds a space — so it is decoded and resolved against the note's
 * folder, and still refused when it climbs out of the vault. A path without a
 * folder walk resolves as a wikilink name does (Obsidian's "shortest path"
 * links are written both ways).
 *
 * Only local paths come here: a URL with a scheme is never read from disk.
 */
export function imageCandidates(
  src: string,
  fromPath?: string | null,
  known: readonly string[] = []
): string[] {
  let path = src.trim().replace(/^<(.*)>$/, '$1')
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return []
  try {
    path = decodeURI(path)
  } catch {
    // A stray `%` is a literal in a hand-written path; keep it as written.
  }
  path = path.split('?')[0]!.split('#')[0]!
  const segs = path.split('/')
  if (!segs.includes('..')) return attachmentCandidates(path, fromPath, known)
  if (path.startsWith('/') || path.includes('\\')) return []
  const cut = fromPath ? fromPath.lastIndexOf('/') : -1
  const out = cut > 0 ? fromPath!.slice(0, cut).split('/') : []
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return []
      out.pop()
    } else out.push(seg)
  }
  return out.length ? [out.join('/')] : []
}

/**
 * A remote image's bytes, fetched only because a person pressed *Load image*
 * (E5). No cookies and no referrer go with it, the scheme is http(s) only, and
 * the answer must say it is an image — anything else is null, which the
 * placeholder words as "didn't let this image load here". The fetch is the
 * app's `connect-src`, so the picture is drawn from a `blob:` and the content
 * policy needs no remote `img-src`. A host without CORS headers refuses it.
 */
export async function loadRemoteImage(url: string): Promise<Blob | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  try {
    const res = await fetch(parsed.href, { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.type.startsWith('image/') ? blob : null
  } catch {
    return null
  }
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
