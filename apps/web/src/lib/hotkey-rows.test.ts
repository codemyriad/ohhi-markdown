/**
 * Settings › Keys' pure half (settings-shaping ST3): search by name, id and
 * key; search by a pressed chord; the filter chips and their counts; groups;
 * and what a chip edit does to a row's chords.
 */
import { describe, expect, it } from 'vitest'
import { CommandRegistry, type CommandBinding } from './commands.js'
import {
  filterCounts,
  filterRows,
  groupRows,
  isChanged,
  matchesChord,
  matchesText,
  takesTypingKey,
  withChord,
  withoutChord,
} from './hotkey-rows.js'

function world(keymap: Record<string, string[]> = {}) {
  const registry = new CommandRegistry(false)
  registry.register(
    { id: 'view.toggle-source', title: 'Toggle source view', group: 'View', keys: 'Mod+Shift+e', run: () => {} },
    { id: 'view.toggle-reading', title: 'Toggle reading view', group: 'View', keys: 'Mod+e', run: () => {} },
    { id: 'daily.next', title: 'Next daily note', group: 'Daily', keys: 'Mod+Alt+ArrowRight', run: () => {} },
    { id: 'group.new', title: 'New group', run: () => {} }
  )
  registry.setKeymap(keymap)
  const format = (k: string): string => registry.format(k)
  return { rows: registry.bindings(), format }
}

const ids = (rows: CommandBinding[]): string[] => rows.map((r) => r.id)
const all = { text: '', chord: null, filter: 'all' as const }

describe('search', () => {
  it('matches the title, the id and the keys as pressed, every word, any case', () => {
    const { rows, format } = world()
    expect(ids(filterRows(rows, { ...all, text: 'READING' }, format))).toEqual(['view.toggle-reading'])
    expect(ids(filterRows(rows, { ...all, text: 'view.toggle-s' }, format))).toEqual(['view.toggle-source'])
    // `Mod+e` is shown — and found — as Ctrl+E off a Mac.
    expect(ids(filterRows(rows, { ...all, text: 'ctrl+e' }, format))).toEqual(['view.toggle-reading'])
    expect(ids(filterRows(rows, { ...all, text: 'toggle view source' }, format))).toEqual(['view.toggle-source'])
    expect(matchesText(rows[0]!, '   ', format)).toBe(true)
  })

  it('a pressed chord finds what it runs, compared as pressed, and wins over the text', () => {
    const { rows, format } = world()
    expect(ids(filterRows(rows, { ...all, text: 'nothing like it', chord: 'Mod+e' }, format))).toEqual([
      'view.toggle-reading',
    ])
    // Off a Mac `Ctrl+Mod+X` IS Ctrl+Alt+X: the same press finds it.
    expect(matchesChord({ chords: ['Ctrl+Mod+k'] }, 'Mod+Alt+k', format)).toBe(true)
    expect(filterRows(rows, { ...all, chord: 'Mod+q' }, format)).toEqual([])
  })
})

describe('the filter chips', () => {
  it('Changed, Clashes and No key, with counts; a desktop-reserved key is a clash', () => {
    // Source moves onto Reading's key (a clash); New group gains a key.
    const { rows, format } = world({ 'view.toggle-source': ['Mod+e'], 'group.new': ['Alt+g'] })
    expect(isChanged(rows.find((r) => r.id === 'view.toggle-reading')!, format)).toBe(false)
    expect(ids(filterRows(rows, { ...all, filter: 'changed' }, format))).toEqual(['view.toggle-source', 'group.new'])
    expect(ids(filterRows(rows, { ...all, filter: 'clashes' }, format))).toEqual([
      'view.toggle-source',
      'view.toggle-reading',
      // Ctrl+Alt+→ is GNOME's workspace switch (DESKTOP_RESERVED).
      'daily.next',
    ])
    expect(filterCounts(rows, format)).toEqual({ all: 4, changed: 2, clashes: 3, unbound: 0 })
    expect(filterCounts(world().rows, world().format).unbound).toBe(1)
  })

  it('same key written differently is not a change', () => {
    const { rows, format } = world({ 'view.toggle-reading': ['Mod+E'] })
    expect(isChanged(rows.find((r) => r.id === 'view.toggle-reading')!, format)).toBe(false)
  })
})

describe('groups', () => {
  it('buckets in first-seen order, counts the changed rows, and puts the ungrouped under one label', () => {
    const { rows, format } = world({ 'view.toggle-source': [] })
    const groups = groupRows(rows, 'Other', format)
    expect(groups.map((g) => [g.label, g.rows.length, g.changed])).toEqual([
      ['View', 2, 1],
      ['Daily', 1, 0],
      ['Other', 1, 0],
    ])
  })
})

describe('chip edits', () => {
  const format = (k: string): string => new CommandRegistry(false).format(k)
  it('replaces a chip, appends one, and never keeps the same press twice', () => {
    expect(withChord(['Mod+e', 'Alt+e'], 'Mod+k', 0, format)).toEqual(['Mod+k', 'Alt+e'])
    expect(withChord(['Mod+e'], 'Alt+e', 'add', format)).toEqual(['Mod+e', 'Alt+e'])
    expect(withChord(['Mod+e', 'Alt+e'], 'Mod+E', 'add', format)).toEqual(['Mod+e', 'Alt+e'])
    expect(withChord(['Mod+e', 'Alt+e'], 'Mod+e', 1, format)).toEqual(['Mod+e'])
    expect(withoutChord(['Mod+e', 'Alt+e'], 0)).toEqual(['Alt+e'])
  })
})

describe('takesTypingKey (review M5)', () => {
  it('refuses a key that types or edits text unless Mod, Ctrl or Alt is held', () => {
    for (const b of ['q', 'Shift+q', '1', '+', 'Shift++', 'Enter', ' ', 'Shift+ ', 'Backspace', 'Delete']) {
      expect(takesTypingKey(b), b).toBe(true)
    }
    for (const b of ['Mod+q', 'Ctrl+Enter', 'Alt+ ', 'Mod++', 'F2', 'Shift+F5', 'Escape', 'ArrowLeft', 'Ctrl+Mod+Backspace']) {
      expect(takesTypingKey(b), b).toBe(false)
    }
  })
})
