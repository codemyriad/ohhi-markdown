// @vitest-environment jsdom
/**
 * The shell's chrome state (`shell-layout.svelte.ts`): what persists and
 * when, and the notice bookkeeping (spike S22 Stage 4a) — one toast per new
 * error or warning, none for info, one per flash, and "unread" reset by
 * opening the drawer.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { layoutOverrides, layoutPins, layoutPrefs, setLayoutOverrides, setLayoutPins, setLayoutPrefs } from './config.js'
import type { LayoutChoice } from './layout.js'
import { EXAMPLES, LAYOUT_SCHEMA_ID, PRESETS, type LayoutFile, type ShellSpec } from './layout-spec.js'
import type { ResolvedLayout, ResourceChange } from './resources.svelte.js'
import type { AppEvent, EventLevel } from '@ohhi/workspace'
import type { Flash } from './notices.js'
import { createShellLayout, type ShellLayout } from './shell-layout.svelte.js'
import { box, withActions, type ActionsHarness } from './shell-actions.fixture.svelte.js'
import { notice as logged } from './readouts.fixture.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import type { ToastData } from './ui/toaster.js'

let harness: ActionsHarness<ShellLayout>
let layout: ShellLayout
let inWorkspace: boolean
let notices: { value: AppEvent[] | null }
let flashes: { value: Flash[] | null }
let now: number
let toasted: ToastData[]
let source: { value: object }
let sessionStart: number | null
let room: { value: string | null }

/** The shared notice, with its id as the message: the toasts below assert on it. */
const notice = (id: string, at: number, level: EventLevel = 'warn', count = 1): AppEvent => ({
  ...logged(id, at, level, {}, count),
  payload: { code: 'mount_error', params: { message: id } },
})

function build(): void {
  harness = withActions(() =>
    createShellLayout({
      inWorkspace: () => inWorkspace,
      events: () => notices.value,
      flashes: () => flashes.value,
      eventSource: () => source.value,
      sessionStart: () => sessionStart,
      room: () => room.value,
      now: () => now,
      toast: (data) => {
        toasted.push(data)
      },
    })
  )
  layout = harness.actions
}

beforeEach(() => {
  useMemStorage()
  inWorkspace = true
  notices = box<AppEvent[] | null>([])
  source = box<object>({})
  flashes = box<Flash[] | null>([])
  now = 1_000
  toasted = []
  sessionStart = null
  room = box<string | null>(null)
})

afterEach(() => {
  harness?.stop()
  dropStorage()
})

describe('createShellLayout', () => {
  it('seeds the columns from the active layout; the toggles and the dock tab are session-only', () => {
    build()
    // A fresh device runs `default`: the navigator is a drawer and the rail a
    // menu, which render closed until Stage 2.
    expect(layout.active).toBe('default')
    expect(layout.spec).toEqual(PRESETS.default)
    expect(layout.treeOpen).toBe(false)
    expect(layout.railOpen).toBe(false)
    layout.treeOpen = true
    layout.railTab = 'history'
    flushSync()
    expect(layoutPrefs()).toMatchObject({ active: 'default' })
    expect(layoutPrefs()).not.toHaveProperty('treeOpen')
    expect(layoutPrefs()).not.toHaveProperty('railTab')
  })

  it('persists the width only on commit, never per pointer move', () => {
    build()
    const before = layoutPrefs().treeWidth
    layout.treeWidth = 400
    flushSync()
    expect(layoutPrefs().treeWidth).toBe(before)
    layout.commitTreeWidth()
    expect(layoutPrefs().treeWidth).toBe(400)
  })

  it('showSection opens the dock on that tab; revealInTree opens the navigator', () => {
    build()
    layout.railOpen = false
    layout.showSection('history')
    expect(layout.railOpen).toBe(true)
    expect(layout.railTab).toBe('history')
    flushSync()
    // Links loads only while its tab is the one on screen.
    expect(layout.linksVisible).toBe(false)
    layout.showSection('nope')
    expect(layout.railTab).toBe('history')
    layout.railTab = 'links'
    flushSync()
    expect(layout.linksVisible).toBe(true)
    layout.railOpen = false
    flushSync()
    expect(layout.linksVisible).toBe(false)

    layout.treeOpen = false
    layout.revealInTree('docs')
    expect(layout.treeOpen).toBe(true)
    expect(layout.revealDir).toEqual({ path: 'docs' })
  })

  it('toasts each new error or warning once, in the words of its code', () => {
    build()
    notices.value = [notice('n1', 10)]
    flushSync()
    expect(toasted.map((t) => t.description)).toEqual(['n1'])
    flushSync()
    expect(toasted).toHaveLength(1)

    notices.value = [notice('n2', 20), notice('n1', 10)]
    flushSync()
    expect(toasted.map((t) => t.description)).toEqual(['n1', 'n2'])
    expect(toasted[1]?.title).toBeTruthy()
  })

  it('toasts two that arrive in one tick, oldest first, and a folded repeat not again', () => {
    build()
    notices.value = [notice('b', 20, 'error'), notice('a', 10)]
    flushSync()
    expect(toasted.map((t) => [t.description, t.level])).toEqual([
      ['a', 'warn'],
      ['b', 'error'],
    ])
    notices.value = [notice('b', 30, 'error', 2), notice('a', 10)]
    flushSync()
    expect(toasted.map((t) => t.description)).toEqual(['a', 'b'])
  })

  it('a new log (another vault) toasts its events even where the ids repeat', () => {
    build()
    notices.value = [notice('app:1', 10)]
    flushSync()
    source.value = {}
    notices.value = [{ ...notice('app:1', 20), payload: { code: 'mount_error', params: { message: 'other vault' } } }]
    flushSync()
    expect(toasted.map((t) => t.description)).toEqual(['app:1', 'other vault'])
  })

  it('never toasts stored history merged on mount open (events older than the session)', () => {
    sessionStart = 500
    build()
    // A room log loads its stored events after the session began…
    notices.value = [notice('room:7', 400, 'error'), notice('room:8', 450)]
    flushSync()
    expect(toasted).toEqual([])
    expect(layout.unread).toBe(0)
    // …and what happens now still toasts and counts.
    notices.value = [notice('room:9', 600), ...notices.value!]
    flushSync()
    expect(toasted.map((t) => t.description)).toEqual(['room:9'])
    expect(layout.unread).toBe(1)
  })

  it('counts changes by someone else as unread, never your own', () => {
    build()
    const change = (id: string, at: number, kind: 'peer' | 'me'): AppEvent => ({
      id,
      at,
      level: 'info',
      kind: 'doc.changed',
      scope: { room: 'r', path: 'a.md' },
      actor: kind === 'peer' ? { kind, name: 'Sam' } : { kind },
      count: 1,
      payload: { guid: 'g', added: 1 },
    })
    notices.value = [change('c1', 10, 'peer'), change('c2', 11, 'me')]
    flushSync()
    expect(layout.unread).toBe(1)
    expect(toasted).toEqual([])
  })

  it('never toasts info, nor a notice its own surface already shows', () => {
    build()
    const shown: AppEvent = { ...notice('x', 10, 'error'), payload: { code: 'add_link_failed', params: { message: 'x' } } }
    notices.value = [notice('i', 20, 'info'), shown]
    flushSync()
    expect(toasted).toEqual([])
  })

  it('toasts each flash once and keeps none of them as unread', () => {
    build()
    flashes.value = [{ id: 'f1', level: 'warn', text: 'Not moved' }]
    flushSync()
    flashes.value = [{ id: 'f2', level: 'info', text: 'Copied' }, ...flashes.value]
    flushSync()
    expect(toasted.map((t) => [t.description, t.level])).toEqual([
      ['Not moved', 'warn'],
      ['Copied', 'info'],
    ])
    expect(layout.unread).toBe(0)
  })

  it('unread counts errors and warnings since the drawer was last opened', () => {
    build()
    expect(layout.unread).toBe(0)

    // Two warnings and an info arrive with the drawer shut: info never counts.
    now = 3_000
    notices.value = [notice('n2', 2_500), notice('n1', 2_000), notice('quiet', 2_100, 'info')]
    flushSync()
    expect(layout.unread).toBe(2)

    // Opening the drawer reads them — including one that arrives while it is open.
    layout.drawerOpen = true
    flushSync()
    expect(layout.lastSeenAt).toBe(3_000)
    expect(layout.unread).toBe(0)
    now = 4_000
    notices.value = [notice('n3', 3_500), ...notices.value!]
    flushSync()
    expect(layout.unread).toBe(0)

    // Shut again, arrivals count; a folded repeat moves forward and counts too.
    layout.drawerOpen = false
    flushSync()
    now = 5_000
    notices.value = [notice('n4', 4_500), notice('n3', 4_600, 'warn', 2), ...notices.value!.slice(1)]
    flushSync()
    expect(layout.unread).toBe(2)
    layout.markSeen()
    flushSync()
    expect(layout.unread).toBe(0)

    // With no vault room, a new session has seen nothing.
    harness.stop()
    build()
    now = 6_000
    notices.value = [notice('n5', 5_500), ...notices.value!]
    flushSync()
    expect(layout.unread).toBe(5)
  })

  it('what the drawer has read is kept per vault on this device: a new session counts only what is new', () => {
    room = box<string | null>('r1')
    build()
    notices.value = [notice('n1', 2_000), notice('n2', 2_500)]
    flushSync()
    expect(layout.unread).toBe(2)
    now = 3_000
    layout.markSeen()
    flushSync()
    expect(layout.unread).toBe(0)
    harness.stop()

    // The next session: the log persisted, and so did when it was read.
    sessionStart = 4_000
    build()
    flushSync()
    expect(layout.lastSeenAt).toBe(3_000)
    // A warning from after the read but before this session (never seen) still counts.
    notices.value = [notice('n3', 3_500), ...notices.value!]
    flushSync()
    expect(layout.unread).toBe(1)
    // Another vault has its own read state: never opened here → counts from the session start.
    room.value = 'r2'
    flushSync()
    expect(layout.lastSeenAt).toBe(0)
    expect(layout.unread).toBe(0)
  })
})

describe('createShellLayout — the layout spec', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 3; i++) await Promise.resolve()
    flushSync()
  }
  const custom: ShellSpec = { ...EXAMPLES.dense, toolbar: { position: 'bottom' } }
  let resolved: LayoutChoice[]
  let feeds: ((why: ResourceChange) => void)[]
  let override: LayoutChoice | null

  /** What `resources` does: the vault's first appearance announces itself. */
  const open = async (): Promise<void> => {
    for (const feed of feeds) feed('open')
    await settle()
  }

  function buildWith(): void {
    harness = withActions(() =>
      createShellLayout({
        inWorkspace: () => true,
        events: () => [],
        flashes: () => [],
        now: () => 0,
        toast: () => {},
        resolveLayout: async (choice): Promise<ResolvedLayout> => {
          resolved.push(choice)
          const spec = choice === 'custom:mine' ? custom : choice === 'custom:dense' ? EXAMPLES.dense : PRESETS.default
          return { spec, entry: null, error: null }
        },
        layoutOverride: { get: () => override, clear: () => (override = null) },
        session: sessionStorage,
        onLayoutsChange: (cb) => {
          feeds.push(cb)
          return () => (feeds = feeds.filter((f) => f !== cb))
        },
      })
    )
    layout = harness.actions
  }

  beforeEach(() => {
    resolved = []
    feeds = []
    override = null
    sessionStorage.clear()
  })

  it('a stored dense-example choice opens both columns from the first paint', () => {
    setLayoutPrefs({ active: 'custom:dense' })
    build()
    expect(layout.active).toBe('custom:dense')
    expect(layout.treeOpen).toBe(true)
    expect(layout.railOpen).toBe(true)
  })

  it('setActive persists the choice and re-seeds; reload re-seeds a toggled column', async () => {
    buildWith()
    await open()
    expect(resolved).toEqual(['default'])
    await layout.setActive('custom:mine')
    flushSync()
    expect(layoutPrefs().active).toBe('custom:mine')
    expect(layout.spec).toBe(custom)
    expect(layout.treeOpen).toBe(true)
    layout.treeOpen = false
    await layout.reload()
    flushSync()
    expect(layout.treeOpen).toBe(true)
  })

  it('a session override wins over the stored choice, and a pick clears it', async () => {
    setLayoutPrefs({ active: 'custom:mine' })
    override = 'custom:dense'
    buildWith()
    await open()
    expect(layout.active).toBe('custom:dense')
    expect(resolved).toEqual(['custom:dense'])
    await layout.setActive('default')
    expect(override).toBeNull()
    expect(layoutPrefs().active).toBe('default')
  })

  it('subscribes once; a change or a vault switch re-applies keeping the toggles, a reload re-seeds them', async () => {
    buildWith()
    expect(feeds).toHaveLength(1)
    await open()
    expect(resolved).toEqual(['default'])
    layout.treeOpen = true
    feeds[0]!('change')
    await settle()
    expect(resolved).toEqual(['default', 'default'])
    expect(layout.treeOpen).toBe(true)
    feeds[0]!('reload')
    await settle()
    expect(resolved).toHaveLength(3)
    expect(layout.treeOpen).toBe(false) // default's navigator is a drawer: re-seeded shut
  })
})

describe('createShellLayout — pins are device overrides (Round 2, P7)', () => {
  beforeEach(() => sessionStorage.clear())

  it('pinning the rail makes only the rail a column: the navigator region and toggle are untouched (the pin-both bug)', () => {
    setLayoutPrefs({ active: 'default' })
    build()
    layout.treeOpen = true // the drawer is open…
    layout.pin('rail')
    flushSync()
    expect(layout.pinned('rail')).toBe(true)
    expect(layout.pinned('navigator')).toBe(false)
    expect(layout.spec.regions.rail).toBe('column')
    expect(layout.spec.regions.navigator).toBe(PRESETS.default.regions.navigator)
    expect(layout.ownSpec).toBe(PRESETS.default)
    expect(layout.railOpen).toBe(true)
    expect(layout.treeOpen).toBe(true) // …and stays exactly as it was
    expect(layoutPins()).toEqual({ rail: 'column' })
    // Never a file: the layout in use is still the built-in.
    expect(layout.active).toBe('default')
  })

  it('an earlier navigator pin closed by hand is not re-opened by pinning the rail', () => {
    setLayoutPrefs({ active: 'default' })
    build()
    layout.pin('navigator')
    expect(layout.treeOpen).toBe(true)
    layout.treeOpen = false
    layout.pin('rail')
    expect(layout.treeOpen).toBe(false)
    expect(layout.railOpen).toBe(true)
  })

  it('unpin returns that side to the layout’s own setting and leaves the other pinned', () => {
    setLayoutPrefs({ active: 'default' })
    build()
    layout.pin('navigator')
    layout.pin('rail')
    layout.unpin('navigator')
    expect(layout.spec.regions.navigator).toBe(PRESETS.default.regions.navigator)
    expect(layout.treeOpen).toBe(false)
    expect(layout.spec.regions.rail).toBe('column')
    expect(layout.railOpen).toBe(true)
    expect(layoutPins()).toEqual({ rail: 'column' })
    layout.resetPins()
    expect(layout.pins).toEqual({})
    expect(layout.spec).toBe(PRESETS.default)
  })

  it('pins survive a reload and apply over every layout from the first paint', () => {
    setLayoutPins({ navigator: 'column' })
    setLayoutPrefs({ active: 'default' })
    build()
    expect(layout.spec.regions.navigator).toBe('column')
    expect(layout.treeOpen).toBe(true)
  })

  it('the pins in force go over a resolved file, and a pin made mid-read is not lost', async () => {
    let release: () => void = () => {}
    const pinsSeen: unknown[] = []
    harness = withActions(() =>
      createShellLayout({
        inWorkspace: () => true,
        events: () => [],
        flashes: () => [],
        now: () => 0,
        toast: () => {},
        session: null,
        resolveLayout: async (_choice, pins): Promise<ResolvedLayout> => {
          pinsSeen.push(pins)
          await new Promise<void>((r) => (release = r))
          return { spec: PRESETS.default, unpinned: PRESETS.default, entry: null, error: null }
        },
      })
    )
    layout = harness.actions
    const reading = layout.reload()
    layout.pin('rail')
    release()
    await reading
    flushSync()
    expect(pinsSeen).toEqual([{}])
    expect(layout.spec.regions.rail).toBe('column')
  })
})

describe('createShellLayout — overrides are device edits, applied live (round 3, Q6)', () => {
  const $schema = LAYOUT_SCHEMA_ID
  beforeEach(() => sessionStorage.clear())

  it('setOverrides re-renders at once, persists, and opens a side it turns into a column', () => {
    build()
    expect(layout.treeOpen).toBe(false)
    layout.setOverrides({ $schema, toolbar: { position: 'bottom' }, regions: { navigator: 'column' } })
    flushSync()
    expect(layout.spec.toolbar.position).toBe('bottom')
    expect(layout.spec.regions.navigator).toBe('column')
    expect(layout.treeOpen).toBe(true)
    expect(layout.fileSpec).toBe(PRESETS.default)
    expect(layoutOverrides()).toEqual({ $schema, toolbar: { position: 'bottom' }, regions: { navigator: 'column' } })
    // The same layout file is still in use: overrides are never a file.
    expect(layout.active).toBe('default')
  })

  it('survive a reload, from the first paint; reset drops them', () => {
    setLayoutOverrides({ $schema, editor: { measure: 'wide' } })
    build()
    expect(layout.spec.editor.measure).toBe('wide')
    expect(layout.ownSpec.editor.measure).toBe('wide')
    layout.resetOverrides()
    expect(layout.spec).toBe(PRESETS.default)
    expect(layoutOverrides()).toEqual({ $schema })
  })

  it('precedence: the file, then the overrides, then the pins', () => {
    setLayoutPrefs({ active: 'custom:dense' })
    build()
    layout.setOverrides({ $schema, regions: { rail: 'dock', navigator: 'drawer' } })
    expect(layout.spec.regions.rail).toBe('dock')
    layout.pin('rail')
    expect(layout.ownSpec.regions.rail).toBe('dock')
    expect(layout.spec.regions.rail).toBe('column')
    expect(layout.spec.regions.navigator).toBe('drawer')
    layout.unpin('rail')
    expect(layout.spec.regions.rail).toBe('dock')
  })

  it('the overrides in force go over a resolved file — an edit made mid-read is not lost', async () => {
    let release: () => void = () => {}
    const seen: LayoutFile[] = []
    harness = withActions(() =>
      createShellLayout({
        inWorkspace: () => true,
        events: () => [],
        flashes: () => [],
        now: () => 0,
        toast: () => {},
        session: null,
        overrides: { read: () => ({ $schema }), write: () => {} },
        resolveLayout: async (_choice, _pins, overrides): Promise<ResolvedLayout> => {
          seen.push(overrides)
          await new Promise<void>((r) => (release = r))
          return { spec: EXAMPLES.dense, file: EXAMPLES.dense, entry: null, error: null }
        },
      })
    )
    layout = harness.actions
    const reading = layout.reload()
    layout.setOverrides({ $schema, toolbar: { position: 'bottom' } })
    release()
    await reading
    flushSync()
    expect(seen).toEqual([{ $schema }])
    expect(layout.fileSpec).toBe(EXAMPLES.dense)
    expect(layout.spec.toolbar.position).toBe('bottom')
  })
})

describe('createShellLayout — the column toggles are the tab\'s', () => {
  beforeEach(() => sessionStorage.clear())

  it('a page reload keeps what this tab toggled; a new seed (another layout) does not', () => {
    setLayoutPrefs({ active: 'custom:dense' })
    build()
    layout.railOpen = false
    flushSync()
    harness.stop()
    build()
    expect(layout.railOpen).toBe(false)
    expect(layout.treeOpen).toBe(true)
    harness.stop()
    // The kept toggles were seeded from dense's columns; default's differ.
    setLayoutPrefs({ active: 'default' })
    build()
    expect(layout.railOpen).toBe(false)
    expect(layout.treeOpen).toBe(false)
  })

  it('app.reload-resources re-seeds even when the regions are the same', async () => {
    setLayoutPrefs({ active: 'custom:dense' })
    build()
    layout.railOpen = false
    await layout.reload()
    flushSync()
    expect(layout.railOpen).toBe(true)
  })
})

describe('createShellLayout — Focus mode (quiet-shell F7)', () => {
  beforeEach(() => sessionStorage.clear())

  it('hides every region the spec does not keep, and leaving restores the columns untouched', () => {
    setLayoutPrefs({ active: 'custom:dense' })
    build()
    expect(layout.treeOpen).toBe(true)
    expect(layout.railOpen).toBe(true)
    layout.setFocus(true)
    flushSync()
    expect(layout.focus).toBe(true)
    // dense keeps its header (and the status bar its pill lives in).
    expect(layout.treeOpen).toBe(false)
    expect(layout.railOpen).toBe(false)
    expect(layout.focusKeeps('header')).toBe(true)
    expect(layout.focusKeeps('tabs')).toBe(false)
    layout.toggleFocus()
    flushSync()
    expect(layout.treeOpen).toBe(true)
    expect(layout.railOpen).toBe(true)
    expect(layout.focusKeeps('tabs')).toBe(true)
  })

  it('the default keeps the toolbar only', () => {
    build()
    layout.setFocus(true)
    expect(layout.focusKeeps('toolbar')).toBe(true)
    for (const region of ['navigator', 'rail', 'tabs', 'statusbar', 'header'] as const) {
      expect(layout.focusKeeps(region)).toBe(false)
    }
  })

  it('opening a hidden column leaves Focus mode rather than swallowing the ask', () => {
    build()
    layout.setFocus(true)
    layout.treeOpen = true
    expect(layout.focus).toBe(false)
    expect(layout.treeOpen).toBe(true)
    layout.setFocus(true)
    layout.revealInTree('notes')
    expect(layout.focus).toBe(false)
  })

  it('is never saved: a new shell starts outside it', () => {
    build()
    layout.setFocus(true)
    flushSync()
    harness.stop()
    build()
    expect(layout.focus).toBe(false)
  })
})
