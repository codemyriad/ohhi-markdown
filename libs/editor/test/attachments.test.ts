/**
 * Pasting and dropping pictures (editor-usability E5) — the pure parts: which
 * files a note takes, what is inserted, and when a paste is a picture paste.
 * The DOM wiring (the handlers, the overlay) is the e2e spec's.
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  attachmentFiles,
  attachmentMarkup,
  insertAttachments,
  isAttachment,
  isAttachmentType,
  mapPending,
  pastedAttachments,
  pendingTarget,
  type PendingAttachment,
} from '../src/attachments.js'

const file = (name: string, type: string): File => ({ name, type }) as File

/** Enough of a DataTransfer for the paste rule. */
function clipboard(files: File[], text = ''): DataTransfer {
  return {
    files: Object.assign([...files], { item: (i: number) => files[i] ?? null }),
    getData: (type: string) => (type === 'text/plain' ? text : ''),
  } as unknown as DataTransfer
}

describe('which files a note takes', () => {
  it('takes the pictures and PDFs, by name first and then by type', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.svg', 'a.bmp', 'a.pdf']) {
      expect(isAttachment(file(n, ''))).toBe(true)
    }
    expect(isAttachment(file('image.png', 'image/png'))).toBe(true)
    expect(isAttachment(file('', 'image/png'))).toBe(true)
    expect(isAttachment(file('notes.txt', 'text/plain'))).toBe(false)
    expect(isAttachment(file('a.zip', 'image/png'))).toBe(false)
    expect(isAttachmentType('image/webp')).toBe(true)
    expect(isAttachmentType('text/html')).toBe(false)
  })

  it('keeps the order and drops the rest', () => {
    const list = [file('a.png', 'image/png'), file('b.txt', 'text/plain'), file('c.pdf', 'application/pdf')]
    expect(attachmentFiles(list).map((f) => f.name)).toEqual(['a.png', 'c.pdf'])
    expect(attachmentFiles(null)).toEqual([])
  })
})

describe('what goes in the note', () => {
  it('embeds a picture and links a PDF, Obsidian’s forms', () => {
    expect(attachmentMarkup('Pasted image 20261010140307.png')).toBe('![[Pasted image 20261010140307.png]]')
    expect(attachmentMarkup('img/x.svg')).toBe('![[img/x.svg]]')
    expect(attachmentMarkup('paper.PDF')).toBe('[[paper.PDF]]')
  })

  it('is one change over the selection, one link per line, the caret after the last', () => {
    const state = EditorState.create({ doc: 'before SELECTED after' })
    const spec = insertAttachments(state, 7, 15, ['a.png', 'b.pdf'])
    expect(spec).toEqual({
      changes: { from: 7, to: 15, insert: '![[a.png]]\n[[b.pdf]]' },
      selection: { anchor: 7 + '![[a.png]]\n[[b.pdf]]'.length },
    })
    const after = state.update(spec!).state
    expect(after.doc.toString()).toBe('before ![[a.png]]\n[[b.pdf]] after')
  })

  it('clamps a range the document has shrunk under, and inserts nothing for nothing saved', () => {
    const state = EditorState.create({ doc: 'abc' })
    expect(insertAttachments(state, 10, 12, ['x.png'])?.changes).toEqual({ from: 3, to: 3, insert: '![[x.png]]' })
    expect(insertAttachments(state, 0, 0, [])).toBeNull()
  })
})

describe('when a paste is a picture paste', () => {
  it('is one when the clipboard holds a picture and no text', () => {
    expect(pastedAttachments(clipboard([file('image.png', 'image/png')])).length).toBe(1)
  })

  it('is not one when there is text too — a word processor puts a picture of the words beside them', () => {
    expect(pastedAttachments(clipboard([file('image.png', 'image/png')], 'the words'))).toEqual([])
  })

  it('is not one for a file a note does not take, or for no clipboard', () => {
    expect(pastedAttachments(clipboard([file('a.zip', 'application/zip')]))).toEqual([])
    expect(pastedAttachments(null)).toEqual([])
  })
})

describe('edits that land while the save is in flight', () => {
  /** Start a save over `from..to`, apply `edits` meanwhile, then insert the link where the range ended up. */
  function run(doc: string, from: number, to: number, edits: { from: number; to?: number; insert: string }[]): string {
    let state = EditorState.create({ doc })
    let p: PendingAttachment = { id: 1, from, to, text: state.doc.sliceString(from, to) }
    for (const e of edits) {
      const tr = state.update({ changes: e })
      p = mapPending(p, tr.changes)
      state = tr.state
    }
    const at = pendingTarget(state, p)
    return state.update(insertAttachments(state, at.from, at.to, ['x.png'])!).state.doc.toString()
  }

  it('keeps what the person types at the caret during save(), after the picture', () => {
    // "ab|cd": paste at 2, then type "XY" at the caret before the save answers.
    expect(run('abcd', 2, 2, [{ from: 2, insert: 'X' }, { from: 3, insert: 'Y' }])).toBe('ab![[x.png]]XYcd')
  })

  it('follows a peer insert before the caret and replaces nothing', () => {
    expect(run('abcd', 2, 2, [{ from: 0, insert: 'PEER ' }])).toBe('PEER ab![[x.png]]cd')
  })

  it('replaces the selection, keeping text typed at its edges outside it', () => {
    // "a[SEL]b": typing lands at both edges of the selection meanwhile.
    expect(run('aSELb', 1, 4, [{ from: 1, insert: '<' }, { from: 5, insert: '>' }])).toBe('a<![[x.png]]>b')
  })

  it('inserts at the start without replacing when the selected text changed meanwhile', () => {
    expect(run('aSELb', 1, 4, [{ from: 2, to: 3, insert: 'Q' }])).toBe('a![[x.png]]SQLb')
  })
})
