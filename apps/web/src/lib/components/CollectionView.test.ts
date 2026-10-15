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
      - score
  - type: table
    name: Direct
    filters:
      and:
        - 'threat == "direct"'
    order:
      - file.name
      - verified
  - type: kanban
    name: Board
    groupBy:
      property: depth
      direction: ASC
    order:
      - file.name
      - threat
  - type: list
    name: Quick
    order:
      - file.name
      - threat
  - type: kanban
    name: Active board
    groupBy:
      property: active
      direction: ASC
    order:
      - file.name
  - type: kanban
    name: By folder
    groupBy:
      property: file.folder
      direction: ASC
    order:
      - file.name
`

const NOTES: Record<string, string> = {
  'Competitors.base': BASE,
  'Competitors/Ingredifind.md': '---\nthreat: direct\ndepth: Deep\nverified: 2026-06-02\nactive: true\nscore: 8\n---\n\n# Ingredifind\n',
  'Competitors/Quiteful.md': '---\nthreat: adjacent\ndepth: Moderate\nverified: 2026-03-14\nactive: false\n---\n',
  'Competitors/Stale.md': '---\nthreat: direct\nverified: 2026-01-10\n---\n',
  'Meetings/Weekly.md': '---\nstatus: done\n---\n',
  'Competitors/Nested.md': '---\nmeta:\n  deep: true\nthreat: direct\n---\n',
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

function setup(extra: { embedded?: boolean; viewName?: string | null; scopePath?: string; editable?: boolean } = {}) {
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
  render(CollectionView, {
    props: { workspace, path: 'Competitors.base', ...extra },
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
    expect(headers).toEqual(['Name', 'Threat', 'Depth', 'Verified', 'Active', 'Score'])
    expect(rowNames()).toEqual(['Ingredifind', 'Nested', 'Quiteful', 'Stale'])
    expect(screen.getByTestId('collection-count').textContent).toContain('4 rows')
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
    await waitFor(() => expect(rowNames()).toEqual(['Ingredifind', 'Nested', 'Stale']))
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
      '---\nthreat: direct\ndepth: Shallow\nverified: 2026-06-02\nactive: true\nscore: 8\n---\n\n# Ingredifind\n'
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
    expect(createFile).toHaveBeenCalledWith('Competitors', undefined, '---\nthreat:\ndepth:\nverified:\nactive:\nscore:\n---\n\n')
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
    render(CollectionView, { props: { workspace, path: 'Empty.base' }, context: viewShellContext(fakeViewShell(0, { index: () => index })) })
    expect(screen.getByText(/no views yet/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTestId('collection-add-table'))
    expect(store.get('Empty.base')).toBe('filters: file.hasTag("x")\nviews:\n  - type: table\n    name: Table\n    order:\n      - file.name\n')
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
    render(CollectionView, { props: { workspace, path: 'Competitors.base' }, context: viewShellContext(fakeViewShell(0, { index: () => index })) })
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Aged' }))
    await screen.findByTestId('collection-partly')
    await user.click(screen.getByTestId('collection-partly'))
    expect(screen.getByTestId('collection-partly-detail').textContent).toContain('formula.age')
    expect(within(screen.getByTestId('collection-table')).getAllByTestId(/^collection-row:/)).toHaveLength(4)
    expect(screen.getByTestId('collection-cell:Ingredifind:formula.age').textContent?.trim()).toBe('—')
  })

  it('the view strip is one tab stop: arrows move between views', async () => {
    setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    screen.getByRole('tab', { name: 'All' }).focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Direct' })).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() => expect(rowNames()).toEqual(['Ingredifind', 'Nested', 'Stale']))
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('tabindex', '-1')
  })

  it('a number cell cleared writes an empty value, never "null"; a number typed stays a number', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByTestId('collection-cell:Ingredifind:score'))
    const input = screen.getByTestId('collection-cell:Ingredifind:score:input') as HTMLInputElement
    expect(input.type).toBe('number')
    await user.clear(input)
    await user.keyboard('{Enter}')
    expect(store.get('Competitors/Ingredifind.md')).toContain('\nscore:\n')
    // Focus is back on the cell, so the next edit is one Enter away.
    expect(document.activeElement).toBe(screen.getByTestId('collection-cell:Ingredifind:score'))
    await user.keyboard('{Enter}')
    const again = screen.getByTestId('collection-cell:Ingredifind:score:input')
    await user.clear(again)
    await user.type(again, '9{Enter}')
    expect(store.get('Competitors/Ingredifind.md')).toContain('\nscore: 9\n')
  })

  it('a header click cycles the sort: ascending, descending, none', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    const header = () => screen.getByTestId('collection-header:threat')
    await user.click(header())
    expect(store.get('Competitors.base')).toContain('direction: ASC')
    expect(header().closest('th')).toHaveAttribute('aria-sort', 'ascending')
    await user.click(header())
    expect(store.get('Competitors.base')).toContain('direction: DESC')
    await user.click(header())
    expect(store.get('Competitors.base')).not.toContain('sort:')
    expect(header().closest('th')).not.toHaveAttribute('aria-sort')
  })

  it('a refused write says so and leaves the note and the cell as they were', async () => {
    const { store, flash } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByTestId('collection-cell:Nested:depth'))
    await user.type(screen.getByTestId('collection-cell:Nested:depth:input'), 'Deep{Enter}')
    expect(store.get('Competitors/Nested.md')).toBe(NOTES['Competitors/Nested.md'])
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', text: expect.stringContaining('nested') }))
    // The checkbox of a refused note springs back.
    const box = screen.getByTestId('collection-cell:Nested:active') as HTMLInputElement
    await user.click(box)
    expect(box.checked).toBe(false)
  })

  it('a board view: one column per depth, and moving a card writes that note’s depth', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Board' }))
    await screen.findByTestId('collection-board')
    expect(screen.getAllByTestId(/^board-column:/).map((c) => c.getAttribute('data-testid'))).toEqual([
      'board-column:Deep',
      'board-column:Moderate',
      'board-column:(none)',
    ])
    await user.selectOptions(screen.getByTestId('board-move:Competitors/Stale.md'), 'Deep')
    expect(store.get('Competitors/Stale.md')).toBe('---\nthreat: direct\nverified: 2026-01-10\ndepth: Deep\n---\n')
    await user.selectOptions(screen.getByTestId('board-move:Competitors/Ingredifind.md'), '')
    expect(store.get('Competitors/Ingredifind.md')).toContain('\ndepth:\n')
  })

  it('a list view: names with their values; the Add view menu writes a new view and opens it', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Quick' }))
    await screen.findByTestId('collection-list')
    expect(screen.getByTestId('list-row:Competitors/Ingredifind.md').textContent).toContain('Threat:')
    expect(screen.getByTestId('list-row:Competitors/Ingredifind.md').textContent).toContain('direct')
    await user.click(screen.getByTestId('collection-add-view'))
    await user.click(await screen.findByTestId('collection-add-view:kanban'))
    const text = store.get('Competitors.base')!
    expect(text).toContain('  - type: kanban\n    name: Board 2\n    groupBy:\n      property: threat\n      direction: ASC\n')
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Board 2' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('a board grouped by a boolean moves a card as a boolean, and "no value" clears it', async () => {
    const { store } = setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'Active board' }))
    await screen.findByTestId('collection-board')
    await user.selectOptions(screen.getByTestId('board-move:Competitors/Stale.md'), 'true')
    expect(store.get('Competitors/Stale.md')).toContain('\nactive: true\n')
    await user.selectOptions(screen.getByTestId('board-move:Competitors/Ingredifind.md'), '')
    expect(store.get('Competitors/Ingredifind.md')).toContain('\nactive:\n')
  })

  it('a board grouped by a file field offers no move and says why', async () => {
    setup()
    const user = userEvent.setup()
    await screen.findByTestId('collection-table')
    await user.click(screen.getByRole('tab', { name: 'By folder' }))
    await screen.findByTestId('collection-board')
    expect(screen.getByTestId('board-column:Competitors')).toBeInTheDocument()
    expect(screen.getByTestId('board-move:Competitors/Stale.md')).toBeDisabled()
  })
})

describe('CollectionView embedded in a note (bases-shaping A6)', () => {
  it('shows the named view, read-mostly: cells edit, nothing about the view does', async () => {
    const { store, openPath } = setup({ embedded: true, viewName: 'direct' })
    await screen.findByTestId('collection-table')
    const section = screen.getByTestId('collection-embed')
    expect(section).toHaveAccessibleName('Competitors (collection) — Direct')
    // The view's columns and rows; its name on the caption, which opens the collection's own tab.
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Name', 'Verified'])
    expect(rowNames()).toEqual(['Ingredifind', 'Nested', 'Stale'])
    expect(screen.getByTestId('collection-count').textContent).toContain('3 rows')
    // No tab list, no sort buttons, no grouping, no columns, no new view, no new row.
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: /Sort by/ })).toBeNull()
    expect(screen.queryByTestId('collection-group')).toBeNull()
    expect(screen.queryByTestId('collection-columns')).toBeNull()
    expect(screen.queryByTestId('collection-add-view')).toBeNull()
    expect(screen.queryByTestId('collection-new')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Name' })).not.toHaveAttribute('aria-sort')
    // A cell still writes through the note's own patcher.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('collection-cell:Stale:verified'))
    const input = screen.getByTestId('collection-cell:Stale:verified:input')
    await user.clear(input)
    await user.type(input, '2026-07-01{Enter}')
    expect(store.get('Competitors/Stale.md')).toBe('---\nthreat: direct\nverified: 2026-07-01\n---\n')
    await user.click(screen.getByTestId('collection-embed-open'))
    expect(openPath).toHaveBeenCalledWith('Competitors.base', { background: false })
  })

  it('scrolls inside its own box rather than growing with the collection', async () => {
    setup({ embedded: true })
    await screen.findByTestId('collection-table')
    const body = screen.getByTestId('collection-embed-body')
    expect(body.className).toContain('overflow-auto')
    expect(body.className).toContain('max-h-96')
    // The table's own wrapper no longer claims a height it cannot have inside an auto-height box.
    expect(screen.getByTestId('collection-table').parentElement?.className).not.toContain('h-full')
  })

  it('in a read-only view (Reading) every cell is text and no card moves', async () => {
    setup({ embedded: true, editable: false })
    await screen.findByTestId('collection-table')
    expect(screen.getByTestId('collection-cell:Ingredifind:depth').tagName).toBe('SPAN')
    expect(screen.getByTestId('collection-cell:Ingredifind:active').tagName).toBe('SPAN')
    expect(screen.getByTestId('collection-cell:Ingredifind:active')).toHaveTextContent('true')
    expect(screen.queryByRole('checkbox')).toBeNull()
    // The row's name still opens the note: reading is reading, not a dead end.
    expect(screen.getByTestId('collection-row:Competitors/Ingredifind.md').tagName).toBe('BUTTON')
    cleanup()
    setup({ embedded: true, viewName: 'Board', editable: false })
    await screen.findByTestId('collection-board')
    expect(screen.queryByRole('combobox', { name: /Move .* to/ })).toBeNull()
  })

  it('falls back to the first view when `#view` names none, and says so', async () => {
    setup({ embedded: true, viewName: 'Threat Watch' })
    await screen.findByTestId('collection-table')
    expect(screen.getByTestId('collection-embed')).toHaveAccessibleName('Competitors (collection) — All')
    expect(screen.getByTestId('collection-embed-view-missing')).toHaveTextContent('No view called Threat Watch; showing All.')
    expect(rowNames()).toEqual(['Ingredifind', 'Nested', 'Quiteful', 'Stale'])
  })

  it('shows the first view with no name, and a board embeds with its moves', async () => {
    setup({ embedded: true })
    await screen.findByTestId('collection-table')
    expect(screen.getByTestId('collection-embed')).toHaveAccessibleName('Competitors (collection) — All')
    expect(screen.queryByTestId('collection-embed-view-missing')).toBeNull()
    cleanup()
    setup({ embedded: true, viewName: 'Board' })
    await screen.findByTestId('collection-board')
    expect(screen.getAllByRole('combobox', { name: /Move .* to/ }).length).toBeGreaterThan(0)
  })

  it('scopes `this.file` to the embedding note', async () => {
    const { store } = setup({ embedded: true, viewName: 'Linked', scopePath: 'Meetings/Weekly.md' })
    // A view filtering on `file.hasLink(this.file.name)`: with the collection
    // as scope nothing links to it; scoped to the embedding note, the notes
    // linking there are the rows.
    store.set('Competitors.base', BASE + "  - type: table\n    name: Linked\n    filters:\n      and:\n        - file.hasLink(this.file.name)\n    order:\n      - file.name\n")
    cleanup()
    const index = new MemoryIndex()
    const texts = new Map(store)
    texts.set('Competitors/Ingredifind.md', '---\nthreat: direct\n---\n\nSee [[Weekly]].\n')
    index.rebuild([...texts.entries()].map(([path, text]): IndexDoc => ({ guid: path, path, text })))
    const workspace = {
      ui: { files: [...texts.keys()].map((path) => ({ path, guid: path, kind: 'text' as const })) },
      docForPath: (path: string) => (texts.has(path) ? fakeDoc(path, index, texts) : null),
      createFile: vi.fn(),
      flash: vi.fn(),
    } as unknown as Workspace
    const shell = fakeViewShell(Date.UTC(2026, 6, 1), { index: () => index })
    render(CollectionView, {
      props: { workspace, path: 'Competitors.base', embedded: true, viewName: 'Linked', scopePath: 'Meetings/Weekly.md' },
      context: viewShellContext(shell),
    })
    await screen.findByTestId('collection-table')
    expect(rowNames()).toEqual(['Ingredifind'])
  })
})
