// @vitest-environment jsdom
/**
 * Comment threads in the shell (writing-harness B8): the registry behind the
 * workspace facade, the review copy, the `lines` reference F sends the
 * agent, and `note.comment` over a real CM6 view.
 */
import { commentRanges, commentsExtension, createMarkdownEditor, type MarkdownEditorHandle } from '@ohhi/editor'
import { getLL } from '@ohhi/i18n'
import type { EngineDoc } from '@ohhi/sync'
import { THREAD_WRITE_DEBOUNCE_MS } from '@ohhi/workspace'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindThreads,
  canComment,
  commentBubble,
  commentOnSelection,
  createThreadRegistry,
  openThread,
  resetCommentEditors,
  writeReviewCopy,
  type ThreadRegistry,
} from './threads.svelte.js'
import { bindEditor } from './focused-editor.svelte.js'
import { docWith, threadsFixture } from './harness.fixture.js'

const TEXT = '# Plan\n\nThe plan is to ship in March.\nThen rest.\n'
const PLAN = TEXT.indexOf('plan')

const fixture = () => threadsFixture({ text: TEXT, path: 'notes/plan.md' })

afterEach(() => resetCommentEditors())

// jsdom has no layout: CM6's `coordsAtPos` measures text through Range rects.
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

describe('the thread registry', () => {
  it('hands out one store per note, none for a path without a doc', () => {
    const { registry } = fixture()
    const store = registry.storeFor('notes/plan.md')
    expect(store).not.toBeNull()
    expect(registry.storeFor('notes/plan.md')).toBe(store)
    expect(registry.storeFor('other.md')).toBeNull()
  })

  it('starts over from the JSON when the doc is rebuilt, re-anchoring by quote', async () => {
    const { registry, clock, doc } = fixture()
    const store = registry.storeFor('notes/plan.md')!
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'vague' })
    clock.advance(THREAD_WRITE_DEBOUNCE_MS)
    await Promise.resolve()

    doc.current = docWith(`intro\n${TEXT}`)
    const rebuilt = registry.storeFor('notes/plan.md')!
    expect(rebuilt).not.toBe(store)
    await vi.waitFor(() => expect(rebuilt.threads()).toHaveLength(1))
    const at = doc.current.getText().indexOf('plan')
    expect(rebuilt.rangeOf(rebuilt.get(t.id)!)).toEqual({ from: at, to: at + 4 })
  })
})

describe('writeReviewCopy', () => {
  it('writes the open threads as CriticMarkup into a copy beside the note, never the note', async () => {
    const { registry, doc: held } = fixture()
    const doc = held.current!
    const store = registry.storeFor('notes/plan.md')!
    store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'vague', at: Date.parse('2026-10-10T09:00:00.000Z') })
    const gone = store.add({ from: 0, to: 6, author: 'Ben', body: 'old' })
    store.resolve(gone.id)
    const created: [string, string, string][] = []
    const out = await writeReviewCopy(store, 'notes/plan.md', {
      exists: (p) => p === 'notes/plan (review).md',
      createFile: async (dir, name, text) => {
        created.push([dir, name, text])
        return `${dir}/${name}`
      },
    })
    expect(out).toEqual({ path: 'notes/plan (review 2).md', written: 1, skipped: 0 })
    expect(created[0][2]).toContain('The {==plan==}{>>Ana|2026-10-10T09:00:00.000Z: vague<<} is to ship')
    expect(doc.getText()).toBe(TEXT)
  })

  it('writes nothing when no thread is open', async () => {
    const { registry } = fixture()
    const createFile = vi.fn()
    const out = await writeReviewCopy(registry.storeFor('notes/plan.md')!, 'notes/plan.md', { exists: () => false, createFile })
    expect(out).toEqual({ path: null, written: 0, skipped: 0 })
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('note.comment over an editor', () => {
  let handle: MarkdownEditorHandle | null = null
  afterEach(() => {
    handle?.destroy()
    handle = null
  })

  /** What the pane does: bind its editor once, then feed its marks. */
  function bound(paneId: string, view: MarkdownEditorHandle['view'], focused: boolean, registry: ThreadRegistry): () => void {
    const unbind = bindEditor({ paneId, path: 'notes/plan.md', view, focused })
    const off = bindThreads({ path: 'notes/plan.md', view, storeFor: (p) => registry.storeFor(p) })
    return () => {
      off?.()
      unbind()
    }
  }

  function mountEditor(doc: EngineDoc): MarkdownEditorHandle {
    const parent = document.createElement('div')
    document.body.append(parent)
    handle = createMarkdownEditor(parent, {
      doc,
      awareness: null,
      user: { name: 'Ana', color: '#000' },
      extensions: [commentsExtension()],
    })
    return handle
  }

  it('opens a new-comment bubble on the selection, not AI-gated', () => {
    const { registry, doc: held } = fixture()
    const doc = held.current!
    const ed = mountEditor(doc)
    expect(canComment()).toBe(false)
    const off = bound('p1', ed.view, true, registry)
    expect(canComment()).toBe(true)

    ed.view.dispatch({ selection: { anchor: PLAN, head: PLAN + 4 } })
    expect(commentOnSelection()).toBe(true)
    expect(commentBubble.current).toMatchObject({ kind: 'new', paneId: 'p1', path: 'notes/plan.md', from: PLAN, to: PLAN + 4 })
    off?.()
    expect(canComment()).toBe(false)
  })

  it('draws the note threads as marks, opens a thread under a bare caret, and asks for a selection otherwise', async () => {
    const { registry, doc: held } = fixture()
    const doc = held.current!
    const store = registry.storeFor('notes/plan.md')!
    const t = store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    const ed = mountEditor(doc)
    bound('p1', ed.view, true, registry)
    expect(commentRanges(ed.view.state)).toEqual([{ id: t.id, from: PLAN, to: PLAN + 4, resolved: false }])

    // A new thread arrives (a peer's, or this one) → the marks follow.
    // The push waits a microtask: a store change can land inside another view update.
    const u = store.add({ from: 0, to: 6, author: 'Ben', body: 'y' })
    await Promise.resolve()
    expect(commentRanges(ed.view.state).map((r) => r.id)).toEqual([u.id, t.id])

    ed.view.dispatch({ selection: { anchor: PLAN + 2 } })
    expect(commentOnSelection()).toBe(true)
    expect(commentBubble.current).toMatchObject({ kind: 'thread', threadId: t.id })

    const flash = vi.fn()
    ed.view.dispatch({ selection: { anchor: TEXT.length - 2 } })
    expect(commentOnSelection(flash)).toBe(false)
    expect(flash).toHaveBeenCalledWith({ level: 'info', text: getLL().web.ai.comments.select_first() })
  })

  it('pushes a store change after the current update, never inside it', async () => {
    const { registry, doc: held } = fixture()
    const doc = held.current!
    const store = registry.storeFor('notes/plan.md')!
    const view = { dispatch: vi.fn() } as unknown as MarkdownEditorHandle['view']
    const off = bindThreads({ path: 'notes/plan.md', view, storeFor: (p) => registry.storeFor(p) })
    expect(view.dispatch).toHaveBeenCalledTimes(1) // the first paint, at bind
    store.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    expect(view.dispatch).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(view.dispatch).toHaveBeenCalledTimes(2)
    off?.()
    store.add({ from: 0, to: 6, author: 'Ben', body: 'y' })
    await Promise.resolve()
    expect(view.dispatch).toHaveBeenCalledTimes(2)
  })

  it('opens a thread from the list in the editor showing its note', () => {
    const { registry, doc: held } = fixture()
    const doc = held.current!
    const t = registry.storeFor('notes/plan.md')!.add({ from: PLAN, to: PLAN + 4, author: 'Ana', body: 'x' })
    const ed = mountEditor(doc)
    expect(openThread('notes/plan.md', t.id)).toBe(false)
    bound('p2', ed.view, false, registry)
    expect(openThread('notes/plan.md', t.id)).toBe(true)
    expect(commentBubble.current).toMatchObject({ kind: 'thread', paneId: 'p2', threadId: t.id })
    expect(ed.view.state.selection.main.head).toBe(PLAN)
  })
})
