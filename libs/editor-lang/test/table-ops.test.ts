/**
 * The table operations (E4), as text in and text out: these are what Tab,
 * Enter and the `table.*` commands write into the note, so the tests assert
 * the lines themselves.
 */
import { describe, expect, it } from 'vitest'
import {
  alignOf,
  applyTableOp,
  displayWidth,
  formatTable,
  locate,
  offsetIn,
  parseTable,
  splitRow,
} from '../src/preview/table-ops.js'

const texts = (line: string): string[] => splitRow(line).map((c) => c.text)

describe('splitRow', () => {
  it('splits on pipes, with or without the outer ones', () => {
    expect(texts('| a | b |')).toEqual(['a', 'b'])
    expect(texts('a | b')).toEqual(['a', 'b'])
    expect(texts('| a | b')).toEqual(['a', 'b'])
    expect(texts('|---|:-:|')).toEqual(['---', ':-:'])
  })

  it('keeps an escaped pipe as content, escape and all', () => {
    expect(texts('| x \\| y | z |')).toEqual(['x \\| y', 'z'])
  })

  it('keeps empty cells, so column N is cell N', () => {
    expect(texts('| a |  | c |')).toEqual(['a', '', 'c'])
    expect(texts('||')).toEqual([''])
  })

  it('splits inside a code span, as GFM and the grammar do', () => {
    expect(texts('| `a|b` |')).toEqual(['`a', 'b`'])
  })
})

describe('alignOf', () => {
  it('reads the colons', () => {
    expect(alignOf('---')).toBe('none')
    expect(alignOf(':---')).toBe('left')
    expect(alignOf('---:')).toBe('right')
    expect(alignOf(':---:')).toBe('center')
    expect(alignOf(':')).toBe('left')
  })
})

describe('displayWidth', () => {
  it('counts CJK and emoji as two columns, combining marks as none', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('日本語')).toBe(6)
    expect(displayWidth('😀')).toBe(2)
    expect(displayWidth('👨‍👩‍👧')).toBe(2)
    expect(displayWidth('é')).toBe(1)
    expect(displayWidth('©')).toBe(1)
  })
})

describe('formatTable', () => {
  it('pads every column to its widest cell and keeps the alignment row', () => {
    const t = parseTable(['| a | long cell |', '|:-:|--:|', '| xx | 1 |'])!
    expect(formatTable(t)).toEqual([
      '|  a  | long cell |',
      '| :-: | --------: |',
      '| xx  |         1 |',
    ])
  })

  it('pads by display width, so CJK and emoji line up', () => {
    const t = parseTable(['| a | b |', '|---|---|', '| 日本語 | 😀 |'])!
    expect(formatTable(t)).toEqual([
      '| a      | b   |',
      '| ------ | --- |',
      '| 日本語 | 😀  |',
    ])
  })

  it('leaves an escaped pipe and inline markup inside a cell untouched', () => {
    const t = parseTable(['| a | b |', '| --- | --- |', '| x \\| y | **b** |'])!
    expect(formatTable(t)).toEqual([
      '| a      | b     |',
      '| ------ | ----- |',
      '| x \\| y | **b** |',
    ])
  })

  it('fills short rows with empty cells', () => {
    const t = parseTable(['| a | b |', '|---|---|', '| 1 |'])!
    expect(formatTable(t)[2]).toBe('| 1   |     |')
  })

  it('is a fixed point: an aligned table formats to itself', () => {
    const lines = ['| a   |   b |', '| :-- | --: |', '| 1   |   2 |']
    expect(formatTable(parseTable(lines)!)).toEqual(lines)
  })
})

describe('locate / offsetIn', () => {
  const line = '| ab | cd |'

  it('finds the cell and the offset in its content', () => {
    expect(locate(line, 2, 3)).toEqual({ row: 2, col: 0, offset: 1 })
    expect(locate(line, 2, 8)).toEqual({ row: 2, col: 1, offset: 1 })
  })

  it('a caret before a pipe is the end of the cell on its left', () => {
    expect(locate(line, 2, 5)).toEqual({ row: 2, col: 0, offset: 2 })
    expect(locate(line, 2, 6)).toEqual({ row: 2, col: 1, offset: 0 })
  })

  it('puts the caret one space into an empty cell', () => {
    expect(offsetIn('| a |     |', 1, 'end')).toBe(6)
    expect(offsetIn('| ab | cd |', 1, 'end')).toBe(9)
  })
})

describe('applyTableOp', () => {
  const lines = ['| a | b |', '|---|:-:|', '| 1 | 2 |']
  const at = (row: number, col: number) => ({ row, col, offset: 0 })

  it('next-cell aligns and moves right, then down a row', () => {
    const e = applyTableOp(lines, at(0, 0), 'next-cell')!
    expect(e.lines).toEqual(['| a   |  b  |', '| --- | :-: |', '| 1   |  2  |'])
    expect(e.focus).toMatchObject({ row: 0, col: 1 })
    expect(applyTableOp(lines, at(0, 1), 'next-cell')!.focus).toMatchObject({ row: 2, col: 0 })
  })

  it('next-cell past the last cell adds a row at the end', () => {
    const e = applyTableOp(lines, at(2, 1), 'next-cell')!
    expect(e.lines).toHaveLength(4)
    expect(e.lines[3]).toBe('|     |     |')
    expect(e.focus).toMatchObject({ row: 3, col: 0 })
  })

  it('prev-cell moves left, then up past the delimiter row, and stops at the first cell', () => {
    expect(applyTableOp(lines, at(2, 1), 'prev-cell')!.focus).toMatchObject({ row: 2, col: 0 })
    expect(applyTableOp(lines, at(2, 0), 'prev-cell')!.focus).toMatchObject({ row: 0, col: 1 })
    expect(applyTableOp(lines, at(0, 0), 'prev-cell')!.focus).toMatchObject({ row: 0, col: 0 })
  })

  it('next-row keeps the column and adds a row at the end', () => {
    expect(applyTableOp(lines, at(0, 1), 'next-row')!.focus).toMatchObject({ row: 2, col: 1 })
    const e = applyTableOp(lines, at(2, 1), 'next-row')!
    expect(e.lines).toHaveLength(4)
    expect(e.focus).toMatchObject({ row: 3, col: 1 })
  })

  it('inserts and deletes rows and columns, keeping the alignment row', () => {
    const row = applyTableOp(lines, at(2, 0), 'insert-row-below')!
    expect(row.lines).toHaveLength(4)
    expect(row.focus).toMatchObject({ row: 3 })
    const col = applyTableOp(lines, at(0, 0), 'insert-column-right')!
    expect(col.lines[1]).toBe('| --- | --- | :-: |')
    expect(col.focus).toMatchObject({ col: 1 })
    const gone = applyTableOp(lines, at(2, 1), 'delete-column')!
    expect(gone.lines).toEqual(['| a   |', '| --- |', '| 1   |'])
    expect(applyTableOp(['| a |', '|---|'], at(0, 0), 'delete-column')).toBe(null)
    const noBody = applyTableOp(lines, at(2, 0), 'delete-row')!
    expect(noBody.lines).toHaveLength(2)
    expect(noBody.focus.row).toBe(0)
  })

  it('deleting the header empties it rather than removing it', () => {
    const e = applyTableOp(lines, at(0, 0), 'delete-row')!
    expect(e.lines[0]).toBe('|     |     |')
    expect(e.lines).toHaveLength(3)
  })

  it('moves rows and columns, alignment travelling with its column', () => {
    const two = ['| a | b |', '|:--|--:|', '| 1 | 2 |', '| 3 | 4 |']
    expect(applyTableOp(two, at(3, 0), 'move-row-up')!.lines.slice(2)).toEqual(['| 3   |   4 |', '| 1   |   2 |'])
    expect(applyTableOp(two, at(2, 0), 'move-row-up')).toBe(null)
    expect(applyTableOp(two, at(0, 0), 'move-row-down')).toBe(null)
    const moved = applyTableOp(two, at(2, 0), 'move-column-right')!
    expect(moved.lines.slice(0, 3)).toEqual(['|   b | a   |', '| --: | :-- |', '|   2 | 1   |'])
    expect(moved.focus).toMatchObject({ col: 1 })
    expect(applyTableOp(two, at(2, 1), 'move-column-right')).toBe(null)
  })
})
