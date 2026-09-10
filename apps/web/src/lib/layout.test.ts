import { describe, expect, it } from 'vitest'
import { LAYOUT_DEFAULTS, TREE_WIDTH, clampTreeWidth, normalizeLayout, toggleFolded } from './layout.js'

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
    expect(normalizeLayout({ treeOpen: false, treeWidth: 400 })).toEqual({
      ...LAYOUT_DEFAULTS,
      treeOpen: false,
      treeWidth: 400,
    })
    expect(normalizeLayout({ railFolded: ['links', 7, null] }).railFolded).toEqual(['links'])
  })

  it('toggles folded sections without duplicates', () => {
    expect(toggleFolded([], 'links', true)).toEqual(['links'])
    expect(toggleFolded(['links'], 'links', true)).toEqual(['links'])
    expect(toggleFolded(['links', 'note'], 'links', false)).toEqual(['note'])
  })
})
