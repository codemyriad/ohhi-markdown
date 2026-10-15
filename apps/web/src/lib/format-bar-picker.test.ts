import { describe, expect, it } from 'vitest'
import {
  BAR_CANDIDATES,
  barOverridden,
  hideAt,
  moveBy,
  moveTo,
  pickerRows,
  pillKeys,
  showAt,
  tidyBar,
  withFormatBar,
  withoutFormatBar,
} from './format-bar-picker.js'
import { applyOverrides, LAYOUT_SCHEMA_ID, PRESETS, type LayoutFile } from './layout-spec.js'

const $schema = LAYOUT_SCHEMA_ID
const file = PRESETS.default
const none: LayoutFile = { $schema }

describe('the picker rows (E6)', () => {
  it('the default bar: its items in order; the rest hidden, rule among them', () => {
    const rows = pickerRows(file.bars.format)
    expect(rows.shown).toEqual(file.bars.format)
    expect(rows.hidden).toContain('format.rule')
    expect(rows.hidden).not.toContain('|')
    expect([...rows.shown.filter((id) => id !== '|'), ...rows.hidden].sort()).toEqual([...BAR_CANDIDATES].sort())
  })
  it('offers the paragraph-style menu and every format command', () => {
    expect(BAR_CANDIDATES[0]).toBe('format.paragraph-style')
    expect(BAR_CANDIDATES.every((id) => id.startsWith('format.') || id === 'note.comment')).toBe(true)
    expect(BAR_CANDIDATES.at(-1)).toBe('note.comment')
    expect(BAR_CANDIDATES).toContain('format.highlight')
  })
  it('keeps an id it does not know on the bar', () => {
    expect(pickerRows(['format.someday', 'format.bold']).shown).toEqual(['format.someday', 'format.bold'])
  })
})

describe('moves', () => {
  const bar = ['a', 'b', '|', 'c']
  it('moveBy steps left and right, and stops at the ends', () => {
    expect(moveBy(bar, 1, -1)).toEqual(['b', 'a', '|', 'c'])
    expect(moveBy(bar, 0, 1)).toEqual(['b', 'a', '|', 'c'])
    expect(moveBy(bar, 0, -1)).toEqual(bar)
    expect(moveBy(bar, 3, 1)).toEqual(bar)
  })
  it('moveTo drops at an index (drag)', () => {
    expect(moveTo(bar, 3, 0)).toEqual(['c', 'a', 'b'])
  })
  it('a move that strands a separator at an end tidies it away', () => {
    expect(moveBy(['a', '|', 'b'], 1, -1)).toEqual(['a', 'b'])
  })
  it('hideAt takes an item off; adjacent separators collapse', () => {
    expect(hideAt(['a', '|', 'b', '|', 'c'], 2)).toEqual(['a', '|', 'c'])
    expect(hideAt(bar, 2)).toEqual(['a', 'b', 'c'])
  })
  it('showAt appends, or inserts where dropped; never twice', () => {
    expect(showAt(bar, 'd')).toEqual(['a', 'b', '|', 'c', 'd'])
    expect(showAt(bar, 'd', 1)).toEqual(['a', 'd', 'b', '|', 'c'])
    expect(showAt(bar, 'a')).toEqual(bar)
  })
  it('a separator from the hidden row lands before the last item, where it shows', () => {
    expect(showAt(['a', 'b'], '|')).toEqual(['a', '|', 'b'])
    expect(showAt(['a', 'b'], '|', 1)).toEqual(['a', '|', 'b'])
    expect(showAt([], '|')).toEqual([])
  })
  it('tidyBar collapses runs and trims the ends', () => {
    expect(tidyBar(['|', 'a', '|', '|', 'b', '|'])).toEqual(['a', '|', 'b'])
  })
  it('pillKeys are stable per id and count separators', () => {
    expect(pillKeys(['a', '|', 'b', '|'])).toEqual(['a', '|#0', 'b', '|#1'])
  })
})

describe('the device override it writes', () => {
  it('a full plain list, which the shell lays over the file', () => {
    const bar = ['format.bold', '|', 'format.highlight']
    const o = withFormatBar(none, file, bar)
    expect(o.bars?.format).toEqual(bar)
    expect(o.bars?.format?.some((e) => /^[+-]/.test(e))).toBe(false)
    expect(applyOverrides(file, o).bars.format).toEqual(bar)
    expect(barOverridden(o)).toBe(true)
  })
  it('the file’s own bar is no override at all', () => {
    expect(withFormatBar(none, file, file.bars.format)).toEqual(none)
  })
  it('leaves every other override alone', () => {
    const others: LayoutFile = { $schema, regions: { format: 'top' }, bars: { status: ['words'] } }
    const o = withFormatBar(others, file, ['format.bold'])
    expect(o).toEqual({ $schema, regions: { format: 'top' }, bars: { status: ['words'], format: ['format.bold'] } })
    expect(withoutFormatBar(o)).toEqual(others)
    expect(withFormatBar(o, file, file.bars.format)).toEqual(others)
  })
  it('reset drops the bars key once nothing else is in it', () => {
    const o = withFormatBar(none, file, ['format.bold'])
    expect(withoutFormatBar(o)).toEqual(none)
    expect(withoutFormatBar(none)).toBe(none)
  })
})
