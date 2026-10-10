/**
 * Pasting and dropping pictures (editor-usability E5).
 *
 * The editor stays host-neutral: it notices image (and PDF) files on a paste
 * or a drop, hands them to the host through the `attachmentHost` facet, and
 * inserts what the host answers — `![[name.png]]` for a picture, `[[file.pdf]]`
 * for a PDF — in ONE transaction at the caret or where the files were dropped.
 * Where the file is written, what it is called and what the link says are the
 * host's business (apps/web's `attachment-host.ts`, over libs/workspace's
 * placement rules): a view does not know the vault.
 *
 * Without a host nothing here does anything, and CM6's own paste and drop run
 * as before (they read files as text and skip binaries).
 */
import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'

/** What a paste or a drop is: the host names a pasted picture by the clock. */
export type AttachmentGesture = 'paste' | 'drop'

/** One file the host saved: the text a note links it by (`shot.png`, `img/shot.png`). */
export interface SavedAttachment {
  link: string
}

export interface AttachmentHost {
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

/** The media types a paste or drop may add; the extension decides when a type is missing. */
const TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
}
const EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'pdf'])

const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Is this file one a note can take — a picture or a PDF, by name and then by type? */
export function isAttachment(file: { name: string; type: string }): boolean {
  const ext = extOf(file.name)
  if (ext) return EXTENSIONS.has(ext)
  return file.type.toLowerCase() in TYPES
}

/** Is this media type (all a drag exposes before the drop) one a note can take? */
export function isAttachmentType(type: string): boolean {
  return type.toLowerCase() in TYPES
}

/** The files a note can take out of a FileList, in order. */
export function attachmentFiles(list: ArrayLike<File> | null | undefined): File[] {
  if (!list) return []
  const out: File[] = []
  for (let i = 0; i < list.length; i++) if (isAttachment(list[i]!)) out.push(list[i]!)
  return out
}

/** `![[shot.png]]` for a picture, `[[paper.pdf]]` for a PDF — Obsidian's forms. */
export function attachmentMarkup(link: string): string {
  return extOf(link) === 'pdf' ? `[[${link}]]` : `![[${link}]]`
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
export function pastedAttachments(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = attachmentFiles(data.files)
  if (files.length === 0) return []
  if ((data.getData('text/plain') ?? '').trim() !== '') return []
  return files
}

// ---- the range a save is in flight for ----

/**
 * Where each in-flight save will insert, mapped through every edit that lands
 * while the bytes are written — a peer's typing, or the person's own. Bias is
 * to the left, so text typed at the caret after a paste stays after the image.
 */
const addPending = StateEffect.define<{ id: number; from: number; to: number }>()
const dropPending = StateEffect.define<number>()

const pendingField = StateField.define<readonly { id: number; from: number; to: number }[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged
      ? value.map((p) => {
          const from = tr.changes.mapPos(p.from, -1)
          return { id: p.id, from, to: Math.max(from, tr.changes.mapPos(p.to, 1)) }
        })
      : value
    for (const e of tr.effects) {
      if (e.is(addPending)) next = [...next, e.value]
      else if (e.is(dropPending)) next = next.filter((p) => p.id !== e.value)
    }
    return next
  },
})

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
  view.dispatch({ effects: addPending.of({ id, from, to }) })
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
  const spec = at ? insertAttachments(view.state, at.from, at.to, kept.map((s) => s.link)) : null
  if (spec && !view.state.readOnly) {
    view.dispatch({ ...spec, effects: dropPending.of(id), scrollIntoView: true, userEvent: `input.${gesture}` })
    host.inserted?.(kept)
  } else {
    view.dispatch({ effects: dropPending.of(id) })
  }
}

// ---- the drop overlay ----

/** The media types of the files in a drag (names stay private until the drop). */
function draggedTypes(data: DataTransfer | null): string[] | null {
  if (!data || !Array.from(data.types).includes('Files')) return null
  const types: string[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file') types.push(item.type)
  }
  return types.some(isAttachmentType) ? types.filter(isAttachmentType) : null
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
    const files = pastedAttachments(event.clipboardData)
    if (files.length === 0) return false
    event.preventDefault()
    const { from, to } = view.state.selection.main
    void saveAndInsert(view, host, files, 'paste', from, to)
    return true
  },

  dragover(event, view) {
    const host = view.state.facet(attachmentHost)
    if (!host) return false
    const types = draggedTypes(event.dataTransfer)
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
    const files = attachmentFiles(event.dataTransfer?.files)
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
