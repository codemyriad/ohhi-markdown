import { describe, expect, it, vi } from 'vitest'
import { MODES } from './mode.js'
import { FORMAT_COMMANDS } from '@ohhi/editor'
import { TABLE_COMMANDS } from '@ohhi/editor-lang'
import { CommandRegistry } from './commands.js'
import {
  familyTitle,
  formatCommands,
  groupCommands,
  paneCommands,
  tableCommands,
  type FormatActions,
  type GroupActions,
  type PaneActions,
} from './pane-commands.js'

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

function groupActions(hasGroup = true): GroupActions {
  return {
    newFromActive: vi.fn(),
    toggle: vi.fn(),
    close: vi.fn(),
    copyLinks: vi.fn(),
    ungroup: vi.fn(),
    move: vi.fn(),
    hasGroup: () => hasGroup,
  }
}

describe('the pane/tab command table', () => {
  it("carries Obsidian's tab defaults and VS Code's split; the rest reach the keyboard through the mode", () => {
    const keys = new Map(paneCommands(actions()).map((c) => [c.id, c.keys ?? '']))
    // QA round 2 (2026-10-16): no default takes a key the editor, the browser
    // or the desktop already uses — Chris's own rebinds are his keymap file's.
    expect(keys.get('workspace.split-down')).toBe('')
    expect(keys.get('workspace.split-right')).toBe('Mod+\\')
    expect(keys.get('workspace.close-pane')).toBe('')
    expect(keys.get('workspace.focus-left')).toBe('')
    expect(keys.get('workspace.focus-right')).toBe('')
    expect(keys.get('workspace.close-others')).toBe('')
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
    const ids = new Set(
      [...paneCommands(actions()), ...groupCommands(groupActions())].map((c) => c.id)
    )
    const missing: string[] = []
    for (const [name, table] of Object.entries(MODES)) {
      for (const id of Object.values(table.keys)) {
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

describe('the group command table (W2)', () => {
  it('ships the two keys the shaping doc names, and nothing else', () => {
    const keys = new Map(groupCommands(groupActions()).map((c) => [c.id, c.keys ?? '']))
    expect(keys.get('group.new')).toBe('Mod+Shift+g')
    expect(keys.get('group.toggle')).toBe('Mod+Shift+e')
    expect(keys.get('group.close')).toBe('')
    expect(keys.get('group.copy-links')).toBe('')
    expect(keys.get('group.ungroup')).toBe('')
  })

  it('hides every verb that needs a group when the active tab has none', () => {
    const off = groupCommands(groupActions(false))
    expect(off.filter((c) => !c.when || c.when()).map((c) => c.id)).toEqual(['group.new'])
    const on = groupCommands(groupActions(true))
    expect(on.every((c) => !c.when || c.when())).toBe(true)
  })

  it('carries a whole group to a neighbouring pane, so a chip drag has a key (R8)', () => {
    const a = groupActions()
    const byId = new Map(groupCommands(a).map((c) => [c.id, c]))
    for (const side of ['left', 'down', 'up', 'right'] as const) {
      expect(byId.has(`group.move-${side}`), side).toBe(true)
      // No flat key: the mode letter and the popover row are the two routes.
      expect(byId.get(`group.move-${side}`)!.keys ?? '').toBe('')
    }
    void byId.get('group.move-right')!.run()
    expect(a.move).toHaveBeenCalledWith('right')
    // …and the mode's `g` sub-mode names them, which the table assertion above
    // would have caught the other way round.
    expect(Object.values(MODES.group.keys)).toContain('group.move-left')
  })

  it('titles every row under Group', () => {
    for (const c of groupCommands(groupActions())) {
      expect(c.title, c.id).not.toBe('')
      expect(c.group, c.id).toBe('Group')
    }
  })

  it('runs the action the id promises', () => {
    const a = groupActions()
    const byId = new Map(groupCommands(a).map((c) => [c.id, c]))
    void byId.get('group.new')!.run()
    expect(a.newFromActive).toHaveBeenCalled()
    void byId.get('group.copy-links')!.run()
    expect(a.copyLinks).toHaveBeenCalled()
  })
})

describe('the format command table (quiet-shell F4)', () => {
  function formatActions(can = true): FormatActions & { ran: string[] } {
    const ran: string[] = []
    return { ran, canFormat: () => can, format: (id) => void ran.push(id) }
  }

  it('is FORMAT_COMMANDS, in order, each with a title and the Format group', () => {
    const rows = formatCommands(formatActions())
    expect(rows.map((r) => r.id)).toEqual(FORMAT_COMMANDS.map((c) => c.id))
    for (const row of rows) {
      expect(row.title).not.toBe('')
      expect(row.group).toBe('Format')
    }
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length)
  })

  it('binds Obsidian’s three keys plus E6’s free chords, and leaves the rest unbound', () => {
    const bound = formatCommands(formatActions())
      .filter((r) => r.keys)
      .map((r) => [r.id, r.keys])
    expect(bound).toEqual([
      ['format.bold', 'Mod+b'],
      ['format.italic', 'Mod+i'],
      ['format.strike', 'Mod+Shift+x'],
      ['format.highlight', 'Mod+Shift+h'],
      ['format.list', 'Mod+Shift+8'],
      ['format.ordered-list', 'Mod+Shift+7'],
      ['format.link', 'Mod+k'],
    ])
  })

  it('runs the command by id in the focused view', () => {
    const a = formatActions()
    for (const row of formatCommands(a)) void row.run()
    expect(a.ran).toEqual(FORMAT_COMMANDS.map((c) => c.id))
  })

  it('is hidden and its keys fall through when no editable note has the focus', () => {
    const registry = new CommandRegistry(false)
    let can = true
    registry.register(...formatCommands({ canFormat: () => can, format: () => {} }))
    const modB = { key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
    expect(registry.match(modB)?.id).toBe('format.bold')
    expect(registry.available().some((c) => c.id.startsWith('format.'))).toBe(true)

    can = false
    expect(registry.match(modB)).toBeNull()
    expect(registry.available().some((c) => c.id.startsWith('format.'))).toBe(false)
    // …but still listed in the hotkeys tab, where it can be rebound.
    expect(registry.bindings().filter((b) => b.id.startsWith('format.'))).toHaveLength(FORMAT_COMMANDS.length)
  })
})

describe('the table command table (editor-usability E4)', () => {
  it('is TABLE_COMMANDS, in order, titled, in the Table group, with no key', () => {
    const rows = tableCommands({ canFormat: () => true, inTable: () => true, table: () => {} })
    expect(rows.map((r) => r.id)).toEqual(TABLE_COMMANDS.map((c) => c.id))
    for (const row of rows) {
      expect(row.title).not.toBe('')
      expect(row.group).toBe('Table')
      expect(row.keys).toBeUndefined()
    }
    expect(new Set(rows.map((r) => r.title)).size).toBe(rows.length)
  })

  it('is offered only while the caret is in a table of an editable note, and runs by id', () => {
    const registry = new CommandRegistry(false)
    let inTable = false
    const ran: string[] = []
    registry.register(
      ...tableCommands({ canFormat: () => true, inTable: () => inTable, table: (id) => void ran.push(id) })
    )
    expect(registry.available().some((c) => c.id.startsWith('table.'))).toBe(false)
    inTable = true
    const row = registry.available().find((c) => c.id === 'table.align')
    expect(row).toBeDefined()
    void row!.run()
    expect(ran).toEqual(['table.align'])
  })
})
