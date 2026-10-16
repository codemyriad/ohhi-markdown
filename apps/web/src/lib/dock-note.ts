/**
 * Which note the dock follows (QA feedback round 1: "the right sidebar needs
 * a little more context about the note in focus it's referring to").
 *
 * The focused pane's active note — the tab `ui.selectedPath` names — and,
 * while the focus is on something that is not a note (a session, a
 * collection, Settings, an empty tab), the note focused last, flagged
 * `lastFocused` so the dock can say so. One value, `ui.dockNote`, which every
 * dock body (Links, History, Comments) and the dock's context line read, so
 * the line naming the note can never disagree with the sections under it.
 */

/** The note the dock is about; `lastFocused` when the focus has since moved off it to a non-note. */
export interface DockNote {
  path: string
  lastFocused: boolean
}

/**
 * The next `ui.dockNote`: the focused note when the focused tab shows one;
 * else the previous note, kept as last focused while it still `exists`; else
 * none. Returns `prev` itself when nothing changed, so a writer can skip the
 * assignment and a reactive reader sees no news.
 */
export function followNote(
  prev: DockNote | null,
  focusedPath: string | null,
  exists: (path: string) => boolean
): DockNote | null {
  if (focusedPath) {
    return prev && prev.path === focusedPath && !prev.lastFocused ? prev : { path: focusedPath, lastFocused: false }
  }
  if (!prev || !exists(prev.path)) return null
  return prev.lastFocused ? prev : { path: prev.path, lastFocused: true }
}

/** The note after `from` was renamed (or moved) to `to` — `from` itself, or a folder holding it. */
export function renamedNote(note: DockNote | null, from: string, to: string): DockNote | null {
  if (!note) return note
  if (note.path === from) return { ...note, path: to }
  if (note.path.startsWith(`${from}/`)) return { ...note, path: `${to}${note.path.slice(from.length)}` }
  return note
}

/** How the context line names a note: its name (no `.md` / `.base`) and its folder ('' at the vault root). */
export function noteContext(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/')
  const base = slash === -1 ? path : path.slice(slash + 1)
  return { name: base.replace(/\.(md|base)$/i, ''), folder: slash === -1 ? '' : path.slice(0, slash) }
}
