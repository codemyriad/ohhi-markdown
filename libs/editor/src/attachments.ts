/**
 * Pasting and dropping pictures (editor-usability E5).
 *
 * The editor stays host-neutral: it notices the files on a paste or a drop
 * that the host accepts (pictures and PDFs — the rule is the host's,
 * libs/workspace's `isAttachmentFile`), hands them to the host through the
 * `attachmentHost` facet, and inserts what the host answers — `![[name.png]]`
 * for a picture, `[[file.pdf]]` for a PDF — in ONE transaction at the caret
 * or where the files were dropped.
 * Where the file is written, what it is called and what the link says are the
 * host's business (apps/web's `attachment-host.ts`, over libs/workspace's
 * placement rules): a view does not know the vault.
 *
 * Without a host nothing here does anything, and CM6's own paste and drop run
 * as before (they read files as text and skip binaries).
 */
import { Facet, StateEffect, StateField, type ChangeDesc, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'

/** What a paste or a drop is: the host names a pasted picture by the clock. */
export type AttachmentGesture = 'paste' | 'drop'

/** One file the host saved: the text a note links it by (`shot.png`, `img/shot.png`). */
export interface SavedAttachment {
  link: string
}

export interface AttachmentHost {
  /** Is this file one a note can take (by name, then by media type)? */
  accepts(file: { name: string; type: string }): boolean
  /** Is this media type — all a drag exposes before the drop — one a note can take? */
  acceptsType(type: string): boolean
  /**
   * Save the files (bytes to disk, journaled — the host's write path), in
   * order. Answers one entry per file: what to link it by, or null for a file
   * that was not saved (the host has said why, through its own notices).
   */
  save(files: readonly File[], gesture: AttachmentGesture): Promise<(SavedAttachment | null)[]>
  /**
   * The drop overlay's two lines while files are dragged over the editor —
   * `Drop to add to this note` and where they will be saved. File names are
   * not readable before the drop (the browser keeps them private), so the
   * host is told only how many files and which media types.
   */
  dropLabels(count: number, types: readonly string[]): { title: string; detail: string }
  /** Called after the links are in the note (the shared-folder notice hangs off this). */
  inserted?(saved: readonly SavedAttachment[]): void
}

export const attachmentHost = Facet.define<AttachmentHost, AttachmentHost | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

// ---- the pure parts ----

/** The files out of a FileList the host accepts, in order. */
export function attachmentFiles(
  list: ArrayLike<File> | null | undefined,
  host: Pick<AttachmentHost, 'accepts'>
): File[] {
  if (!list) return []
  const out: File[] = []
  for (let i = 0; i < list.length; i++) if (host.accepts(list[i]!)) out.push(list[i]!)
  return out
}

/** `![[shot.png]]` for a picture, `[[paper.pdf]]` for a PDF — Obsidian's forms. */
export function attachmentMarkup(link: string): string {
  return /\.pdf$/i.test(link) ? `[[${link}]]` : `![[${link}]]`
}

/**
 * The one transaction that puts the links in: over `from..to` (a paste
 * replaces the selection), one link per line when there are several, the caret
 * after the last.
 */
export function insertAttachments(
  state: EditorState,
  from: number,
  to: number,
  links: readonly string[]
): { changes: { from: number; to: number; insert: string }; selection: { anchor: number } } | null {
  if (links.length === 0) return null
  const insert = links.map(attachmentMarkup).join('\n')
  const a = Math.max(0, Math.min(from, state.doc.length))
  const b = Math.max(a, Math.min(to, state.doc.length))
  return { changes: { from: a, to: b, insert }, selection: { anchor: a + insert.length } }
}

/**
 * A paste is a picture paste only when there is no text to paste: copying a
 * passage out of a word processor puts a rendered image of it on the clipboard
 * too, and the person wanted the words.
 */
export function pastedAttachments(data: DataTransfer | null, host: Pick<AttachmentHost, 'accepts'>): File[] {
  if (!data) return []
  const files = attachmentFiles(data.files, host)
  if (files.length === 0) return []
  if ((data.getData('text/plain') ?? '').trim() !== '') return []
  return files
}

// ---- the range a save is in flight for ----

/**
 * Where each in-flight save will insert, mapped through every edit that lands
 * while the bytes are written — a peer's typing, or the person's own.
 *
 * - A caret (an empty range) is one point that maps to the left, so whatever
 *   is typed at the caret meanwhile ends up after the link and nothing is
 *   replaced.
 * - A selection maps inward (`from` to the right, `to` to the left), so text
 *   typed at either edge stays outside it. The selection is replaced only if
 *   it still holds the text it held when the paste or drop began; if anyone
 *   changed it meanwhile, the link goes in at its start and replaces nothing.
 */
export interface PendingAttachment {
  id: number
  from: number
  to: number
  /** The selected text when the save began ('' for a caret). */
  text: string
}

const addPending = StateEffect.define<PendingAttachment>()
const dropPending = StateEffect.define<number>()

/** One pending range mapped through a change set (exported for the unit tests). */
export function mapPending(p: PendingAttachment, changes: ChangeDesc): PendingAttachment {
  if (p.from === p.to) {
    const at = changes.mapPos(p.from, -1)
    return { ...p, from: at, to: at }
  }
  const from = changes.mapPos(p.from, 1)
  const to = Math.max(from, changes.mapPos(p.to, -1))
  return { ...p, from, to }
}

const pendingField = StateField.define<readonly PendingAttachment[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged ? value.map((p) => mapPending(p, tr.changes)) : value
    for (const e of tr.effects) {
      if (e.is(addPending)) next = [...next, e.value]
      else if (e.is(dropPending)) next = next.filter((p) => p.id !== e.value)
    }
    return next
  },
})

/**
 * Where the links go once the save answers: over the pending range when it
 * still holds the text it held, else at its start replacing nothing.
 */
export function pendingTarget(state: EditorState, p: PendingAttachment): { from: number; to: number } {
  if (p.from === p.to) return { from: p.from, to: p.from }
  const now = state.doc.sliceString(p.from, p.to)
  return now === p.text ? { from: p.from, to: p.to } : { from: p.from, to: p.from }
}

let nextId = 1

async function saveAndInsert(
  view: EditorView,
  host: AttachmentHost,
  files: File[],
  gesture: AttachmentGesture,
  from: number,
  to: number
): Promise<void> {
  const id = nextId++
  view.dispatch({ effects: addPending.of({ id, from, to, text: view.state.doc.sliceString(from, to) }) })
  const before = view.state.doc
  let saved: (SavedAttachment | null)[] = []
  try {
    saved = await host.save(files, gesture)
  } catch {
    saved = []
  }
  // The view may have gone (its tab closed or switched) while the bytes were
  // written: the files are on disk and in the tree either way, and only the
  // link is not added — a dispatch to a destroyed view reaches no document.
  if (!view.dom.isConnected) return
  const at = view.state.field(pendingField, false)?.find((p) => p.id === id)
  const kept = saved.filter((s): s is SavedAttachment => s !== null)
  const target = at ? pendingTarget(view.state, at) : null
  const spec = target ? insertAttachments(view.state, target.from, target.to, kept.map((s) => s.link)) : null
  if (spec && target && !view.state.readOnly) {
    // The caret goes after the link when nothing was edited meanwhile, or the
    // caret is still where the paste left it; if the person typed or moved on
    // meanwhile, their caret just maps through the insert.
    const sel = view.state.selection.main
    const stayed = view.state.doc === before || (sel.from === target.from && sel.to === target.to)
    view.dispatch({
      changes: spec.changes,
      ...(stayed ? { selection: spec.selection } : {}),
      effects: dropPending.of(id),
      scrollIntoView: stayed,
      userEvent: `input.${gesture}`,
    })
    host.inserted?.(kept)
  } else {
    view.dispatch({ effects: dropPending.of(id) })
  }
}

// ---- the drop overlay ----

/** The accepted media types of the files in a drag (names stay private until the drop). */
function draggedTypes(data: DataTransfer | null, host: AttachmentHost): string[] | null {
  if (!data || !Array.from(data.types).includes('Files')) return null
  const types: string[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && host.acceptsType(item.type)) types.push(item.type)
  }
  return types.length > 0 ? types : null
}

class DropOverlay implements PluginValue {
  private el: HTMLElement | null = null

  constructor(private readonly view: EditorView) {}

  show(title: string, detail: string): void {
    if (!this.el) {
      this.el = document.createElement('div')
      this.el.className = 'cm-drop-overlay'
      this.el.setAttribute('aria-hidden', 'true')
      this.el.dataset.testid = 'drop-overlay'
      this.el.append(document.createElement('div'), document.createElement('div'))
      ;(this.el.firstChild as HTMLElement).className = 'cm-drop-overlay-title'
      ;(this.el.lastChild as HTMLElement).className = 'cm-drop-overlay-detail'
      this.view.dom.appendChild(this.el)
    }
    ;(this.el.firstChild as HTMLElement).textContent = title
    ;(this.el.lastChild as HTMLElement).textContent = detail
  }

  hide(): void {
    this.el?.remove()
    this.el = null
  }

  destroy(): void {
    this.hide()
  }
}

const overlay = ViewPlugin.fromClass(DropOverlay)

const handlers = EditorView.domEventHandlers({
  paste(event, view) {
    const host = view.state.facet(attachmentHost)
    if (!host || view.state.readOnly) return false
    const files = pastedAttachments(event.clipboardData, host)
    if (files.length === 0) return false
    event.preventDefault()
    const { from, to } = view.state.selection.main
    void saveAndInsert(view, host, files, 'paste', from, to)
    return true
  },

  dragover(event, view) {
    const host = view.state.facet(attachmentHost)
    if (!host) return false
    const types = draggedTypes(event.dataTransfer, host)
    if (!types) return false
    // Claiming the dragover is what makes this a drop target at all — and a
    // file let fall in Reading must not navigate the window to it either.
    event.preventDefault()
    if (view.state.readOnly) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
      return true
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    const { title, detail } = host.dropLabels(types.length, types)
    view.plugin(overlay)?.show(title, detail)
    return true
  },

  dragleave(event, view) {
    const to = event.relatedTarget as Node | null
    if (!to || !view.dom.contains(to)) view.plugin(overlay)?.hide()
    return false
  },

  dragend(_event, view) {
    view.plugin(overlay)?.hide()
    return false
  },

  drop(event, view) {
    const host = view.state.facet(attachmentHost)
    view.plugin(overlay)?.hide()
    if (!host) return false
    const files = attachmentFiles(event.dataTransfer?.files, host)
    if (files.length === 0) return false
    event.preventDefault()
    if (view.state.readOnly) return true
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
    void saveAndInsert(view, host, files, 'drop', pos, pos)
    return true
  },
})

/** Install once (libs/editor's own list does); inert until a host provides `attachmentHost`. */
export function attachmentDrop(): Extension {
  return [pendingField, overlay, handlers]
}
