import { describe, expect, it } from 'vitest'
import { MODES, hints, step, type Mode } from './mode.js'

const MODE_NAMES: Mode[] = ['pane', 'move', 'resize', 'tab', 'group']

describe('the mode tables', () => {
  it('binds exactly the shaping doc’s command table', () => {
    expect(MODES.pane.keys).toEqual({
      n: 'workspace.split-auto',
      d: 'workspace.split-down',
      r: 'workspace.split-right',
      x: 'workspace.close-pane',
      f: 'workspace.zoom',
      p: 'workspace.focus-next',
      w: 'workspace.rotate',
      h: 'workspace.focus-left',
      j: 'workspace.focus-down',
      k: 'workspace.focus-up',
      l: 'workspace.focus-right',
    })
    expect(MODES.pane.subs).toEqual({ m: 'move', s: 'resize', t: 'tab', g: 'group' })
    expect(MODES.move.keys).toEqual({
      h: 'workspace.move-left',
      j: 'workspace.move-down',
      k: 'workspace.move-up',
      l: 'workspace.move-right',
    })
    expect(MODES.resize.keys['=']).toBe('workspace.equalize')
    expect(MODES.tab.keys).toMatchObject({
      n: 'tab.new',
      x: 'tab.close',
      '[': 'tab.prev',
      ']': 'tab.next',
      p: 'tab.pin',
      c: 'workspace.close-others',
      r: 'tab.reopen',
      h: 'tab.move-left',
      '1': 'tab.goto-1',
      '9': 'tab.goto-9',
    })
    expect(MODES.group.keys).toEqual({
      n: 'group.new',
      f: 'group.toggle',
      x: 'group.close',
      c: 'group.copy-links',
      u: 'group.ungroup',
    })
  })

  it('makes move and resize sticky and the rest one-shot (Decision 5)', () => {
    expect(MODES.pane.sticky).toBe(false)
    expect(MODES.tab.sticky).toBe(false)
    expect(MODES.group.sticky).toBe(false)
    expect(MODES.move.sticky).toBe(true)
    expect(MODES.resize.sticky).toBe(true)
  })
})

describe('step', () => {
  it('runs every key in every table, and leaves unless the mode is sticky', () => {
    for (const mode of MODE_NAMES) {
      const table = MODES[mode]
      for (const [key, command] of Object.entries(table.keys)) {
        expect(step(mode, key)).toEqual({ mode: table.sticky ? mode : null, command })
      }
    }
  })

  it('enters every sub-mode from pane mode', () => {
    for (const [key, sub] of Object.entries(MODES.pane.subs ?? {})) {
      expect(step('pane', key)).toEqual({ mode: sub })
    }
    // Sub-modes have no sub-modes of their own: `t` in tab mode is a command.
    expect(step('tab', 'm')).toEqual({ mode: 'tab' })
  })

  it('maps the arrows onto hjkl wherever hjkl work', () => {
    expect(step('pane', 'ArrowLeft')).toEqual({ mode: null, command: 'workspace.focus-left' })
    expect(step('pane', 'ArrowDown')).toEqual({ mode: null, command: 'workspace.focus-down' })
    expect(step('move', 'ArrowUp')).toEqual({ mode: 'move', command: 'workspace.move-up' })
    expect(step('resize', 'ArrowRight')).toEqual({ mode: 'resize', command: 'workspace.resize-right' })
    expect(step('tab', 'ArrowLeft')).toEqual({ mode: null, command: 'tab.move-left' })
  })

  it('leaves on Escape and Enter, from sticky modes too', () => {
    for (const mode of MODE_NAMES) {
      expect(step(mode, 'Escape')).toEqual({ mode: null })
      expect(step(mode, 'Enter')).toEqual({ mode: null })
    }
  })

  it('keeps the mode for an unknown key, and for a bare modifier', () => {
    expect(step('pane', 'q')).toEqual({ mode: 'pane' })
    expect(step('move', 'q')).toEqual({ mode: 'move' })
    // Exact key matching: a shifted letter is not the letter.
    expect(step('pane', 'D')).toEqual({ mode: 'pane' })
    for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
      expect(step('resize', key)).toEqual({ mode: 'resize' })
    }
  })

  it('does nothing at all when no mode is live', () => {
    expect(step(null, 'd')).toEqual({ mode: null })
    expect(step(null, 'Escape')).toEqual({ mode: null })
  })
})

describe('hints', () => {
  const rows = (mode: Mode): { key: string; label: string; sub?: boolean }[] =>
    hints(mode, (id) => id)

  it('collapses the four directions onto one hjkl row', () => {
    const pane = rows('pane')
    expect(pane).toContainEqual({ key: 'h j k l', label: 'workspace.focus' })
    expect(pane.filter((h) => h.key.includes('h'))).toHaveLength(1)
    expect(rows('move')).toEqual([{ key: 'h j k l', label: 'workspace.move' }])
    expect(rows('resize')).toEqual([
      { key: 'h j k l', label: 'workspace.resize' },
      { key: '=', label: 'workspace.equalize' },
    ])
  })

  it('collapses go-to-tab onto 1–9', () => {
    const tab = rows('tab')
    expect(tab).toContainEqual({ key: '1–9', label: 'tab.goto' })
    expect(tab).toContainEqual({ key: 'h j k l', label: 'tab.move' })
    expect(tab.filter((h) => /^[0-9]/.test(h.key))).toHaveLength(1)
  })

  it('lists one row per plain key, with the title the caller supplies', () => {
    expect(rows('group')).toEqual([
      { key: 'n', label: 'group.new' },
      { key: 'f', label: 'group.toggle' },
      { key: 'x', label: 'group.close' },
      { key: 'c', label: 'group.copy-links' },
      { key: 'u', label: 'group.ungroup' },
    ])
  })

  it('puts the sub-modes last, labelled by mode id so the bar can translate', () => {
    const pane = rows('pane')
    expect(pane.slice(-4)).toEqual([
      { key: 'm', label: 'mode.move', sub: true },
      { key: 's', label: 'mode.resize', sub: true },
      { key: 't', label: 'mode.tab', sub: true },
      { key: 'g', label: 'mode.group', sub: true },
    ])
  })

  it('asks the caller for a title for every id it prints', () => {
    const asked: string[] = []
    for (const mode of MODE_NAMES) {
      hints(mode, (id) => {
        asked.push(id)
        return id
      })
    }
    // Command ids, family ids for the collapsed rows, mode ids for the subs.
    expect(asked).toContain('tab.goto')
    expect(asked).toContain('mode.resize')
    // `split-down` sits on `d`, not on `j`: it is a command, not a direction.
    expect(asked).toContain('workspace.split-down')
    expect(asked).toContain('workspace.split-right')
    // Nothing that a collapsed row stands in for is asked for by itself.
    expect(asked).not.toContain('workspace.focus-left')
    expect(asked).not.toContain('tab.move-up')
    expect(asked).not.toContain('tab.goto-1')
  })
})
