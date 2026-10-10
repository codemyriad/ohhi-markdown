// @vitest-environment jsdom
/**
 * The board (DB3): a column per group value, a card per note, and a move —
 * by drag or by the keyboard's select — that is one property edit.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Column } from '@ohhi/collections'
import type { PropValue, Row } from '@ohhi/index'
import type { RowGroup } from '../collection-cells.js'
import CollectionBoard from './CollectionBoard.svelte'

afterEach(cleanup)

const s = (value: string): PropValue => ({ kind: 'string', value })
const row = (name: string, props: Record<string, PropValue>): Row => ({
  guid: name,
  path: `Meetings/${name}.md`,
  name,
  folder: 'Meetings',
  ext: 'md',
  tags: [],
  links: [],
  mtime: null,
  size: 0,
  props,
})
const COLUMNS: Column[] = [
  { id: 'file.name', label: 'Name', key: { file: 'name' } },
  { id: 'status', label: 'Status', key: { prop: 'status' } },
  { id: 'owner', label: 'Owner', key: { prop: 'owner' } },
]
const GROUPS: RowGroup[] = [
  { key: 'Prep', rows: [row('Monday', { status: s('Prep'), owner: s('Ana') })] },
  { key: 'Done', rows: [row('Friday', { status: s('Done') })] },
  { key: '', rows: [row('Someday', {})] },
]

function show() {
  const onMove = vi.fn()
  const onOpen = vi.fn()
  render(CollectionBoard, { props: { groups: GROUPS, columns: COLUMNS, groupId: 'status', viewName: 'Board', onOpen, onMove } })
  return { onMove, onOpen }
}

describe('CollectionBoard', () => {
  it('draws a column per group with its cards, the grouping property not repeated on the card', () => {
    show()
    const prep = screen.getByTestId('board-column:Prep')
    expect(prep).toHaveAttribute('aria-label', 'Prep — 1 note')
    expect(within(prep).getByText('Monday')).toBeInTheDocument()
    expect(within(prep).getByText('Ana')).toBeInTheDocument()
    expect(within(prep).queryByText('Prep', { selector: 'p *' })).toBeNull()
    expect(screen.getByTestId('board-column:(none)')).toHaveAttribute('aria-label', 'No value — 1 note')
  })

  it('the select on a card moves it by keyboard', async () => {
    const { onMove } = show()
    await userEvent.setup().selectOptions(screen.getByTestId('board-move:Meetings/Monday.md'), 'Done')
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Monday' }), 'Done')
  })

  it('a drag from one column to another is the same move; dropping on "no value" clears', async () => {
    const { onMove } = show()
    const card = screen.getByTestId('board-card:Meetings/Monday.md')
    await fireEvent.dragStart(card)
    await fireEvent.dragOver(screen.getByTestId('board-column:Done'))
    await fireEvent.drop(screen.getByTestId('board-column:Done'))
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ name: 'Monday' }), 'Done')
    await fireEvent.dragStart(screen.getByTestId('board-card:Meetings/Friday.md'))
    await fireEvent.drop(screen.getByTestId('board-column:(none)'))
    expect(onMove).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Friday' }), '')
  })

  it('a card’s name opens the note', async () => {
    const { onOpen } = show()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Friday' }))
    expect(onOpen).toHaveBeenCalledWith('Meetings/Friday.md', { background: false })
  })
})
