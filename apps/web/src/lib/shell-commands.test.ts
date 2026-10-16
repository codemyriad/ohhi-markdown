/**
 * The command table's wiring (`shell-commands.ts`): the registration order
 * that lets a later table win a shared key, and the keyboard gate — no vault
 * on screen, a pane mode that owns the keys, and a dialog that must not let
 * a workspace command through (M4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry, type Command } from './commands.js'
import { PRESETS } from './layout-spec.js'
import { harnessCommands, installShellCommands, layoutFileSource, type ShellCommandDeps } from './shell-commands.js'
import { bindEditor, resetEditors, type EditorView } from './focused-editor.svelte.js'
import { harness } from './sessions.svelte.js'
import { VIEW_KINDS } from './panes.js'
import { VIEWS } from './views.js'
import { getLL } from '@ohhi/i18n'
import { setAiConfig } from './ai-config.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'

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
  const formatCmd = cmd('format.bold', 'Mod+B')
  const state = {
    inWorkspace: true,
    claimed: false,
    handled: false,
    selected: 'a.md' as string | null,
    fileOp: null as unknown,
    addShare: null as unknown,
    shareSheet: null as string | null,
    mounts: [] as { path: string }[],
    deviceLink: 0,
    palette: [] as string[],
  }
  const deps: ShellCommandDeps = {
    registry,
    openPalette: (mode) => state.palette.push(mode),
    panes: {
      commands: () => [paneCmd],
      readCommands: () => [readCmd],
      formatCommands: () => [formatCmd],
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
      createCollection: vi.fn(async () => {}),
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
      set folderSharePath(v) {
        state.shareSheet = v
      },
      get folderSharePath() {
        return state.shareSheet
      },
    },
    mounts: () => state.mounts,
    layout: { treeOpen: true, railOpen: false, spec: PRESETS.default },
    selectedPath: () => state.selected,
    hasWorkspace: () => true,
    inWorkspace: () => state.inWorkspace,
    claimed: () => state.claimed,
    openDeviceLink: () => {
      state.deviceLink++
    },
    openView: vi.fn(),
    devtools: () => false,
    ...over,
  }
  const shell = installShellCommands(deps)
  return { shell, registry, state, deps, paneCmd, groupCmd, readCmd, formatCmd }
}

describe('installShellCommands', () => {
  it('registers every table, defaults first, and the active keymap on top', () => {
    const { registry, deps } = setup()
    // The keymap is applied by keymap.svelte.ts, before or after the tables register.
    registry.setKeymap({ 'file.new': ['Mod+Shift+N'] })
    const ids = registry.bindings().map((b) => b.id)
    expect(ids).toContain('nav.quick-open')
    expect(ids).toContain('workspace.close-tab')
    expect(ids).toContain('group.new')
    expect(ids).toContain('view.reading')
    // Format last: its keys are its own.
    expect(ids.at(-1)).toBe('format.bold')
    expect(registry.binding('file.new')).toBe('Ctrl+Shift+N')
    void deps
  })

  it('app.reload-resources is in the palette when the shell can reload, and runs it', () => {
    expect(setup().registry.get('app.reload-resources')).toBeUndefined()
    const reloadResources = vi.fn()
    const { registry } = setup({ reloadResources })
    const row = registry.get('app.reload-resources')!
    expect(row.title).toBe('Reload layouts and resources')
    void row.run()
    expect(reloadResources).toHaveBeenCalledOnce()
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
    // Settings is a view tab (settings-shaping ST1): `app.settings` is its row.
    expect(deps.openView).toHaveBeenCalledWith('settings', undefined)
    expect(deps.layout.treeOpen).toBe(false)
    expect(state.fileOp).toEqual({ type: 'new-folder', dir: '' })
    expect(state.addShare).toEqual({ dir: '' })
    expect(state.deviceLink).toBe(1)
  })

  it('Share this folder… opens the sheet on the note\'s folder, or the shared folder around it, and never on the root', () => {
    const { registry, state } = setup()
    // A top-level note has no folder to share: the row is not offered.
    expect(registry.get('share.folder')!.when!()).toBe(false)

    state.selected = 'notes/raft/one.md'
    void registry.get('share.folder')!.run()
    expect(state.shareSheet).toBe('notes/raft')

    // Inside a shared folder, the sheet is that folder's — not a nested share.
    state.mounts = [{ path: '' }, { path: 'notes' }]
    void registry.get('share.folder')!.run()
    expect(state.shareSheet).toBe('notes')
  })

  it('generates one palette row per registered view, gated by its own `when`', () => {
    let devtools = false
    const { registry, deps } = setup({ devtools: () => devtools })
    for (const id of VIEW_KINDS) {
      const row = registry.get(VIEWS[id].command.id)
      expect(row, id).toBeDefined()
      void row!.run()
      // A session opens on one: the current session, else a fresh id.
      expect(deps.openView).toHaveBeenLastCalledWith(id, id === 'session' ? expect.any(String) : undefined)
    }
    // The inspector keeps its id and is listed only while developer tools are on.
    expect(registry.available().some((c) => c.id === 'app.inspector')).toBe(false)
    devtools = true
    expect(registry.available().some((c) => c.id === 'app.inspector')).toBe(true)
    // The Log view is for everyone (quiet-shell F12): listed with developer tools off too.
    devtools = false
    expect(registry.available().some((c) => c.id === 'app.log')).toBe(true)
  })

  it('the writing harness is quiet with no provider, and a new session opens its tab (R1)', async () => {
    useMemStorage()
    try {
      const flash = vi.fn()
      const { registry, deps } = setup({ flash })
      // (`ai.accept-suggestion` is also gated on the caret being in a suggestion — suggestions.test.ts.)
      const harness = ['app.session', 'ai.new-session', 'ai.accept-all', 'ai.accept-suggestion']
      const offered = (id: string): boolean => registry.available().some((c) => c.id === id)
      for (const id of harness) {
        expect(registry.get(id), id).toBeDefined()
        expect(offered(id), id).toBe(false)
      }
      setAiConfig({ providers: [{ id: 'p', name: 'P', kind: 'openai', baseUrl: '', model: 'm' }] })
      for (const id of harness.slice(0, 3)) expect(offered(id), id).toBe(true)
      // No selection to capture: a bare session, in its own tab.
      await registry.get('ai.new-session')!.run()
      expect(deps.openView).toHaveBeenLastCalledWith('session', expect.any(String))
      // Nothing running: Stop says so rather than doing nothing.
      await registry.get('ai.stop-run')!.run()
      expect(flash).toHaveBeenCalledWith({ level: 'info', text: getLL().web.ai.session.nothing_running() })
    } finally {
      dropStorage()
    }
  })

  it('comments are not AI-gated: note.comment exists with no provider, on Mod+Shift+M, offered once a note is in an editor', () => {
    useMemStorage()
    try {
      const { registry } = setup({})
      const row = registry.get('note.comment')
      expect(row).toMatchObject({ keys: 'Mod+Shift+M' })
      // No editor bound → nothing to comment on, provider or not.
      expect(registry.available().some((c) => c.id === 'note.comment')).toBe(false)
      setAiConfig({ providers: [{ id: 'p', name: 'P', kind: 'openai', baseUrl: '', model: 'm' }] })
      expect(registry.available().some((c) => c.id === 'note.comment')).toBe(false)
    } finally {
      dropStorage()
    }
  })

  it('offers only the views the layout lists (an empty list offers them all)', () => {
    const layout = { treeOpen: true, railOpen: false, spec: { ...PRESETS.default, views: ['log'] } }
    const { registry } = setup({ devtools: () => true, layout })
    const offered = (id: string): boolean => registry.available().some((c) => c.id === id)
    expect(offered('app.log')).toBe(true)
    expect(offered('app.shared')).toBe(false)
    expect(offered('app.inspector')).toBe(false)
    // Settings is never hidden by a layout: it is where a layout is changed back.
    expect(offered('app.settings')).toBe(true)
    // The row keeps its id (a keymap may still name it); the layout decides.
    expect(registry.get('app.shared')).toBeDefined()
    layout.spec = { ...PRESETS.default, views: [] }
    expect(offered('app.shared')).toBe(true)
    expect(offered('app.inspector')).toBe(true)
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

  it('a format key runs once, and never from inside a dialog or text field', () => {
    const { shell, state, formatCmd } = setup()
    const bold = key('b', { ctrlKey: true })
    shell.onKeydown(bold)
    expect(formatCmd.run).toHaveBeenCalledTimes(1)
    // Stopped in the capture phase, so the editor's own Mod-b never sees it.
    expect(bold.stopPropagation).toHaveBeenCalled()

    state.claimed = true
    shell.onKeydown(key('b', { ctrlKey: true }))
    expect(formatCmd.run).toHaveBeenCalledTimes(1)
  })

  it('an unbound key is left alone', () => {
    const { shell } = setup()
    const e = key('z', { ctrlKey: true, altKey: true })
    shell.onKeydown(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})

describe('installShellCommands — Focus mode (quiet-shell F7)', () => {
  function withFocus() {
    const focus = { on: false }
    const focusMode = {
      active: () => focus.on,
      toggle: vi.fn(() => void (focus.on = !focus.on)),
      leave: vi.fn(() => void (focus.on = false)),
    }
    return { focus, focusMode, ...setup({ focusMode }) }
  }

  it('view.focus is a View command on Mod+. that toggles it', () => {
    const { registry, shell, focus } = withFocus()
    const row = registry.get('view.focus')!
    expect(row.title).toBe('Toggle Focus mode')
    expect(registry.binding('view.focus')).toBe('Ctrl+.')
    shell.onKeydown(key('.', { ctrlKey: true }))
    expect(focus.on).toBe(true)
    expect(setup().registry.get('view.focus')).toBeUndefined()
  })

  it('Escape leaves it, in the capture phase, and only while it is on', () => {
    const { shell, focus, focusMode } = withFocus()
    const idle = key('Escape')
    shell.onKeydown(idle)
    expect(focusMode.leave).not.toHaveBeenCalled()
    expect(idle.stopPropagation).not.toHaveBeenCalled()

    focus.on = true
    const esc = key('Escape')
    shell.onKeydown(esc)
    expect(focusMode.leave).toHaveBeenCalledOnce()
    expect(esc.stopPropagation).toHaveBeenCalled()
  })

  it('Escape belongs to a dialog, a field or a pane mode first', () => {
    const { shell, focus, focusMode, state } = withFocus()
    focus.on = true
    state.claimed = true
    shell.onKeydown(key('Escape'))
    state.claimed = false
    state.handled = true
    shell.onKeydown(key('Escape'))
    expect(focusMode.leave).not.toHaveBeenCalled()
    expect(focus.on).toBe(true)
  })
})

describe('templates (quiet-shell F11)', () => {
  it('template.insert opens the template picker; each file is a palette row, not a binding', () => {
    const rows = [cmd('template:meeting'), cmd('template:daily')]
    const { registry, state } = setup({ templates: { commands: () => rows } })
    void registry.get('template.insert')?.run()
    expect(state.palette).toEqual(['templates'])
    expect(registry.available().map((c) => c.id)).toEqual(expect.arrayContaining(['template:meeting', 'template:daily']))
    // A provider's rows take no part in the bindings table.
    expect(registry.bindings().map((b) => b.id)).not.toContain('template:meeting')
    expect(registry.bindings().map((b) => b.id)).toContain('template.insert')
  })
})

describe('Use layout file… (round 3, Q6)', () => {
  const entries = [
    { name: 'default', root: 'builtin' as const, path: 'built-in', shadows: [] },
    { name: 'columns', root: 'vault' as const, path: '.ohhi/layouts/columns.json', shadows: [] },
  ]

  it('layout.use-file opens the layout picker', () => {
    const { registry, state } = setup()
    const row = registry.get('layout.use-file')!
    expect(row.title).toBe('Use layout file…')
    void row.run()
    expect(state.palette).toEqual(['layouts'])
  })

  it('lists Default and every file the roots offer, the one in use marked; a pick sets the device choice', async () => {
    const layout = { active: 'default' as const, setActive: vi.fn(async () => {}) }
    const source = layoutFileSource({ list: async () => entries }, layout)
    expect(await source.rows()).toEqual([
      { name: 'default', title: 'Default', active: true, root: 'builtin', shadows: [] },
      {
        name: 'custom:columns',
        title: 'columns',
        subtitle: '.ohhi/layouts/columns.json',
        active: false,
        root: 'vault',
        shadows: [],
      },
    ])
    source.use('custom:columns')
    expect(layout.setActive).toHaveBeenCalledWith('custom:columns')
    source.use('default')
    expect(layout.setActive).toHaveBeenLastCalledWith('default')
    source.use('../nope')
    expect(layout.setActive).toHaveBeenCalledTimes(2)
  })
  it('names each file’s root, what it shadows, and a file Settings › Customise lists as a problem (ST6)', async () => {
    const layout = { active: 'default' as const, setActive: vi.fn(async () => {}) }
    const overview = vi.fn(async () => ({
      roots: [],
      entries: {
        layouts: [
          { name: 'default', root: 'builtin' as const, path: 'built-in', shadows: [] },
          { name: 'focus', root: 'vault' as const, path: '.ohhi/layouts/focus.json', shadows: [] },
          { name: 'writing', root: 'user' as const, path: '~/.config/ohhi/layouts/writing.json', shadows: ['builtin' as const] },
        ],
        keymaps: [],
        templates: [],
      },
      problems: [
        { kind: 'layouts' as const, name: 'focus', root: 'vault' as const, path: '.ohhi/layouts/focus.json', message: 'x' },
        { kind: 'keymaps' as const, name: 'writing', root: 'vault' as const, path: '.ohhi/keymaps/writing.json', message: 'y' },
      ],
    }))
    const list = vi.fn(async () => entries)
    const rows = await layoutFileSource({ list, overview }, layout).rows()
    expect(list).not.toHaveBeenCalled()
    expect(rows.map((r) => [r.name, r.root, r.shadows, r.broken ?? false])).toEqual([
      ['default', 'builtin', [], false],
      ['custom:focus', 'vault', [], true],
      ['custom:writing', 'user', ['builtin'], false],
    ])
  })
})

describe('ai.add-selection in a split', () => {
  /** A view's state as the capture reads it: the note's text and its main selection. */
  const viewOver = (text: string, from: number, to: number) =>
    ({ state: { doc: { toString: () => text }, selection: { main: { from, to } } } }) as unknown as EditorView

  afterEach(() => {
    resetEditors()
    harness.inbox = {}
    harness.current = null
  })

  it('captures the focused pane’s selection, not the first editor on screen', async () => {
    const left = 'Left note.\nNothing here.\n'
    const right = 'Right note.\nPick this line.\nAnd not this.\n'
    bindEditor({ paneId: 'p1', path: 'left.md', view: viewOver(left, 0, 4), focused: false })
    bindEditor({ paneId: 'p2', path: 'right.md', view: viewOver(right, right.indexOf('Pick'), right.indexOf('Pick') + 4), focused: true })
    const openView = vi.fn()
    const rows = harnessCommands({ flash: vi.fn(), selectedPath: () => 'right.md', openView })
    await rows.find((r) => r.id === 'ai.add-selection')!.run()
    const [mention] = Object.values(harness.inbox)[0]
    expect(mention.ref).toEqual({ kind: 'lines', path: 'right.md', lines: { from: 2, to: 2 } })
    expect(mention.snapshot).toBe('Pick this line.\n')
    expect(openView).toHaveBeenCalledWith('session', expect.any(String))
  })

  it('with no selection it still opens the session — the current one, else a new one — and says nothing', async () => {
    const text = 'A note.\nWith a bare caret.\n'
    bindEditor({ paneId: 'p1', path: 'a.md', view: viewOver(text, 3, 3), focused: true })
    const openView = vi.fn()
    const flash = vi.fn()
    const rows = harnessCommands({ flash, selectedPath: () => 'a.md', openView })
    await rows.find((r) => r.id === 'ai.add-selection')!.run()
    expect(flash).not.toHaveBeenCalled()
    expect(Object.keys(harness.inbox)).toEqual([])
    expect(openView).toHaveBeenCalledWith('session', expect.any(String))
    const started = openView.mock.calls[0][1] as string
    expect(harness.current).toBe(started)
    // Again: the same session, not another.
    await rows.find((r) => r.id === 'ai.add-selection')!.run()
    expect(openView).toHaveBeenLastCalledWith('session', started)
  })
})
