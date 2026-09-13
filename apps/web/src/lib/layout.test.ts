import { describe, expect, it } from 'vitest'
import {
  LAYOUT_DEFAULTS,
  RAIL_SECTIONS,
  TREE_WIDTH,
  clampTreeWidth,
  normalizeLayout,
  showOnly,
  toggleFolded,
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

  it('folds everything but the section asked for', () => {
    // The rail icon's whole job: this one, and nothing else (P2).
    expect(showOnly(RAIL_SECTIONS, 'note')).toEqual(['links', 'activity', 'history'])
    // Asking for the section that is already the only open one changes
    // nothing — which is why the rail collapses on that click instead.
    expect(showOnly(RAIL_SECTIONS, 'links')).toEqual(LAYOUT_DEFAULTS.railFolded)
    // An id that is not a section folds them all rather than throwing.
    expect(showOnly(RAIL_SECTIONS, 'nope')).toEqual([...RAIL_SECTIONS])
    expect(showOnly([], 'links')).toEqual([])
  })

  it('opens exactly one section on a fresh install', () => {
    // A fresh device shows Links alone; the stack of four was the jumble.
    expect(LAYOUT_DEFAULTS.railFolded).toEqual(['note', 'activity', 'history'])
    expect(RAIL_SECTIONS.filter((id) => !LAYOUT_DEFAULTS.railFolded.includes(id))).toEqual(['links'])
    // Corrupt config falls back to that default, and never to a shared array.
    // The pre-P2 default (`[]`, every section open) migrates to the new one.
    expect(normalizeLayout({ railFolded: [] }).railFolded).toEqual(LAYOUT_DEFAULTS.railFolded)
    const fallback = normalizeLayout({ railFolded: 'all' }).railFolded
    expect(fallback).toEqual(LAYOUT_DEFAULTS.railFolded)
    expect(fallback).not.toBe(LAYOUT_DEFAULTS.railFolded)
  })
})
