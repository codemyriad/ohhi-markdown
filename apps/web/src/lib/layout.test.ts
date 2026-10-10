import { describe, expect, it } from 'vitest'
import {
  LAYOUT_DEFAULTS,
  RAIL_SECTIONS,
  TREE_WIDTH,
  clampTreeWidth,
  layoutName,
  normalizeLayout,
  parseLayoutChoice,
  parseLayoutParam,
  railForm,
  railSection,
} from './layout.js'

describe('layout prefs', () => {
  it('clamps the navigator width into its range and defaults garbage', () => {
    expect(clampTreeWidth(100)).toBe(TREE_WIDTH.min)
    expect(clampTreeWidth(10_000)).toBe(TREE_WIDTH.max)
    expect(clampTreeWidth(300.4)).toBe(300)
    expect(clampTreeWidth(NaN)).toBe(TREE_WIDTH.default)
    expect(clampTreeWidth('wide')).toBe(TREE_WIDTH.default)
    expect(clampTreeWidth(undefined)).toBe(TREE_WIDTH.default)
  })

  it('normalizes missing, partial and corrupt config to something usable', () => {
    expect(normalizeLayout(undefined)).toEqual(LAYOUT_DEFAULTS)
    expect(normalizeLayout('nope')).toEqual(LAYOUT_DEFAULTS)
    expect(normalizeLayout({ active: 'custom:dense', treeWidth: 400 })).toEqual({
      ...LAYOUT_DEFAULTS,
      active: 'custom:dense',
      treeWidth: 400,
    })
    // A pre-dock fold list (Round 2 P4) is dropped: the dock has one active tab.
    expect(normalizeLayout({ railFolded: ['links'] })).toEqual(LAYOUT_DEFAULTS)
  })

  it('reads the active layout tolerantly; a pre-layout config resolves to default', () => {
    // The old booleans are not migrated (nothing shipped) — they are dropped.
    expect(normalizeLayout({ treeOpen: false, railOpen: false, treeWidth: 300 })).toEqual({
      ...LAYOUT_DEFAULTS,
      treeWidth: 300,
    })
    expect(normalizeLayout({ active: 'custom:writing chris' }).active).toBe('custom:writing chris')
    expect(normalizeLayout({ active: 'custom:' }).active).toBe('default')
    expect(normalizeLayout({ active: 'custom:../../etc' }).active).toBe('default')
    expect(normalizeLayout({ active: 'workspace' }).active).toBe('default')
    // Round 3 (Q6): one built-in. A stored `light` (round 2's name) or
    // `dense` (a built-in until round 3) keeps working, as `default`.
    expect(parseLayoutChoice('light')).toBe('default')
    expect(parseLayoutChoice('dense')).toBe('default')
    expect(parseLayoutChoice('default')).toBe('default')
    expect(parseLayoutChoice(7)).toBeNull()
    expect(layoutName('custom:writing')).toBe('writing')
    expect(layoutName('default')).toBe('default')
    // …but `?layout=dense` (the e2e fixtures' boot) is the example FILE.
    expect(parseLayoutParam('dense')).toBe('custom:dense')
    expect(parseLayoutParam('light')).toBe('default')
    expect(parseLayoutParam('custom:mine')).toBe('custom:mine')
  })

  it('names the dock tabs and refuses anything else', () => {
    expect(RAIL_SECTIONS).toEqual(['links', 'history', 'comments'])
    expect(railSection('history')).toBe('history')
    expect(railSection('note')).toBeNull()
    expect(railSection(7)).toBeNull()
  })

  it('reads the dock form tolerantly', () => {
    expect(railForm({ rail: 'column' })).toBe('column')
    expect(railForm({ rail: 'dock' })).toBe('dock')
    // A pre-dock file's `menu` is the dock.
    expect(railForm({ rail: 'menu' })).toBe('dock')
  })
})
