/**
 * Tables in the editor (E4): the keys, the `table.*` commands and the Live
 * grid. Commands are asserted on the document they leave, as every other
 * command here is — a table edit must be ordinary text in one transaction.
 */
import { indentUnit } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, type Transaction, type TransactionSpec } from '@codemirror/state'
import { keymap, type Command, type EditorView, type KeyBinding } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { indentListItem, previewMode, runTableCommand } from '../src/index.js'
import {
  cellPosition,
  inTable,
  tableEnterAbove,
  tableEnterBelow,
  tableNextCell,
  tableNextRow,
  tablePrevCell,
} from '../src/preview/table-commands.js'
import { tableHint } from '../src/preview/table-hint.js'
import { decorations, hidden, makeState } from './support.js'

/** Commands touch `view.state` and `view.dispatch` and nothing else. */
function fakeView(state: EditorState) {
  let current = state
  const transactions: Transaction[] = []
  const view = {
    get state() {
      return current
    },
    dispatch: (spec: TransactionSpec) => {
      const tr = current.update(spec)
      transactions.push(tr)
      current = tr.state
    },
  }
  return {
    view: view as unknown as EditorView,
    text: () => current.doc.toString(),
    caret: () => current.selection.main.head,
    transactions,
  }
}

const TABLE = '| a | b |\n|---|:-:|\n| 1 | 2 |\n'

describe('Tab / Shift-Tab / Enter in a table', () => {
  it('Tab aligns the table and moves to the next cell, in one input.table transaction', () => {
    const v = fakeView(makeState(TABLE, { at: 2 }))
    expect(tableNextCell(v.view)).toBe(true)
    expect(v.text()).toBe('| a   |  b  |\n| --- | :-: |\n| 1   |  2  |\n')
    expect(v.transactions).toHaveLength(1)
    expect(v.transactions[0].isUserEvent('input.table')).toBe(true)
    // The caret is at the end of `b`.
    expect(v.text().slice(0, v.caret())).toBe('| a   |  b')
  })

  it('Tab past the last cell adds a row and puts the caret in it', () => {
    const v = fakeView(makeState(TABLE, { at: TABLE.indexOf('2') }))
    expect(tableNextCell(v.view)).toBe(true)
    const lines = v.text().split('\n')
    expect(lines[3]).toBe('|     |     |')
    expect(v.caret()).toBe(v.text().indexOf(lines[3]) + 2)
  })

  it('Shift-Tab goes back a cell, across the delimiter row', () => {
    const v = fakeView(makeState(TABLE, { at: TABLE.indexOf('1') }))
    expect(tablePrevCell(v.view)).toBe(true)
    expect(v.text().slice(0, v.caret())).toBe('| a   |  b')
  })

  it('Enter goes to the same column one row down, adding a row at the end', () => {
    const v = fakeView(makeState(TABLE, { at: TABLE.indexOf('b') }))
    expect(tableNextRow(v.view)).toBe(true)
    expect(v.text().slice(0, v.caret()).split('\n').at(-1)).toBe('| 1   |  2')
    expect(tableNextRow(v.view)).toBe(true)
    expect(v.text().split('\n')).toHaveLength(5)
  })

  it('does nothing outside a table, in Reading, or with several carets', () => {
    expect(tableNextCell(fakeView(makeState('para\n', { at: 1 })).view)).toBe(false)
    const reading = EditorState.create({ doc: TABLE, extensions: [EditorState.readOnly.of(true)] })
    expect(tableNextCell(fakeView(reading).view)).toBe(false)
    const multi = makeState(TABLE, { extensions: [EditorState.allowMultipleSelections.of(true)] }).update({
      selection: EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(6)]),
    }).state
    expect(tableNextCell(fakeView(multi).view)).toBe(false)
  })

  it('rewrites only the table under the caret', () => {
    const doc = `${TABLE}\ntext\n\n| x | y |\n|---|---|\n| 1 | 2 |\n`
    const v = fakeView(makeState(doc, { at: 2 }))
    tableNextCell(v.view)
    expect(v.text().endsWith('\n\ntext\n\n| x | y |\n|---|---|\n| 1 | 2 |\n')).toBe(true)
  })

  it('changes only what moved: the edit is the smallest single replacement', () => {
    const aligned = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'
    const v = fakeView(makeState(aligned, { at: 2 }))
    expect(tableNextCell(v.view)).toBe(true)
    expect(v.text()).toBe(aligned)
    expect(v.transactions[0].docChanged).toBe(false)
  })

  it('keeps a list item’s indent on every line, and gives a new row the same', () => {
    const doc = '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n'
    const v = fakeView(makeState(doc, { at: doc.indexOf('2') }))
    expect(tableNextCell(v.view)).toBe(true)
    expect(v.text()).toBe('- item\n\n  | a   | b   |\n  | --- | --- |\n  | 1   | 2   |\n  |     |     |\n')
  })

  it('keeps a quote’s markers', () => {
    const doc = '> | a |\n> |---|\n> | 1 |\n'
    const v = fakeView(makeState(doc, { at: 4 }))
    expect(tableNextRow(v.view)).toBe(true)
    expect(v.text()).toBe('> | a   |\n> | --- |\n> | 1   |\n')
  })

  it('keeps an escaped pipe inside a cell', () => {
    const doc = '| a | b |\n|---|---|\n| x \\| y | z |\n'
    const v = fakeView(makeState(doc, { at: 2 }))
    tableNextCell(v.view)
    expect(v.text().split('\n')[2]).toBe('| x \\| y | z   |')
  })
})

describe('keymap precedence', () => {
  /**
   * What CM6 does with a key: walk the keymap facet in precedence order and
   * run bindings until one answers true. The real libs/editor list-indent key
   * sits at Prec.high; the table keys must come first on a table line and
   * stand aside everywhere else.
   */
  function press(state: EditorState, key: string): { ran: Command | null; text: string } {
    const v = fakeView(state)
    const maps = state.facet(keymap) as readonly (readonly KeyBinding[])[]
    for (const map of maps) {
      for (const b of map) {
        if (b.key === key && b.run?.(v.view)) return { ran: b.run, text: v.text() }
      }
    }
    return { ran: null, text: v.text() }
  }
  const listTab = Prec.high(keymap.of([{ key: 'Tab', run: indentListItem }]))
  const ext = [listTab, indentUnit.of('\t')]

  it('Tab in a table runs the table key, not list indent — even in a list item', () => {
    const doc = '- item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n'
    const r = press(makeState(doc, { at: doc.indexOf('a |'), extensions: ext }), 'Tab')
    expect(r.ran).toBe(tableNextCell)
  })

  it('Tab on a list line is still list indent', () => {
    const doc = '- one\n- two\n'
    const r = press(makeState(doc, { at: 9, extensions: ext }), 'Tab')
    expect(r.ran).toBe(indentListItem)
    expect(r.text).toBe('- one\n\t- two\n')
  })
})

describe('the table.* commands', () => {
  it('run by id at the caret and answer false outside a table', () => {
    const v = fakeView(makeState(TABLE, { at: 2 }))
    expect(runTableCommand(v.view, 'table.insert-column-right')).toBe(true)
    expect(v.text().split('\n')[1]).toBe('| --- | --- | :-: |')
    expect(runTableCommand(v.view, 'table.delete-column')).toBe(true)
    expect(runTableCommand(fakeView(makeState('x\n')).view, 'table.align')).toBe(false)
  })

  it('inTable says where the palette offers them', () => {
    expect(inTable(makeState(TABLE, { at: 3 }))).toBe(true)
    expect(inTable(makeState(`${TABLE}\npara\n`, { at: TABLE.length + 2 }))).toBe(false)
  })
})

describe('the Live grid', () => {
  const doc = `intro\n\n${TABLE}\nafter\n`

  it('is a grid when the caret is elsewhere — and not atomic, so the keyboard can enter it', () => {
    const state = makeState(doc, { at: 0 })
    const grid = decorations(state).find((d) => d.value === 'TableWidget')
    expect(grid?.kind).toBe('block-widget')
    expect(grid?.text).toBe(TABLE.trimEnd())
    expect(hidden(state).some((h) => h.from === grid?.from)).toBe(false)
  })

  it('is never drawn over the caret: at every offset, a caret in its range shows the source', () => {
    for (let pos = 0; pos <= doc.length; pos++) {
      const over = decorations(makeState(doc, { at: pos }))
        .filter((d) => d.value === 'TableWidget')
        .filter((d) => pos >= d.from && pos <= d.to)
      expect({ pos, over }).toEqual({ pos, over: [] })
    }
  })

  it('is the source when the caret is in it', () => {
    const decos = decorations(makeState(doc, { at: doc.indexOf('1 |') }))
    expect(decos.some((d) => d.value === 'TableWidget')).toBe(false)
    expect(decos.some((d) => d.value === 'cm-table-pipe')).toBe(true)
  })

  it('draws an empty cell in its own column, with the delimiter row’s alignment', () => {
    const state = makeState('| a |  | c |\n|---|:-:|--:|\n| 1 |\n', { mode: 'reading' })
    const w = decorations(state).find((d) => d.value === 'TableWidget')?.widget as {
      rows: { cells: unknown[][] }[]
      aligns: string[]
    }
    expect(w.rows[0].cells.map((c) => c.length)).toEqual([1, 0, 1])
    expect(w.rows[1].cells).toHaveLength(3)
    expect(w.aligns).toEqual(['none', 'center', 'right'])
  })

  it('the arrows step onto a grid’s edge line instead of over the block (Live only)', () => {
    const above = fakeView(makeState(doc, { at: doc.indexOf('\n\n') + 1 }))
    expect(tableEnterBelow(above.view)).toBe(true)
    expect(above.caret()).toBe(doc.indexOf('| a'))
    const below = fakeView(makeState(doc, { at: doc.indexOf('\nafter') }))
    expect(tableEnterAbove(below.view)).toBe(true)
    expect(below.caret()).toBe(doc.indexOf('| 1'))
    // Not next to a table, or in Source: the ordinary arrow.
    expect(tableEnterBelow(fakeView(makeState(doc, { at: 0 })).view)).toBe(false)
    expect(tableEnterBelow(fakeView(makeState(doc, { at: 6, mode: 'source' })).view)).toBe(false)
  })

  it('a click on cell (row, col) lands at the end of that cell’s text', () => {
    const state = makeState(doc, { at: 0 })
    const from = doc.indexOf('|')
    expect(doc.slice(0, cellPosition(state, from, 1, 1)!)).toBe('intro\n\n| a | b |\n|---|:-:|\n| 1 | 2')
    expect(doc.slice(0, cellPosition(state, from, 0, 0)!)).toBe('intro\n\n| a')
  })
})

describe('the hint toolbar', () => {
  it('shows while the caret is in a table, in Live and Source, never in Reading', () => {
    expect(makeState(TABLE, { at: 3 }).field(tableHint)?.pos).toBe(0)
    expect(makeState(TABLE, { at: 3, mode: 'source' }).field(tableHint)).not.toBe(null)
    expect(makeState(`p\n\n${TABLE}`, { at: 0 }).field(tableHint)).toBe(null)
    const reading = makeState(TABLE, {
      at: 3,
      mode: 'reading',
      extensions: [EditorState.readOnly.of(true)],
    })
    expect(reading.field(tableHint)).toBe(null)
    expect(reading.facet(previewMode)).toBe('reading')
  })

  it('keeps the same tooltip while the caret moves inside the table', () => {
    const s = makeState(TABLE, { at: 3 })
    const moved = s.update({ selection: { anchor: 25 } }).state
    expect(moved.field(tableHint)).toBe(s.field(tableHint))
  })
})
