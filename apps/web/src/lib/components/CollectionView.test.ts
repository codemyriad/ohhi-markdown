// @vitest-environment jsdom
/**
 * The collection tab (bases-shaping A3/A4/A8): the file's views as tabs,
 * the index's rows as a table, a header click written back to the file's
 * one view node, a cell edit written to the note's one value, and "+ New"
 * creating a note where the view's filter says.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryIndex, type IndexDoc } from '@ohhi/index'
import type { EngineDoc } from '@ohhi/sync'
import type { Tab } from '../panes.js'
import { fakeViewShell } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import type { Workspace } from '../workspace.svelte.js'
import CollectionView from './CollectionView.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const BASE = `filters:
  and:
    - file.inFolder("Competitors")
properties:
  threat:
    displayName: Threat
views:
  - type: table
    name: All
    order:
      - file.name
      - threat
      - depth
      - verified
      - active
  - type: table
    name: Direct
    filters:
      and:
        - 'threat == "direct"'
    order:
      - file.name
      - verified
`

const NOTES: Record<string, string> = {
  'Competitors.base': BASE,
  'Competitors/Ingredifind.md': '---\nthreat: direct\ndepth: Deep\nverified: 2026-06-02\nactive: true\n---\n\n# Ingredifind\n',
  'Competitors/Quiteful.md': '---\nthreat: adjacent\ndepth: Moderate\nverified: 2026-03-14\nactive: false\n---\n',
  'Competitors/Stale.md': '---\nthreat: direct\nverified: 2026-01-10\n---\n',
  'Meetings/Weekly.md': '---\nstatus: done\n---\n',
}

/** A live doc in miniature, feeding the index on every transaction as the sink would. */
function fakeDoc(path: string, index: MemoryIndex, store: Map<string, string>): EngineDoc {
  const doc = {
    guid: path,
    getText: () => store.get(path) ?? '',
    transact: (fn: (t: { insert(i: number, s: string): void; delete(i: number, n: number): void }) => void) => {
      let text = store.get(path) ?? ''
      fn({
        insert: (i, s) => (text = text.slice(0, i) + s + text.slice(i)),
        delete: (i, n) => (text = text.slice(0, i) + text.slice(i + n)),
      })
      store.set(path, text)
      index.upsert({ guid: path, path, text })
    },
    getMap: () => {
      throw new Error('not a folder doc')
    },
    transactMap: () => {
      throw new Error('not a folder doc')
    },
    raw: () => null,
    destroy: () => {},
  }
  return doc as unknown as EngineDoc
}

function setup() {
  const store = new Map(Object.entries(NOTES))
  const index = new MemoryIndex()
  index.rebuild([...store.entries()].map(([path, text]): IndexDoc => ({ guid: path, path, text })))
  const docs = new Map<string, EngineDoc>()
  const createFile = vi.fn(async (dir: string) => `${dir}/untitled-1.md`)
  const flash = vi.fn()
  const workspace = {
    ui: { files: [...store.keys()].map((path) => ({ path, guid: path, kind: 'text' as const })) },
    docForPath: (path: string) => {
      if (!store.has(path)) return null
      let doc = docs.get(path)
      if (!doc) {
        doc = fakeDoc(path, index, store)
        docs.set(path, doc)
      }
      return doc
    },
    createFile,
    flash,
  } as unknown as Workspace
  const openPath = vi.fn()
  const shell = fakeViewShell(Date.UTC(2026, 6, 1), { index: () => index, openPath })
  const tab: Tab = { id: 't1', path: 'Competitors.base', pinned: false, cursor: null, scroll: 0, history: [], historyAt: -1 }
  render(CollectionView, {
    props: { workspace, path: 'Competitors.base', tab },
    context: viewShellContext(shell),
  })
  return { store, index, createFile, flash, openPath }
}

const rowNames = (): string[] =>
  screen
    .getAllByTestId(/^collection-row:/)
    .map((el) => el.textContent?.trim() ?? '')

describe('CollectionView', () => {
  it('draws the first view: its columns from the file, its rows from the index', async () => {
    setup()
    await screen.findByTestId('collection-table')
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Direct' })).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())
    expect(headers).toEqual(['Name', 'Threat', 'Depth', 'Verified', 'Active'])
    expect(rowNames()).toEqual(['Ingredifind', 'Quiteful', 'Stale'])
    expect(screen.getByTestId('collection-count').textContent).toContain('3 rows')
    expect(screen.getByTestId('collection-cell:Ingredifind:depth').textContent?.trim()).toBe('Deep')
    expect(screen.getByTestId('collection-cell:Stale:depth').textContent?.trim()).toBe('empty')
    // A boolean is its checkbox.
    expect(screen.getByTestId('collection-cell:Ingredifind:active')).toBeChecked()
    expect(screen.getByTestId('collection-cell:Quiteful:active')).not.toBeChecked()
  })

  it('switches views on the strip and opens a row’s note through the shell', async () => {
    const { openPath } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Direct' }))
    await waitFor(() => expect(rowNames()).toEqual(['Ingredifind', 'Stale']))
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Name', 'Verified'])
    await user.click(screen.getByTestId('collection-row:Competitors/Stale.md'))
    expect(openPath).toHaveBeenCalledWith('Competitors/Stale.md', { background: false })
  })

  it('a header click writes the sort into that view’s node and nothing else', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByTestId('collection-header:threat'))
    const text = store.get('Competitors.base')!
    expect(text).toContain('    sort:\n      - property: threat\n        direction: ASC\n')
    // The global filters, the properties block and the second view are byte-identical.
    expect(text.startsWith(BASE.slice(0, BASE.indexOf('views:')))).toBe(true)
    expect(text.slice(text.indexOf('  - type: table\n    name: Direct'))).toBe(BASE.slice(BASE.indexOf('  - type: table\n    name: Direct')))
  })

  it('a cell edit becomes one frontmatter patch on the note’s live doc', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByTestId('collection-cell:Ingredifind:depth'))
    const input = screen.getByTestId('collection-cell:Ingredifind:depth:input')
    await user.clear(input)
    await user.type(input, 'Shallow{Enter}')
    expect(store.get('Competitors/Ingredifind.md')).toBe(
      '---\nthreat: direct\ndepth: Shallow\nverified: 2026-06-02\nactive: true\n---\n\n# Ingredifind\n'
    )
    // The checkbox writes true/false on the same path.
    await user.click(screen.getByTestId('collection-cell:Quiteful:active'))
    expect(store.get('Competitors/Quiteful.md')).toContain('active: true\n')
    // Escape leaves the note alone.
    await user.click(screen.getByTestId('collection-cell:Stale:depth'))
    await user.type(screen.getByTestId('collection-cell:Stale:depth:input'), 'x{Escape}')
    expect(store.get('Competitors/Stale.md')).toBe(NOTES['Competitors/Stale.md'])
  })

  it('"+ New" creates a note in the view’s folder with the columns as empty keys, and opens it', async () => {
    const { createFile, openPath } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByTestId('collection-new'))
    expect(createFile).toHaveBeenCalledWith('Competitors', undefined, '---\nthreat:\ndepth:\nverified:\nactive:\n---\n\n')
    await waitFor(() => expect(openPath).toHaveBeenCalledWith('Competitors/untitled-1.md'))
  })

  it('groups rows when asked and writes the grouping into the view', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.selectOptions(screen.getByTestId('collection-group'), 'threat')
    expect(store.get('Competitors.base')).toContain('    groupBy:\n      property: threat\n      direction: ASC\n')
  })

  it('says when the file is not a collection, and offers a first view when it has none', async () => {
    const store = new Map([['Empty.base', 'filters: file.hasTag("x")\n']])
    const index = new MemoryIndex()
    const workspace = {
      ui: { files: [] },
      docForPath: (path: string) => (store.has(path) ? fakeDoc(path, index, store) : null),
      createFile: vi.fn(),
      flash: vi.fn(),
    } as unknown as Workspace
    const tab: Tab = { id: 't1', path: 'Empty.base', pinned: false, cursor: null, scroll: 0, history: [], historyAt: -1 }
    render(CollectionView, { props: { workspace, path: 'Empty.base', tab }, context: viewShellContext(fakeViewShell(0, { index: () => index })) })
    expect(screen.getByText(/no views yet/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTestId('collection-add-table'))
    expect(store.get('Empty.base')).toBe('filters: file.hasTag("x")\nviews:\n  - type: table\n    name: All\n    order:\n      - file.name\n')
  })

  it('marks a view the subset cannot fully compute, and still draws its rows', async () => {
    const store = new Map(Object.entries(NOTES))
    store.set('Competitors.base', `${BASE}  - type: table\n    name: Aged\n    order:\n      - file.name\n      - formula.age\n`)
    const index = new MemoryIndex()
    index.rebuild([...store.entries()].map(([path, text]): IndexDoc => ({ guid: path, path, text })))
    const workspace = {
      ui: { files: [] },
      docForPath: (path: string) => (store.has(path) ? fakeDoc(path, index, store) : null),
      createFile: vi.fn(),
      flash: vi.fn(),
    } as unknown as Workspace
    const tab: Tab = { id: 't1', path: 'Competitors.base', pinned: false, cursor: null, scroll: 0, history: [], historyAt: -1 }
    render(CollectionView, { props: { workspace, path: 'Competitors.base', tab }, context: viewShellContext(fakeViewShell(0, { index: () => index })) })
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Aged' }))
    await screen.findByTestId('collection-partly')
    expect(screen.getByTestId('collection-partly')).toHaveAttribute('title', expect.stringContaining('formula.age'))
    expect(within(screen.getByTestId('collection-table')).getAllByTestId(/^collection-row:/)).toHaveLength(3)
    expect(screen.getByTestId('collection-cell:Ingredifind:formula.age').textContent?.trim()).toBe('—')
  })
})
