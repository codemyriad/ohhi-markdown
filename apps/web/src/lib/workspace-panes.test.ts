// @vitest-environment jsdom
/**
 * The pane CONTROLLER (tab-groups W1/W2): the seam where the pure tree meets
 * the workspace, the clock and the keyboard. Everything here is a behaviour
 * the pure suites cannot see — what is written to storage and when, what
 * `setLiveViews` is handed, which keys are refused and by whom.
 *
 * It runs on jsdom because the controller measures elements and reads
 * `document.activeElement`; the workspace is a reactive stand-in
 * (`panes-shell.fixture.svelte.ts`), and the clock is the harness's SimClock
 * so nothing here waits on real time (golden rule 5).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SimClock } from '@ohhi/testkit'
import { CommandRegistry, type Command } from './commands.js'
import { createGroupUi } from './group-ui.svelte.js'
import { activeTab, findPane, panes as panesOf, visibleTabs, type Layout } from './panes.js'
import { ids as idGen } from './panes.fixture.js'
import { fakeWorkspace, withPanes, type FakeWorkspace, type PanesHarness } from './panes-shell.fixture.svelte.js'
import { setDefaultMode } from './read.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import { loadLayout, loadSavedGroups } from './workspace-layout.js'
import { keyboardClaimed, type PaneShell } from './workspace-panes.svelte.js'

const VAULT = 'room-a'
const FILES = ['a.md', 'b.md', 'c.md', 'd.md']

let clock: SimClock
let harness: PanesHarness
let panes: PaneShell
let registry: CommandRegistry
let ws: FakeWorkspace

beforeEach(() => {
  useMemStorage()
  document.body.innerHTML = ''
  // jsdom has no hit testing; the drag tests below drive the session directly.
  document.elementFromPoint = () => null
  clock = new SimClock()
  harness = withPanes(clock, idGen(), new CommandRegistry(false))
  panes = harness.panes
  registry = harness.registry
  registry.register(...panes.commands())
  ws = fakeWorkspace(FILES)
})

afterEach(() => {
  harness.stop()
  dropStorage()
})

/** Boot the controller over the fake vault and settle the first derivations. */
function boot(files: string[] = FILES): void {
  ws.setFiles(files)
  panes.attach(ws.asWorkspace(), VAULT)
  harness.flush()
  clock.advance(500)
  harness.flush()
}

const run = (id: string): void => void registry.get(id)?.run()
const pane = (i = 0) => panesOf(panes.layout.tree)[i]
const pathsIn = (i = 0): (string | null)[] => pane(i).tabs.map((t) => t.path)
const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)

/** Open `list` as tabs in the focused pane, in order. */
function openAll(list: string[]): void {
  for (const path of list) panes.open(path)
  harness.flush()
}

describe('what the rest of the app reads off the tree (B3, S9-Q1)', () => {
  it('the dock follows the focused note, and keeps the last one while a session has the focus', () => {
    boot()
    openAll(['a.md'])
    expect(ws.ui.dockNote).toEqual({ path: 'a.md', lastFocused: false })

    panes.openViewBeside('session', 's1')
    harness.flush()
    expect(ws.ui.selectedPath).toBeNull()
    expect(ws.ui.dockNote).toEqual({ path: 'a.md', lastFocused: true })

    // A second note focused: the dock names it, no longer "last focused".
    panes.open('b.md')
    harness.flush()
    expect(ws.ui.dockNote).toEqual({ path: 'b.md', lastFocused: false })

    // The remembered note deleted while a view has the focus: nothing to follow.
    panes.openViewBeside('session', 's1')
    harness.flush()
    expect(ws.ui.dockNote?.lastFocused).toBe(true)
    ws.setFiles(FILES.filter((f) => f !== 'b.md'))
    harness.flush()
    expect(ws.ui.dockNote).toBeNull()
  })

  it('hands the facade one live path per pane on screen, and one while zoomed', () => {
    boot()
    openAll(['a.md', 'b.md'])
    expect(ws.liveViews.at(-1)).toEqual(['b.md'])
    expect(ws.ui.selectedPath).toBe('b.md')

    run('workspace.split-right')
    harness.flush()
    expect(ws.liveViews.at(-1)).toEqual(['b.md'])
    panes.open('c.md')
    harness.flush()
    // Two panes, two notes — and the memory story is one view per pane (R2.1).
    expect(ws.liveViews.at(-1)).toEqual(['b.md', 'c.md'])

    run('workspace.zoom')
    harness.flush()
    expect(ws.liveViews.at(-1)).toEqual(['c.md'])
    run('workspace.zoom')
    harness.flush()
    expect(ws.liveViews.at(-1)).toEqual(['b.md', 'c.md'])
  })
})

describe("panes.open: 'replace' (quiet-shell F3)", () => {
  it('navigates the focused tab in place and keeps the live caret on its Back trail', () => {
    boot()
    openAll(['a.md'])
    const before = pane().tabs.length
    // The live view reports where it is only when asked (B2).
    panes.registerCapture(pane().id, () => ({ cursor: { anchor: 5, head: 5 }, scroll: 12 }))
    panes.open('b.md', { replace: true })
    harness.flush()
    expect(pane().tabs).toHaveLength(before)
    const held = activeTab(pane())!
    expect(held.path).toBe('b.md')
    expect(held.history.map((h) => h.path)).toEqual(['a.md', 'b.md'])
    expect(held.history[0]).toMatchObject({ cursor: { anchor: 5, head: 5 }, scroll: 12 })
    panes.registerCapture(pane().id, null)

    // Mod+click is still a tab beside it.
    panes.open('c.md', { replace: true, background: true })
    harness.flush()
    expect(pathsIn()).toContain('c.md')
    expect(activeTab(pane())?.path).toBe('b.md')
  })
})

describe('view modes (read-shaping B3, Fork 2-A)', () => {
  const activeTabOf = (i = 0) => activeTab(pane(i))

  beforeEach(() => {
    registry.register(...panes.readCommands())
  })
  // The preference is module state shared by every suite in this file.
  afterEach(() => setDefaultMode('live'))

  it('a tab with no mode of its own follows Settings, live', () => {
    boot()
    openAll(['a.md'])
    expect(panes.modeOf(activeTabOf())).toBe('live')

    // Changing the preference moves every tab that never chose for itself —
    // the whole reason `Tab.mode` is absent rather than stamped.
    setDefaultMode('source')
    harness.flush()
    expect(panes.modeOf(activeTabOf())).toBe('source')
    expect(activeTabOf()?.mode).toBeUndefined()
  })

  it('Mod+E comes back to the mode the tab was last edited in', () => {
    boot()
    openAll(['a.md'])
    run('view.mode-source')
    harness.flush()
    expect(panes.modeOf(activeTabOf())).toBe('source')

    run('view.toggle-reading')
    harness.flush()
    expect(panes.modeOf(activeTabOf())).toBe('reading')

    run('view.toggle-reading')
    harness.flush()
    expect(panes.modeOf(activeTabOf())).toBe('source')
  })

  it('the mode belongs to the tab, not to the pane or the app', () => {
    boot()
    openAll(['a.md', 'b.md'])
    const b = activeTabOf()!.id
    panes.setMode(b, 'reading')
    harness.flush()
    expect(panes.modeOf(pane().tabs.find((t) => t.path === 'a.md')!)).toBe('live')
    expect(panes.modeOf(pane().tabs.find((t) => t.path === 'b.md')!)).toBe('reading')

    // …and it is persisted with the tab, so a reload remembers it.
    panes.persistNow()
    const stored = loadLayout(VAULT, idGen('r'))!
    const tabs = panesOf(stored.tree)[0].tabs
    expect(tabs.find((t) => t.path === 'b.md')?.mode).toBe('reading')
    expect(tabs.find((t) => t.path === 'a.md')?.mode).toBeUndefined()
  })

  it('Mod+L reaches the FOCUSED pane\'s view, and only while there is one', () => {
    boot()
    openAll(['a.md'])
    let toggled = 0
    panes.registerEditor(panes.layout.focus, { toggleTask: () => (toggled++, true), format: () => true })
    run('edit.toggle-checkbox')
    expect(toggled).toBe(1)

    // A pane whose view has gone away takes no more commands.
    panes.registerEditor(panes.layout.focus, null)
    run('edit.toggle-checkbox')
    expect(toggled).toBe(1)
  })

  it('format.* reaches the FOCUSED pane\'s view, and hides in Reading or without a view', () => {
    registry.register(...panes.formatCommands())
    const shown = (): boolean => registry.available().some((c) => c.id === 'format.bold')
    boot()
    openAll(['a.md'])
    // No live view registered yet: nothing to format.
    expect(shown()).toBe(false)

    const ran: string[] = []
    panes.registerEditor(panes.layout.focus, {
      toggleTask: () => true,
      format: (id) => (ran.push(id), true),
    })
    expect(shown()).toBe(true)
    run('format.bold')
    run('format.heading-2')
    expect(ran).toEqual(['format.bold', 'format.heading-2'])

    run('view.mode-reading')
    harness.flush()
    expect(shown()).toBe(false)
    run('view.mode-live')
    harness.flush()
    expect(shown()).toBe(true)

    panes.registerEditor(panes.layout.focus, null)
    expect(shown()).toBe(false)
  })

  it('the checkbox command is hidden in Reading, where commands do not run', () => {
    boot()
    openAll(['a.md'])
    expect(registry.available().some((c) => c.id === 'edit.toggle-checkbox')).toBe(true)
    run('view.mode-reading')
    harness.flush()
    expect(registry.available().some((c) => c.id === 'edit.toggle-checkbox')).toBe(false)
    // Every `view.*` row stays, because that is how you get back out.
    expect(registry.available().some((c) => c.id === 'view.toggle-reading')).toBe(true)
  })
})

describe('the device-local store has one writer (M2)', () => {
  /** The group, wherever it is: on a strip, in the list, or nowhere. */
  function whereIsIt(): { onStrip: boolean; inList: boolean } {
    const restored: Layout | null = loadLayout(VAULT, idGen('r'))
    return {
      onStrip: restored ? panesOf(restored.tree).some((p) => p.groups.length > 0) : false,
      inList: loadSavedGroups(VAULT).some((g) => g.name === 'Edible'),
    }
  }

  function groupTwoTabs(): string {
    openAll(['a.md', 'b.md'])
    const p = pane()
    const first = p.tabs.find((t) => t.path === 'a.md')!.id
    const second = p.tabs.find((t) => t.path === 'b.md')!.id
    const id = panes.newGroup(first, p.id)!
    panes.addToGroup(second, id)
    panes.renameGroup(id, 'Edible')
    harness.flush()
    return id
  }

  it('survives a reload in the window between reopening a group and the write', () => {
    boot()
    const id = groupTwoTabs()
    panes.closeGroup(id)
    harness.flush()
    clock.advance(500)
    expect(whereIsIt()).toEqual({ onStrip: false, inList: true })

    // Reopening is a layout change (debounced) AND a list change (was
    // immediate): with two writers the list lost it and the layout half was
    // still the one from before the reopen, so a reload inside this window
    // lost the group outright (R2.2).
    panes.openSavedGroup(id)
    harness.flush()
    const midFlight = whereIsIt()
    expect(midFlight.onStrip || midFlight.inList).toBe(true)

    clock.advance(500)
    expect(whereIsIt()).toEqual({ onStrip: true, inList: false })
  })

  it('never leaves a closed group on the strip AND in the list', () => {
    boot()
    const id = groupTwoTabs()
    panes.closeGroup(id)
    harness.flush()
    // The mirror of the case above: the list was written before the layout, so
    // a reload here used to show the group twice.
    const midFlight = whereIsIt()
    expect(midFlight.onStrip && midFlight.inList).toBe(false)
    clock.advance(500)
    expect(whereIsIt()).toEqual({ onStrip: false, inList: true })
  })

  it('writes both halves under one key when the debounce fires', () => {
    boot()
    const id = groupTwoTabs()
    panes.closeGroup(id)
    harness.flush()
    clock.advance(500)
    expect(loadSavedGroups(VAULT)).toHaveLength(1)
    expect(loadLayout(VAULT, idGen('r'))).not.toBeNull()
  })
})

describe('pruning waits for the vault to stop moving (M3)', () => {
  it('closes nothing while a mount surgery is in flight, however long it takes', () => {
    boot()
    openAll(['a.md', 'b.md', 'c.md'])
    expect(pathsIn()).toEqual(['a.md', 'b.md', 'c.md'])

    // `doUnshare` takes the mount AND the root out of the registry, then
    // rebuilds; a first join pulls a whole room (11 s measured). Any tree
    // refresh in that window reports a near-empty vault.
    ws.ui.settling = true
    ws.setFiles([])
    harness.flush()
    clock.advance(60_000)
    harness.flush()
    expect(pathsIn()).toEqual(['a.md', 'b.md', 'c.md'])

    ws.ui.settling = false
    ws.setFiles(FILES)
    harness.flush()
    clock.advance(1_000)
    harness.flush()
    expect(pathsIn()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('makes a live set that lost more than half of itself say so twice', () => {
    boot()
    openAll(['a.md', 'b.md', 'c.md'])

    // Belt and braces behind `settling`: a refresh that reports one file out
    // of four is far likelier to be a rebuild than a mass delete.
    ws.setFiles(['a.md'])
    harness.flush()
    clock.advance(500)
    expect(pathsIn()).toEqual(['a.md', 'b.md', 'c.md'])

    ws.setFiles(FILES)
    harness.flush()
    clock.advance(500)
    harness.flush()
    expect(pathsIn()).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('still closes the tabs of notes that really are gone', () => {
    boot()
    openAll(['a.md', 'b.md', 'c.md'])
    ws.setFiles(['a.md', 'b.md'])
    harness.flush()
    clock.advance(500)
    harness.flush()
    expect(pathsIn()).toEqual(['a.md', 'b.md'])

    // …and a halved set that says the same thing twice is believed.
    ws.setFiles([])
    harness.flush()
    clock.advance(500)
    harness.flush()
    clock.advance(500)
    harness.flush()
    expect(pathsIn()).toEqual([null])
  })
})

describe('the keyboard belongs to whatever is on top (M4, Minor 7)', () => {
  /** Put focus where a dialog's text field would be. */
  function focusAField(): HTMLInputElement {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    return input
  }

  it('refuses to enter pane mode from a text field or under an open dialog', () => {
    boot()
    const input = focusAField()
    run('workspace.mode')
    expect(panes.mode).toBeNull()
    input.remove()

    document.body.innerHTML = '<div aria-modal="true"><button>ok</button></div>'
    run('workspace.mode')
    expect(panes.mode).toBeNull()

    document.body.innerHTML = ''
    run('workspace.mode')
    expect(panes.mode).toBe('pane')
  })

  it('gives the keyboard back when a field takes focus mid-mode', () => {
    boot()
    run('workspace.mode')
    expect(panes.mode).toBe('pane')
    const input = focusAField()
    // A mode `preventDefault`s every key until Escape; typing into a field
    // must not be swallowed — and the mode is over, because the keyboard is.
    expect(panes.handleKey(key({ key: 'd' }))).toBe(false)
    expect(panes.mode).toBeNull()
    input.remove()
  })

  it('lets a chord fall through to the registry instead of reading it as a letter', () => {
    boot()
    run('workspace.mode')
    // `Mod+W` used to run *rotate* (the `w` row) and a second `Mod+P`
    // *focus next* (the `p` row), because `step` matches on `key` alone.
    expect(panes.handleKey(key({ key: 'w', ctrlKey: true }))).toBe(false)
    expect(panes.handleKey(key({ key: 'p', ctrlKey: true }))).toBe(false)
    expect(panes.mode).toBe('pane')
    // A plain letter still acts, and pane mode is one-shot.
    expect(panes.handleKey(key({ key: 'r' }))).toBe(true)
    expect(panes.mode).toBeNull()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
  })
})

describe('the hint bar only advertises keys that do something (Minor 2)', () => {
  it('drops a row whose command is refused by its guard', () => {
    boot()
    const groups = createGroupUi(panes, {
      ambiguousName: () => false,
      outgoingPaths: async () => [],
      flash: () => {},
      write: async () => {},
    })
    registry.register(...(groups.commands() as Command[]))
    openAll(['a.md'])

    run('workspace.mode')
    expect(panes.handleKey(key({ key: 'g' }))).toBe(true)
    expect(panes.mode).toBe('group')
    // No group under the cursor: only *New group* can run, so it is the only
    // row. The `h j k l` family goes with the rest.
    expect(panes.hints().map((h) => h.key)).toEqual(['n'])

    panes.leaveMode()
    const p = pane()
    panes.newGroup(p.tabs.find((t) => t.path === 'a.md')!.id, p.id)
    harness.flush()
    run('workspace.mode')
    panes.handleKey(key({ key: 'g' }))
    expect(panes.hints().map((h) => h.key)).toEqual(['n', 'f', 'x', 'c', 'u', 'h j k l'])
  })
})

describe('going to a tab by number counts the strip as drawn (Minor 1)', () => {
  it('skips the tabs a folded group is hiding', () => {
    boot()
    openAll(['a.md', 'b.md', 'c.md', 'd.md'])
    const p = pane()
    const id = panes.newGroup(p.tabs.find((t) => t.path === 'a.md')!.id, p.id)!
    panes.addToGroup(pane().tabs.find((t) => t.path === 'b.md')!.id, id)
    panes.toggleGroup(id)
    harness.flush()
    expect(visibleTabs(pane()).map((t) => t.path)).toEqual(['c.md', 'd.md'])

    run('tab.goto-1')
    harness.flush()
    expect(activeTab(pane())?.path).toBe('c.md')
    run('tab.goto-2')
    harness.flush()
    expect(activeTab(pane())?.path).toBe('d.md')
  })
})

describe('zoom does not disable the pane family (Minor 6)', () => {
  /** Register a pane's box the way `Pane.svelte` does, with a measured rect. */
  function place(paneId: string, x: number, width: number): HTMLElement {
    const el = document.createElement('section')
    el.getBoundingClientRect = () =>
      ({ x, y: 0, width, height: 100, top: 0, left: x, right: x + width, bottom: 100 }) as DOMRect
    document.body.append(el)
    panes.registerPane(paneId, el)
    return el
  }

  it('moves focus inside a zoom, taking the zoom with it', () => {
    boot()
    openAll(['a.md'])
    run('workspace.split-right')
    harness.flush()
    const [left, right] = panesOf(panes.layout.tree)
    place(left.id, 0, 100)
    const rightEl = place(right.id, 100, 100)
    expect(panes.neighbourPane('left')).toBe(left.id)

    run('workspace.zoom')
    harness.flush()
    expect(panes.layout.zoom).toBe(right.id)
    // The other pane is unmounted while zoomed; its box is remembered, so the
    // geometric lookup still has something to answer with.
    panes.registerPane(left.id, null)
    rightEl.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100 }) as DOMRect

    expect(panes.neighbourPane('left')).toBe(left.id)
    run('workspace.focus-left')
    harness.flush()
    expect(panes.layout.focus).toBe(left.id)
    expect(panes.layout.zoom).toBe(left.id)
  })
})

describe('a companion view beside the note (the Session; Chris, 2026-10-15)', () => {
  /** Register a pane's box the way `Pane.svelte` does, with a measured rect. */
  function place(paneId: string, x: number, width: number, y = 0, height = 800): HTMLElement {
    const el = document.createElement('section')
    el.getBoundingClientRect = () =>
      ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }) as DOMRect
    document.body.append(el)
    panes.registerPane(paneId, el)
    return el
  }
  const views = (i: number): [string | undefined, string | undefined][] => pane(i).tabs.map((t) => [t.view, t.viewArg])

  it('alone in a wide pane: a split to the right, the note staying put, the session focused', () => {
    boot()
    openAll(['a.md'])
    place(pane().id, 0, 1400)
    panes.openViewBeside('session', 's1')
    harness.flush()
    const all = panesOf(panes.layout.tree)
    expect(all).toHaveLength(2)
    expect((panes.layout.tree as { dir?: string }).dir).toBe('row')
    expect(pathsIn(0)).toContain('a.md')
    expect(views(1)).toEqual([['session', 's1']])
    expect(panes.layout.focus).toBe(all[1].id)
  })

  it('alone in a narrow pane: below', () => {
    boot()
    openAll(['a.md'])
    place(pane().id, 0, 700)
    panes.openViewBeside('session', 's1')
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect((panes.layout.tree as { dir?: string }).dir).toBe('col')
  })

  it('already open anywhere: that tab is activated, nothing splits', () => {
    boot()
    openAll(['a.md'])
    place(pane().id, 0, 1400)
    panes.openViewBeside('session', 's1')
    harness.flush()
    const [note, session] = panesOf(panes.layout.tree)
    place(note.id, 0, 600)
    place(session.id, 600, 600)
    panes.focusPane(note.id)
    harness.flush()
    panes.openViewBeside('session', 's1')
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect(panes.layout.focus).toBe(session.id)
    expect(views(1)).toEqual([['session', 's1']])
  })

  it('already in a split: the companion goes to the other pane, never a second split', () => {
    boot()
    openAll(['a.md'])
    run('workspace.split-right')
    harness.flush()
    const [left, right] = panesOf(panes.layout.tree)
    place(left.id, 0, 600)
    place(right.id, 600, 600)
    panes.focusPane(left.id)
    harness.flush()
    panes.openViewBeside('session', 's1')
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect(views(1)).toContainEqual(['session', 's1'])
    expect(activeTab(pane(1))?.viewArg).toBe('s1')
    expect(panes.layout.focus).toBe(right.id)
  })

  it('from a session pane, another session opens in place; an empty tab is filled', () => {
    boot()
    openAll(['a.md'])
    place(pane().id, 0, 1400)
    panes.openViewBeside('session', 's1')
    harness.flush()
    panes.openViewBeside('session', 's2')
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect(views(1)).toEqual([
      ['session', 's1'],
      ['session', 's2'],
    ])
    // A fresh empty pane: the view fills its slot.
    panes.newTabIn(pane(0).id)
    harness.flush()
    panes.openViewBeside('log')
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect(activeTab(pane(0))?.view).toBe('log')
  })

  it('openBeside: a note opened from the session goes where it is, else into the note pane', () => {
    boot()
    openAll(['a.md'])
    place(pane().id, 0, 1400)
    panes.openViewBeside('session', 's1')
    harness.flush()
    const [note, session] = panesOf(panes.layout.tree)
    place(note.id, 0, 600)
    place(session.id, 600, 600)
    expect(panes.layout.focus).toBe(session.id)
    // Already shown on the left: activated there, no twin in the session pane.
    panes.openBeside('a.md')
    harness.flush()
    expect(panes.layout.focus).toBe(note.id)
    expect(views(1)).toEqual([['session', 's1']])
    // Not shown anywhere, from the session pane: into the note pane, with replace semantics.
    panes.focusPane(session.id)
    harness.flush()
    panes.openBeside('b.md', { replace: true })
    harness.flush()
    expect(panesOf(panes.layout.tree)).toHaveLength(2)
    expect(pathsIn(0)).toContain('b.md')
    expect(views(1)).toEqual([['session', 's1']])
    // From a note pane it is a plain open.
    panes.focusPane(note.id)
    harness.flush()
    panes.openBeside('c.md')
    harness.flush()
    expect(pathsIn(0)).toContain('c.md')
    expect(views(1)).toEqual([['session', 's1']])
  })
})

describe('a whole group moves without a pointer (M8)', () => {
  it('carries the run, its name and its colour to the neighbouring pane', () => {
    boot()
    openAll(['a.md', 'b.md'])
    const p = pane()
    const id = panes.newGroup(p.tabs.find((t) => t.path === 'a.md')!.id, p.id)!
    panes.renameGroup(id, 'Edible')
    run('workspace.split-right')
    harness.flush()
    const [from, to] = panesOf(panes.layout.tree)
    expect(findPane(panes.layout, from.id)?.groups).toHaveLength(1)

    panes.moveGroupToPane(id, to.id)
    harness.flush()
    const [after, landed] = panesOf(panes.layout.tree)
    expect(after.groups).toHaveLength(0)
    expect(landed.groups.map((g) => g.name)).toEqual(['Edible'])
  })
})

describe('a drag can be called off (Minor 9)', () => {
  it('Escape drops the ghost, un-suspends the hotkeys and applies nothing', () => {
    boot()
    openAll(['a.md', 'b.md'])
    const before = pathsIn()
    const tab = pane().tabs.find((t) => t.path === 'b.md')!
    const down = new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    panes.beginDrag(down as unknown as PointerEvent, {
      tabIds: [tab.id],
      fromPaneId: pane().id,
      groupId: null,
      label: 'b',
      color: null,
    })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 200 }))
    expect(panes.drag).not.toBeNull()
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panes.drag).toBeNull()
    // The registry is listening again, and the pointer-up that follows the
    // cancel drops nothing.
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).not.toBeNull()
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 200 }))
    harness.flush()
    expect(pathsIn()).toEqual(before)
  })
})

/**
 * The bridge from the file tree (P1.2). The tree is an HTML5 drag source and
 * the strip is a pointer-drag surface; the controller is where the two meet,
 * so this is the seam that has to be tested — the pure half is
 * `stripDrop`/`openPathAt`, and the components only forward events.
 */
describe('a note dragged in from the file tree (P1.2)', () => {
  /** A pane element the hit test can find, with a strip of a known height. */
  function stubPaneUnderPointer(paneId: string): void {
    const el = document.createElement('section')
    el.dataset.paneId = paneId
    const strip = document.createElement('div')
    strip.setAttribute('data-strip', '')
    el.append(strip)
    document.body.append(el)
    const rect = { top: 0, bottom: 30, left: 0, right: 400, width: 400, height: 30, x: 0, y: 0 }
    strip.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect }) as DOMRect
    document.elementFromPoint = () => strip
  }

  it('hovers with an external payload and opens the path where it was let go', () => {
    boot()
    openAll(['a.md'])
    stubPaneUnderPointer(pane().id)

    panes.hoverExternal(200, 10)
    harness.flush()
    // No tabs and no source pane: a row is a path, readable only on `drop`.
    expect(panes.drag?.payload.external).toBe(true)
    expect(panes.drag?.payload.tabIds).toEqual([])
    expect(panes.drag?.target?.kind).toBe('strip')

    panes.dropExternal('c.md')
    harness.flush()
    expect(panes.drag).toBeNull()
    expect(pathsIn()).toEqual(['a.md', 'c.md'])
    expect(ws.ui.selectedPath).toBe('c.md')
  })

  it('refuses to overwrite a live pointer drag', () => {
    boot()
    openAll(['a.md', 'b.md'])
    stubPaneUnderPointer(pane().id)
    const tab = pane().tabs[0]

    // A tab drag is in flight (past the threshold, so `drag` is set)…
    const down = new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 })
    panes.beginDrag(down as unknown as PointerEvent, {
      tabIds: [tab.id],
      fromPaneId: pane().id,
      groupId: null,
      label: 'a',
      color: null,
    })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 10 }))
    harness.flush()
    expect(panes.drag?.payload.tabIds).toEqual([tab.id])

    // …and a stray native hover must not take the session from under it.
    panes.hoverExternal(200, 10)
    harness.flush()
    expect(panes.drag?.payload.external).toBeUndefined()
    expect(panes.drag?.payload.tabIds).toEqual([tab.id])
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 10 }))
  })

  it('leaving the pane drops the indicator without opening anything', () => {
    boot()
    openAll(['a.md'])
    stubPaneUnderPointer(pane().id)
    const before = pathsIn()

    panes.hoverExternal(200, 10)
    harness.flush()
    panes.leaveExternal()
    harness.flush()
    expect(panes.drag).toBeNull()

    // A drop that follows a leave has no target left to apply.
    panes.dropExternal('c.md')
    harness.flush()
    expect(pathsIn()).toEqual(before)
  })
})

/**
 * The keyboard guard (M4), extended by shell-polish P1.3: the manage popover
 * is anchored and NON-modal, so it carries no `aria-modal` — and a pane mode
 * entered behind it would act on the very tabs its verbs are about.
 */
describe('keyboardClaimed', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('counts an open popover as claimed, the way it counts a modal', () => {
    expect(keyboardClaimed(document)).toBe(false)

    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    expect(keyboardClaimed(document)).toBe(true)
    modal.remove()

    // Melt's own mark on the popover surface — the one thing every popover in
    // the shell carries, whatever it renders inside.
    const popover = document.createElement('div')
    popover.setAttribute('data-melt-popover-content', '')
    document.body.append(popover)
    expect(keyboardClaimed(document)).toBe(true)
  })

  it('a field a pane draws itself (the empty tab’s picker) leaves the tab keys to the panes; one outside them claims', () => {
    const pane = document.createElement('section')
    pane.setAttribute('data-pane-id', 'p1')
    const picker = document.createElement('input')
    pane.append(picker)
    const outside = document.createElement('input')
    document.body.append(pane, outside)
    picker.focus()
    // Closing the lone tab lands in its empty tab's picker: Mod+Shift+T from
    // there must reopen what was closed, not be swallowed.
    expect(keyboardClaimed(document)).toBe(false)
    outside.focus()
    expect(keyboardClaimed(document)).toBe(true)
  })
})
