/**
 * The command table's wiring (`shell-commands.ts`): the registration order
 * that lets a later table win a shared key, and the keyboard gate — no vault
 * on screen, a pane mode that owns the keys, and a dialog that must not let
 * a workspace command through (M4).
 */
import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry, type Command } from './commands.js'
import { installShellCommands, type ShellCommandDeps } from './shell-commands.js'

function key(k: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...mods,
  } as unknown as KeyboardEvent
}

const cmd = (id: string, keys?: string, run = vi.fn()): Command => ({ id, title: id, keys, run })

function setup(over: Partial<ShellCommandDeps> = {}) {
  const registry = new CommandRegistry(false)
  const paneCmd = cmd('workspace.close-tab', 'Mod+W')
  const groupCmd = cmd('group.new', 'Mod+G')
  const readCmd = cmd('view.reading', 'Mod+E')
  const state = {
    inWorkspace: true,
    claimed: false,
    handled: false,
    selected: 'a.md' as string | null,
    fileOp: null as unknown,
    addShare: null as unknown,
    settings: 0,
    deviceLink: 0,
    palette: [] as string[],
  }
  const deps: ShellCommandDeps = {
    registry,
    openPalette: (mode) => state.palette.push(mode),
    panes: {
      commands: () => [paneCmd],
      readCommands: () => [readCmd],
      travel: vi.fn(),
      handleKey: () => state.handled,
    },
    groups: { commands: () => [groupCmd], savedCommands: () => [] },
    daily: {
      openToday: vi.fn(async () => {}),
      step: vi.fn(),
      steps: { prev: null, next: 'Daily/x.md' },
    },
    fileOps: {
      createNote: vi.fn(async () => {}),
      set op(v) {
        state.fileOp = v
      },
      get op() {
        return state.fileOp as never
      },
    },
    sharing: {
      set addShareOpen(v) {
        state.addShare = v
      },
      get addShareOpen() {
        return state.addShare as never
      },
    },
    layout: { treeOpen: true, railOpen: false },
    selectedPath: () => state.selected,
    hasWorkspace: () => true,
    inWorkspace: () => state.inWorkspace,
    claimed: () => state.claimed,
    overrides: () => ({}),
    openSettings: () => {
      state.settings++
    },
    openDeviceLink: () => {
      state.deviceLink++
    },
    ...over,
  }
  const shell = installShellCommands(deps)
  return { shell, registry, state, deps, paneCmd, groupCmd, readCmd }
}

describe('installShellCommands', () => {
  it('registers every table, defaults first, and the user overrides on top', () => {
    const { registry, deps } = setup({ overrides: () => ({ 'file.new': 'Mod+Shift+N' }) })
    const ids = registry.bindings().map((b) => b.id)
    expect(ids).toContain('nav.quick-open')
    expect(ids).toContain('workspace.close-tab')
    expect(ids).toContain('group.new')
    expect(ids).toContain('view.reading')
    expect(registry.binding('file.new')).toBe('Ctrl+Shift+N')
    void deps
  })

  it('the defaults reach their targets', () => {
    const { registry, state, deps } = setup()
    const run = (id: string): void => void registry.get(id)!.run()
    run('nav.quick-open')
    run('app.settings')
    run('view.sidebar')
    run('file.delete')
    run('file.new-folder')
    run('share.add')
    run('share.link-device')
    expect(state.palette).toEqual(['quick-open'])
    expect(state.settings).toBe(1)
    expect(deps.layout.treeOpen).toBe(false)
    expect(state.fileOp).toEqual({ type: 'new-folder', dir: '' })
    expect(state.addShare).toEqual({ dir: '' })
    expect(state.deviceLink).toBe(1)
  })

  it('the keyboard is gated: no workspace on screen, or a pane mode that took the key', () => {
    const { shell, state, paneCmd } = setup()
    const e = key('w', { ctrlKey: true })
    state.inWorkspace = false
    shell.onKeydown(e)
    expect(paneCmd.run).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()

    state.inWorkspace = true
    state.handled = true
    shell.onKeydown(e)
    expect(paneCmd.run).not.toHaveBeenCalled()

    state.handled = false
    shell.onKeydown(e)
    expect(paneCmd.run).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.stopPropagation).toHaveBeenCalled()
  })

  it('a claimed keyboard swallows workspace commands but still answers navigation', () => {
    const { shell, state, paneCmd, groupCmd } = setup()
    state.claimed = true
    const close = key('w', { ctrlKey: true })
    shell.onKeydown(close)
    expect(paneCmd.run).not.toHaveBeenCalled()
    expect(close.preventDefault).toHaveBeenCalled() // swallowed, not handed to the browser

    const group = key('g', { ctrlKey: true })
    shell.onKeydown(group)
    expect(groupCmd.run).not.toHaveBeenCalled()

    const quick = key('o', { ctrlKey: true })
    shell.onKeydown(quick)
    expect(state.palette).toEqual(['quick-open'])
  })

  it('an unbound key is left alone', () => {
    const { shell } = setup()
    const e = key('z', { ctrlKey: true, altKey: true })
    shell.onKeydown(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
