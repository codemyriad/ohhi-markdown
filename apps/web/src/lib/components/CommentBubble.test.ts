// @vitest-environment jsdom
/**
 * The comment bubble (writing-harness B8): a new comment on a selection —
 * *Comment*, and the AI-gated *Send to agent* with the quiet line saying
 * where it goes — and a thread's reply / resolve.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type BubbleRequest } from '../threads.svelte.js'
import type { SuggestionRecord } from '@ohhi/workspace'
import type { Workspace } from '../workspace.svelte.js'
import CommentBubble from './CommentBubble.svelte'
import { harness } from '../sessions.svelte.js'
import type { SessionSummary } from '../session-store.js'

afterEach(() => {
  cleanup()
  harness.current = null
  harness.list = []
})

import { threadsFixture } from '../harness.fixture.js'

const TEXT = 'The plan is to ship in March.'
const PATH = 'plan.md'

function fakeWorkspace() {
  const { registry, doc: held } = threadsFixture({ text: TEXT, path: PATH })
  const doc = held.current!
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
  it('comments on the selection, with no Send to agent when there is no provider', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const onClose = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: false, onClose })
    const bubble = await screen.findByTestId('comment-bubble')
    expect(bubble).toHaveAttribute('role', 'dialog')
    expect(screen.queryByTestId('comment-send-agent')).toBeNull()
    expect(screen.queryByTestId('comment-send-target')).toBeNull()
    expect(screen.getByTestId('comment-submit')).toBeDisabled()

    await user.type(screen.getByTestId('comment-body'), 'Too vague')
    await user.click(screen.getByTestId('comment-submit'))
    expect(ws.addThread).toHaveBeenCalledWith(PATH, { from: 4, to: 8, body: 'Too vague' })
    expect(onClose).toHaveBeenCalled()
    const [t] = store().threads()
    expect(t.anchor.quote.exact).toBe('plan')
    expect(t.comments[0].to).toBeUndefined()
  })

  it("with a provider, Send to agent saves the thread with to: ['agent'] and asks the agent; with no session it says a new one starts", async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const onSendToAgent = vi.fn()
    const onClose = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: true, onClose, onSendToAgent })
    const send = await screen.findByTestId('comment-send-agent')
    expect(send).toHaveTextContent('Send to agent')
    expect(send).toBeDisabled()
    // No checkbox, no select: one quiet line, plain text with no session to choose.
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    const where = screen.getByTestId('comment-send-target')
    expect(where.tagName).toBe('P')
    expect(where).toHaveTextContent('Starts a new session')
    await user.type(screen.getByTestId('comment-body'), 'Rewrite this')
    await user.click(send)
    expect(ws.addThread).toHaveBeenCalledWith(PATH, { from: 4, to: 8, body: 'Rewrite this', sendTo: ['agent'] })
    const [thread] = store().threads()
    expect(thread.comments[0].to).toEqual(['agent'])
    expect(onSendToAgent).toHaveBeenCalledWith(PATH, thread.id, 'new')
    expect(onClose).toHaveBeenCalled()
  })

  it('Comment only saves the thread, even with a provider', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const onSendToAgent = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: true, onClose: () => {}, onSendToAgent })
    await user.type(await screen.findByTestId('comment-body'), 'Just a note')
    await user.click(screen.getByTestId('comment-submit'))
    expect(ws.addThread).toHaveBeenCalledWith(PATH, { from: 4, to: 8, body: 'Just a note' })
    expect(store().threads()[0].comments[0].to).toBeUndefined()
    expect(onSendToAgent).not.toHaveBeenCalled()
  })

  it('one session: the line names it, as plain text, and Send to agent goes there', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    harness.current = 's-open'
    const onSendToAgent = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: true, onClose: () => {}, onSendToAgent })
    const where = await screen.findByTestId('comment-send-target')
    expect(where.tagName).toBe('P')
    expect(where).toHaveTextContent('Sends to Untitled session')
    await user.type(screen.getByTestId('comment-body'), 'Why?')
    await user.click(screen.getByTestId('comment-send-agent'))
    expect(onSendToAgent).toHaveBeenCalledWith(PATH, store().threads()[0].id, { sessionId: 's-open' })
  })

  it('more than one session: the line is a menu of the sessions and New session', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const summary = (id: string, title: string): SessionSummary => ({ id, title, created: 0, lastAt: 0, archived: false })
    harness.list = [summary('s-a', 'Planning'), summary('s-b', 'Drafting')]
    harness.current = 's-b'
    const onSendToAgent = vi.fn()
    render(CommentBubble, { request: newRequest, workspace: ws, ai: true, onClose: () => {}, onSendToAgent })
    const trigger = await screen.findByTestId('comment-send-target')
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveTextContent('Sends to Drafting')
    await user.click(trigger)
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Drafting', 'Planning', 'New session'])
    await user.click(screen.getByTestId('comment-send-target:new'))
    await waitFor(() => expect(screen.getByTestId('comment-send-target')).toHaveTextContent('Starts a new session'))
    await user.click(screen.getByTestId('comment-send-target'))
    await user.click(await screen.findByTestId('comment-send-target:s-a'))
    await waitFor(() => expect(screen.getByTestId('comment-send-target')).toHaveTextContent('Sends to Planning'))
    await user.type(screen.getByTestId('comment-body'), 'Which?')
    await user.click(screen.getByTestId('comment-send-agent'))
    expect(onSendToAgent).toHaveBeenCalledWith(PATH, store().threads()[0].id, { sessionId: 's-a' })
  })

  it('shows the agent’s proposal answering the thread, with Accept and Reject', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const t = store().add({ from: 4, to: 8, author: 'Ana', body: 'Say when', sendTo: ['agent'] })
    const origin = { kind: 'agent' as const, runId: 'r1', sessionId: 's1', name: 'Agent', threadId: t.id }
    const records: SuggestionRecord[] = [
      { id: 'sg-1', path: PATH, origin, at: 0, range: { from: 21, to: 29 }, baseText: 'in March', proposedText: 'on 3 March', status: 'pending', threadId: t.id },
      { id: 'sg-2', path: PATH, origin: { ...origin, threadId: 'other' }, at: 0, range: { from: 0, to: 3 }, baseText: 'The', proposedText: 'Our', status: 'pending', threadId: 'other' },
    ]
    const listeners = new Set<() => void>()
    const full = {
      ...ws,
      suggestionsFor: () => records,
      subscribeSuggestions: (_p: string, cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)),
      acceptSuggestion: vi.fn((_p: string, id: string) => {
        const r = records.find((x) => x.id === id)!
        r.status = 'accepted'
        return r
      }),
      rejectSuggestion: vi.fn(() => true),
    }
    render(CommentBubble, {
      request: { kind: 'thread', paneId: 'p1', path: PATH, threadId: t.id, anchor: null },
      workspace: full,
      ai: true,
      onClose: () => {},
    })
    const card = await screen.findByTestId('comment-suggestion')
    expect(screen.getAllByTestId('comment-suggestion')).toHaveLength(1)
    expect(card).toHaveTextContent('in March')
    expect(card).toHaveTextContent('on 3 March')
    await user.click(screen.getByTestId('comment-suggestion-accept'))
    expect(full.acceptSuggestion).toHaveBeenCalledWith(PATH, 'sg-1')
    await waitFor(() => expect(screen.queryByTestId('comment-suggestion')).toBeNull())
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
