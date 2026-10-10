// @vitest-environment jsdom
/**
 * The comment bubble (writing-harness B8): a new comment on a selection, the
 * AI-gated *Send to agent* box, and a thread's reply / resolve.
 */
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThreadRegistry, type BubbleRequest } from '../threads.svelte.js'
import type { Workspace } from '../workspace.svelte.js'
import CommentBubble from './CommentBubble.svelte'

afterEach(cleanup)

const TEXT = 'The plan is to ship in March.'
const PATH = 'plan.md'

function fakeWorkspace() {
  const doc = createYjsEngine().createDoc('g1')
  doc.transact((t) => t.insert(0, TEXT), 'local')
  const store = new Map<string, string>()
  const registry = createThreadRegistry({
    clock: new SimClock(),
    docForPath: (p) => (p === PATH ? doc : null),
    guidFor: (p) => (p === PATH ? 'g1' : null),
    pathFor: () => PATH,
    files: { read: async (p) => store.get(p) ?? null, write: async (p, t) => void store.set(p, t) },
  })
  const ws: Pick<Workspace, 'threadsFor' | 'addThread' | 'reply' | 'resolveThread'> = {
    threadsFor: (p) => registry.storeFor(p),
    addThread: vi.fn((p, { author, ...rest }) => registry.storeFor(p)?.add({ ...rest, author: author ?? 'Ana' }) ?? null),
    reply: vi.fn((p, id, c) => registry.storeFor(p)?.reply(id, { ...c, author: c.author ?? 'Ana' }) ?? null),
    resolveThread: vi.fn((p, id, resolved = true) => registry.storeFor(p)?.resolve(id, resolved)),
  }
  return { ws, doc, store: () => registry.storeFor(PATH)! }
}

const newRequest: BubbleRequest = { kind: 'new', paneId: 'p1', path: PATH, from: 4, to: 8, anchor: { x: 10, y: 10 } }

describe('CommentBubble', () => {
  it('comments on the selection, with no Send to agent box when there is no provider', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const onClose = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: false, onClose })
    const bubble = await screen.findByTestId('comment-bubble')
    expect(bubble).toHaveAttribute('role', 'dialog')
    expect(screen.queryByTestId('comment-send-agent')).toBeNull()
    expect(screen.getByTestId('comment-submit')).toBeDisabled()

    await user.type(screen.getByTestId('comment-body'), 'Too vague')
    await user.click(screen.getByTestId('comment-submit'))
    expect(ws.addThread).toHaveBeenCalledWith(PATH, { from: 4, to: 8, body: 'Too vague' })
    expect(onClose).toHaveBeenCalled()
    const [t] = store().threads()
    expect(t.anchor.quote.exact).toBe('plan')
    expect(t.comments[0].to).toBeUndefined()
  })

  it("offers Send to agent with a provider; ticking it sets to: ['agent'] and nothing more", async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: true, onClose: () => {} })
    const box = await screen.findByTestId('comment-send-agent')
    await user.type(screen.getByTestId('comment-body'), 'Rewrite this')
    await user.click(box)
    await user.click(screen.getByTestId('comment-submit'))
    expect(ws.addThread).toHaveBeenCalledWith(PATH, { from: 4, to: 8, body: 'Rewrite this', sendTo: ['agent'] })
    expect(store().threads()[0].comments[0].to).toEqual(['agent'])
  })

  it('shows a thread, takes a reply, and resolves (closing)', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const t = store().add({ from: 4, to: 8, author: 'Ana', body: 'First', sendTo: ['agent'] })
    const onClose = vi.fn()
    render(CommentBubble, {
      request: { kind: 'thread', paneId: 'p1', path: PATH, threadId: t.id, anchor: null },
      workspace: ws,
      ai: false,
      onClose,
    })
    const thread = await screen.findByTestId('comment-thread')
    expect(thread).toHaveTextContent('First')
    expect(thread).toHaveTextContent('Sent to the agent')

    await user.type(screen.getByTestId('comment-body'), 'A reply')
    await user.click(screen.getByTestId('comment-submit'))
    await waitFor(() => expect(screen.getByTestId('comment-thread')).toHaveTextContent('A reply'))
    expect(screen.getByTestId('comment-body')).toHaveValue('')

    await user.click(screen.getByTestId('comment-resolve'))
    expect(ws.resolveThread).toHaveBeenCalledWith(PATH, t.id, true)
    expect(store().get(t.id)?.resolved).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when the passage is gone', async () => {
    const { ws, doc, store } = fakeWorkspace()
    const t = store().add({ from: 4, to: 8, author: 'Ana', body: 'x' })
    doc.transact((x) => x.delete(0, TEXT.length), 'local')
    render(CommentBubble, {
      request: { kind: 'thread', paneId: 'p1', path: PATH, threadId: t.id, anchor: null },
      workspace: ws,
      ai: false,
      onClose: () => {},
    })
    expect(await screen.findByText('The text this thread was on is gone.')).toBeInTheDocument()
  })
})
