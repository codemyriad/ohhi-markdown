import { describe, expect, it, vi } from 'vitest'
import { MODES } from './mode.js'
import { familyTitle, paneCommands, type PaneActions } from './pane-commands.js'

function actions(): PaneActions {
  return {
    splitAuto: vi.fn(),
    split: vi.fn(),
    closePane: vi.fn(),
    focus: vi.fn(),
    focusNext: vi.fn(),
    zoom: vi.fn(),
    rotate: vi.fn(),
    movePane: vi.fn(),
    resizePane: vi.fn(),
    equalize: vi.fn(),
    closeOthers: vi.fn(),
    enterMode: vi.fn(),
    newTab: vi.fn(),
    closeTab: vi.fn(),
    stepTab: vi.fn(),
    gotoTab: vi.fn(),
    moveTabTo: vi.fn(),
    pinTab: vi.fn(),
    reopenTab: vi.fn(),
  }
}

describe('the pane/tab command table', () => {
  it("carries Chris's rebinds and Obsidian's unrebound tab defaults, verbatim", () => {
    const keys = new Map(paneCommands(actions()).map((c) => [c.id, c.keys ?? '']))
    expect(keys.get('workspace.split-down')).toBe('Alt+-')
    expect(keys.get('workspace.split-right')).toBe('Alt+=')
    expect(keys.get('workspace.close-pane')).toBe('Ctrl+Mod+Backspace')
    expect(keys.get('workspace.focus-left')).toBe('Ctrl+Mod+ArrowLeft')
    expect(keys.get('workspace.focus-right')).toBe('Ctrl+Mod+ArrowRight')
    expect(keys.get('workspace.close-others')).toBe('Ctrl+Mod+-')
    expect(keys.get('tab.new')).toBe('Mod+t')
    expect(keys.get('tab.close')).toBe('Mod+w')
    expect(keys.get('tab.prev')).toBe('Ctrl+Shift+Tab')
    expect(keys.get('tab.next')).toBe('Ctrl+Tab')
    expect(keys.get('tab.reopen')).toBe('Mod+Shift+t')
    expect(keys.get('workspace.mode')).toBe('Mod+p')
    // Decision 6: go-to-tab reaches the keyboard through the mode only.
    for (let n = 1; n <= 9; n++) expect(keys.get(`tab.goto-${n}`)).toBe('')
  })

  it('registers every command the mode tables name — no dead mode letters', () => {
    const ids = new Set(paneCommands(actions()).map((c) => c.id))
    const missing: string[] = []
    for (const [name, table] of Object.entries(MODES)) {
      for (const id of Object.values(table.keys)) {
        // `group.*` is W2's (C1); everything else must exist now.
        if (id.startsWith('group.')) continue
        if (!ids.has(id)) missing.push(`${name}:${id}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('runs the action the id promises', () => {
    const a = actions()
    const byId = new Map(paneCommands(a).map((c) => [c.id, c]))
    void byId.get('workspace.split-down')!.run()
    expect(a.split).toHaveBeenCalledWith('col')
    void byId.get('workspace.split-right')!.run()
    expect(a.split).toHaveBeenCalledWith('row')
    void byId.get('workspace.focus-up')!.run()
    expect(a.focus).toHaveBeenCalledWith('up')
    void byId.get('workspace.resize-right')!.run()
    expect(a.resizePane).toHaveBeenCalledWith('right')
    void byId.get('tab.move-down')!.run()
    expect(a.moveTabTo).toHaveBeenCalledWith('down')
    void byId.get('tab.next')!.run()
    expect(a.stepTab).toHaveBeenCalledWith(1)
    void byId.get('tab.goto-7')!.run()
    expect(a.gotoTab).toHaveBeenCalledWith(7)
  })

  it('titles every row, under Pane or Tab', () => {
    for (const c of paneCommands(actions())) {
      expect(c.title, c.id).not.toBe('')
      expect(['Pane', 'Tab'], c.id).toContain(c.group)
    }
  })

  it('answers the hint bar for families and sub-modes, and nothing else', () => {
    expect(familyTitle('workspace.focus')).toBe('Focus pane')
    expect(familyTitle('tab.goto')).toBe('Go to tab')
    expect(familyTitle('mode.resize')).toBe('resize…')
    // An id the bar should drop rather than print raw.
    expect(familyTitle('group.new')).toBe('')
  })
})
