// @vitest-environment jsdom
/**
 * The list and cards views (DB3): an entry per note, label: value pairs,
 * grouped when the view groups, a grid when it is cards.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Column } from '@ohhi/collections'
import type { PropValue, Row } from '@ohhi/index'
import type { RowGroup } from '../collection-cells.js'
import CollectionList from './CollectionList.svelte'

afterEach(cleanup)

const s = (value: string): PropValue => ({ kind: 'string', value })
const row = (name: string, props: Record<string, PropValue>, mtime: number | null = null): Row => ({
  guid: name,
  path: `Notes/${name}.md`,
  name,
  folder: 'Notes',
  ext: 'md',
  tags: [],
  links: [],
  mtime,
  size: 0,
  props,
})
const COLUMNS: Column[] = [
  { id: 'file.name', label: 'Name', key: { file: 'name' } },
  { id: 'status', label: 'Status', key: { prop: 'status' } },
  { id: 'file.mtime', label: 'Changed', key: { file: 'mtime' } },
]
const GROUPS: RowGroup[] = [
  { key: 'Open', value: s('Open'), rows: [row('A', { status: s('Open') }, Date.UTC(2026, 5, 2))] },
  { key: '', value: undefined, rows: [row('B', {})] },
]

describe('CollectionList', () => {
  it('lists each note with its values, headings per group when grouped', () => {
    render(CollectionList, { props: { groups: GROUPS, columns: COLUMNS, cards: false, grouped: true, viewName: 'Quick', onOpen: vi.fn() } })
    expect(screen.getByTestId('collection-list')).toBeInTheDocument()
    const a = screen.getByTestId('list-row:Notes/A.md')
    expect(within(a).getByText('Status:')).toBeInTheDocument()
    expect(within(a).getByText('Open')).toBeInTheDocument()
    expect(within(a).getByText(new Date(Date.UTC(2026, 5, 2)).toLocaleDateString())).toBeInTheDocument()
    expect(screen.getByText('No value', { exact: false })).toBeInTheDocument()
    // A note with no status shows no status; an unknown modified time shows the dash the table shows.
    const b = screen.getByTestId('list-row:Notes/B.md')
    expect(within(b).queryByText('Status:')).toBeNull()
    expect([...b.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['—'])
  })

  it('cards are the same entries on a grid, ungrouped when the view does not group', () => {
    render(CollectionList, { props: { groups: GROUPS, columns: COLUMNS, cards: true, grouped: false, viewName: 'Gallery', onOpen: vi.fn() } })
    expect(screen.getByTestId('collection-cards')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getAllByRole('list')[0]).toHaveAttribute('aria-label', 'Cards of Gallery')
  })
})
