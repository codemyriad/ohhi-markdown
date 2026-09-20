// @vitest-environment jsdom
/**
 * The shell's chrome state (`shell-layout.svelte.ts`): what persists and
 * when, and the notice bookkeeping — one toast per new notice, and "unread"
 * reset by looking at Activity.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { layoutPrefs } from './config.js'
import type { Notice } from './notices.js'
import { createShellLayout, type ShellLayout } from './shell-layout.svelte.js'
import { box, withActions, type ActionsHarness } from './shell-actions.fixture.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import type { ToastData } from './ui/toaster.js'

let harness: ActionsHarness<ShellLayout>
let layout: ShellLayout
let inWorkspace: boolean
let notices: { value: Notice[] | null }
let now: number
let toasted: ToastData[]

const notice = (id: string, at: number, text = id): Notice => ({ id, level: 'info', text, at })

function build(): void {
  harness = withActions(() =>
    createShellLayout({
      inWorkspace: () => inWorkspace,
      notices: () => notices.value,
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
  notices = box<Notice[] | null>([])
  now = 1_000
  toasted = []
})

afterEach(() => {
  harness?.stop()
  dropStorage()
})

describe('createShellLayout', () => {
  it('starts from the saved prefs and persists the booleans as they change', () => {
    build()
    expect(layout.treeOpen).toBe(layoutPrefs().treeOpen)
    layout.treeOpen = false
    layout.railFolded = ['links']
    flushSync()
    expect(layoutPrefs()).toMatchObject({ treeOpen: false, railFolded: ['links'] })
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

  it('showSection opens the rail with that section unfolded; revealInTree opens the navigator', () => {
    build()
    layout.railOpen = false
    layout.railFolded = ['history', 'links']
    layout.showSection('history')
    expect(layout.railOpen).toBe(true)
    expect(layout.railFolded).toEqual(['links'])
    flushSync()
    expect(layout.linksVisible).toBe(false)

    layout.treeOpen = false
    layout.revealInTree('docs')
    expect(layout.treeOpen).toBe(true)
    expect(layout.revealDir).toEqual({ path: 'docs' })
  })

  it('toasts each new notice once, newest first', () => {
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

  it('unread counts what arrived since Activity was last in view', () => {
    build()
    layout.railOpen = true
    layout.railFolded = []
    flushSync()
    expect(layout.activityVisible).toBe(true)

    // Activity was in view at t=1000; fold it, then two notices arrive.
    layout.railFolded = ['activity']
    flushSync()
    now = 3_000
    notices.value = [notice('n2', 2_500), notice('n1', 2_000)]
    flushSync()
    expect(layout.unread).toBe(2)

    // Unfolding it reads them — including one that arrives while it is open.
    layout.railFolded = []
    flushSync()
    expect(layout.unread).toBe(0)
    now = 4_000
    notices.value = [notice('n3', 3_500), ...notices.value!]
    flushSync()
    expect(layout.unread).toBe(0)

    // Off the manager, nothing is "visible", so arrivals stay unread.
    inWorkspace = false
    harness.stop()
    build()
    now = 5_000
    notices.value = [notice('n4', 4_500), ...notices.value!]
    flushSync()
    expect(layout.unread).toBe(4)
  })
})
