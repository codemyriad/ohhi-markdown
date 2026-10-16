// @vitest-environment jsdom
/**
 * The dock's *Comments* tab (writing-harness B8): the note's threads with the
 * open / resolved filter, resolve from the row, open the bubble, and the
 * CriticMarkup export to a copy.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeReviewCopy } from '../threads.svelte.js'
import type { Workspace } from '../workspace.svelte.js'
import ThreadList from './ThreadList.svelte'

afterEach(cleanup)

import { threadsFixture } from '../harness.fixture.js'

const TEXT = 'The plan is to ship in March. Then rest.'
const PATH = 'notes/plan.md'

function fakeWorkspace() {
  const { registry, doc: held } = threadsFixture({ text: TEXT, path: PATH })
  const doc = held.current!
  const created: Record<string, string> = {}
  const ws: Pick<Workspace, 'threadsFor' | 'resolveThread' | 'exportCriticMarkup'> = {
    threadsFor: (p) => registry.storeFor(p),
    resolveThread: (p, id, resolved = true) => registry.storeFor(p)?.resolve(id, resolved),
    exportCriticMarkup: async (p) =>
      writeReviewCopy(registry.storeFor(p)!, p, {
        exists: () => false,
        createFile: async (dir, name, text) => {
          created[`${dir}/${name}`] = text
          return `${dir}/${name}`
        },
      }),
  }
  return { ws, doc, created, store: () => registry.storeFor(PATH)! }
}

describe('ThreadList', () => {
  it('asks for a note when none is open', () => {
    const { ws } = fakeWorkspace()
    render(ThreadList, { path: null, workspace: ws, onOpen: () => {} })
    expect(screen.getByTestId('thread-list')).toHaveTextContent('Open a note to see its comments.')
  })

  it('lists open threads, filters to resolved and all, and resolves from the row', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const a = store().add({ from: 4, to: 8, author: 'Ana', body: 'vague', at: 1 })
    store().reply(a.id, { author: 'Ben', body: 'agreed' })
    const b = store().add({ from: 30, to: 39, author: 'Ben', body: 'why rest?', at: 2 })
    store().resolve(b.id)
    render(ThreadList, { path: PATH, workspace: ws, onOpen: () => {} })

    const list = screen.getByTestId('thread-list')
    const rowA = await within(list).findByTestId(`thread:${a.id}`)
    expect(rowA).toHaveTextContent('plan')
    expect(rowA).toHaveTextContent('Ana vague')
    expect(rowA).toHaveTextContent('1 reply')
    expect(within(list).queryByTestId(`thread:${b.id}`)).toBeNull()
    expect(screen.getByTestId('thread-filter:open')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('thread-filter:open')).toHaveTextContent('Open 1')
    expect(screen.getByTestId('thread-filter:resolved')).toHaveTextContent('Resolved 1')

    await user.click(screen.getByTestId('thread-filter:resolved'))
    expect(within(list).getByTestId(`thread:${b.id}`)).toHaveTextContent('Then rest')
    expect(within(list).queryByTestId(`thread:${a.id}`)).toBeNull()

    await user.click(screen.getByTestId('thread-filter:all'))
    expect(within(list).getAllByTestId(/^thread:/)).toHaveLength(2)

    await user.click(screen.getByTestId('thread-filter:open'))
    await user.click(screen.getByTestId(`thread-resolve:${a.id}`))
    expect(store().get(a.id)?.resolved).toBe(true)
    await waitFor(() => expect(within(list).queryByTestId(`thread:${a.id}`)).toBeNull())
    expect(list).toHaveTextContent('No open comments on this note.')
  })

  it('opens a thread from its row', async () => {
    const user = userEvent.setup()
    const { ws, store } = fakeWorkspace()
    const a = store().add({ from: 4, to: 8, author: 'Ana', body: 'vague' })
    const onOpen = vi.fn()
    render(ThreadList, { path: PATH, workspace: ws, onOpen })
    await user.click(within(await screen.findByTestId(`thread:${a.id}`)).getByText('vague', { exact: false }))
    expect(onOpen).toHaveBeenCalledWith(a.id)
  })

  it('exports the open threads as CriticMarkup to a review copy, never the note', async () => {
    const user = userEvent.setup()
    const { ws, doc, store, created } = fakeWorkspace()
    store().add({ from: 4, to: 8, author: 'Ana', body: 'vague', at: Date.parse('2026-10-10T09:00:00.000Z') })
    const flash = vi.fn()
    const onExported = vi.fn()
    render(ThreadList, { path: PATH, workspace: ws, onOpen: () => {}, flash, onExported })
    await user.click(screen.getByTestId('thread-export'))
    await waitFor(() => expect(onExported).toHaveBeenCalledWith('notes/plan (review).md'))
    expect(created['notes/plan (review).md']).toBe(
      'The {==plan==}{>>Ana|2026-10-10T09:00:00.000Z: vague<<} is to ship in March. Then rest.'
    )
    expect(doc.getText()).toBe(TEXT)
    expect(flash).toHaveBeenCalledWith({ level: 'info', text: 'Review copy written to notes/plan (review).md.' })
  })

  it('offers no export with no open thread', () => {
    const { ws } = fakeWorkspace()
    render(ThreadList, { path: PATH, workspace: ws, onOpen: () => {} })
    expect(screen.queryByTestId('thread-export')).toBeNull()
  })

  it('is its own door: Comment on selection runs note.comment, and the empty state names the key', async () => {
    const user = userEvent.setup()
    const { ws } = fakeWorkspace()
    const run = vi.fn()
    const registry = {
      get: (id: string) => (id === 'note.comment' ? { id, title: 'Comment on selection', run } : undefined),
      binding: (id: string) => (id === 'note.comment' ? 'Ctrl+Shift+M' : ''),
    }
    render(ThreadList, { path: PATH, workspace: ws, onOpen: () => {}, registry })
    expect(screen.getByTestId('thread-how')).toHaveTextContent(
      'Select some text and press Ctrl+Shift+M, or use the comment button on the formatting bar.'
    )
    await user.click(screen.getByTestId('thread-comment'))
    expect(screen.getByTestId('thread-comment')).toHaveTextContent('Comment on selection')
    expect(run).toHaveBeenCalledOnce()
  })
})
