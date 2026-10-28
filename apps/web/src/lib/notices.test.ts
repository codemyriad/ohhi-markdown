import { getLL } from '@ohhi/i18n'
import { EventLog, type AppEvent, type EventInput } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { describeEvent, NOTICE_TEXT, toastsWhenLogged } from './event-text.js'
import { get } from 'svelte/store'
import {
  CLEARED_LIMIT,
  FLASH_LIMIT,
  NOTHING_CLEARED,
  appendFlash,
  clearAll,
  clearedFor,
  clearedNotices,
  clearNotices,
  dismissEvent,
  dismissNote,
  isCleared,
  unclearedEvents,
  type Flash,
} from './notices.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'

const clock = { now: () => 1_000, schedule: () => () => {} }
const one = (input: EventInput): AppEvent => new EventLog({ clock }).append(input)

describe('flashes (gesture feedback, spike S22)', () => {
  it('prepend with fresh ids, never fold a repeat, and cap the queue', () => {
    let list: Flash[] = []
    list = appendFlash(list, { level: 'warn', text: 'Not moved' })
    list = appendFlash(list, { level: 'warn', text: 'Not moved' })
    expect(list).toHaveLength(2)
    expect(new Set(list.map((f) => f.id)).size).toBe(2)
    for (let i = 0; i < FLASH_LIMIT + 3; i++) list = appendFlash(list, { level: 'info', text: `i${i}` })
    expect(list).toHaveLength(FLASH_LIMIT)
    expect(list[0]?.text).toBe(`i${FLASH_LIMIT + 2}`)
  })
})

describe('describeEvent: the words come from the code, at render time', () => {
  const LL = getLL()

  it('keeps every notice string the shell used to bake in, verbatim', () => {
    const notice = (code: keyof typeof NOTICE_TEXT, params?: Record<string, string | number>): string =>
      describeEvent(one({ kind: 'notice', level: 'warn', payload: { code, ...(params ? { params } : {}) } }), LL)
    expect(notice('no_token', { path: 'team' })).toBe(LL.web.workspace.no_token({ path: 'team' }))
    expect(notice('too_many_grants', { count: 9 })).toBe(LL.web.device_link.too_many_grants({ count: 9 }))
    expect(notice('storage_evictable')).toBe(LL.web.storage.notice())
    expect(notice('daily_format', { format: 'YYYY W', tokens: 'W' })).toBe(
      LL.web.daily.unsupported_format({ format: 'YYYY W', tokens: 'W' })
    )
    for (const code of ['mount_error', 'adopt_failed', 'unshare_failed', 'unmount_failed', 'move_failed'] as const) {
      expect(notice(code, { message: 'relay down' })).toBe('relay down')
    }
    expect(notice('add_link_failed', { link_error: 'malformed' })).toBe(LL.web.share.link_error.malformed())
    expect(notice('add_link_failed', { message: 'boom' })).toBe('boom')
  })

  it('words the adopt outcomes, including the four that used to be dropped', () => {
    const mount = (what: AppEvent<'mount.changed'>['payload']['what']): string =>
      describeEvent(one({ kind: 'mount.changed', level: 'info', scope: { path: 'team' }, payload: { what } }), LL)
    expect(mount('needs-token')).toBe(LL.web.workspace.no_token({ path: 'team' }))
    expect(mount('depth-limit')).toBe(LL.web.mounts.reason.depth_limit({ path: 'team' }))
    expect(mount('mount-moved')).toBe(LL.web.mounts.reason.mount_moved({ path: 'team' }))
    expect(mount('room-repointed')).toBe(LL.web.mounts.reason.room_repointed({ path: 'team' }))
    for (const what of ['adopted', 'absorbed', 'adopt-cancelled', 'ghosts-held'] as const) {
      expect(mount(what)).toContain("'team'")
    }
  })

  it('words a relay refusal through i18n, in terms of links — never tokens or CLI words', () => {
    const e = one({ kind: 'relay.state', level: 'error', actor: { kind: 'relay' }, payload: { to: 'refused', reason: 'permission-denied' } })
    expect(describeEvent(e, LL)).toContain('The relay refused this folder (permission-denied)')
    expect(describeEvent(e, LL)).not.toMatch(/token|SEED_SHARE|CLI/)
  })

  it('falls back for a code this build does not know', () => {
    const e = one({ kind: 'notice', level: 'warn', payload: { code: 'from_the_future' } })
    expect(describeEvent(e, LL)).toContain('from_the_future')
  })

  it('toasts errors and warnings once logged, never info, never a self-shown code', () => {
    expect(toastsWhenLogged(one({ kind: 'notice', level: 'warn', payload: { code: 'no_token' } }))).toBe(true)
    expect(toastsWhenLogged(one({ kind: 'mount.changed', level: 'info', payload: { what: 'adopted' } }))).toBe(false)
    expect(toastsWhenLogged(one({ kind: 'notice', level: 'error', payload: { code: 'add_link_failed' } }))).toBe(false)
  })
})

describe('clearing the drawer: rows leave it, the log keeps them', () => {
  const ev = (id: string, at: number, over: Partial<AppEvent> = {}): AppEvent =>
    ({ id, at, level: 'warn', kind: 'notice', scope: {}, actor: { kind: 'app' }, count: 1, payload: { code: 'no_token' }, ...over }) as AppEvent
  const peer = (id: string, at: number, path: string): AppEvent =>
    ev(id, at, { kind: 'doc.changed', level: 'info', scope: { path }, actor: { kind: 'peer', name: 'Sam' }, payload: { guid: 'g', added: 1, removed: 0 } })

  it('Clear all hides everything logged so far, up to the newest event’s own time', () => {
    const events = [ev('a', 300), peer('b', 900, 'x.md'), ev('c', 100)]
    const c = clearAll(events, NOTHING_CLEARED)
    expect(c.at).toBe(900)
    expect(unclearedEvents(events, c)).toEqual([])
    // What comes after is shown; the list handed in is never changed.
    expect(unclearedEvents([ev('d', 901), ...events], c).map((e) => e.id)).toEqual(['d'])
    expect(events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('a dismissed warning comes back when it happens again (a folded repeat moves its time)', () => {
    const w = ev('w', 500)
    const c = dismissEvent(w, NOTHING_CLEARED)
    expect(isCleared(w, c)).toBe(true)
    expect(isCleared({ ...w, at: 600 }, c)).toBe(false)
    expect(isCleared(ev('other', 400), c)).toBe(false)
  })

  it('dismissing a note’s changes hides that note’s changes by others up to then, nothing else', () => {
    const c = dismissNote('x.md', 900, NOTHING_CLEARED)
    expect(isCleared(peer('b', 900, 'x.md'), c)).toBe(true)
    expect(isCleared(peer('b2', 901, 'x.md'), c)).toBe(false)
    expect(isCleared(peer('y', 800, 'y.md'), c)).toBe(false)
    // A warning about the same note is not a change by others.
    expect(isCleared(ev('w', 800, { scope: { path: 'x.md' } }), c)).toBe(false)
  })

  it('keeps at most CLEARED_LIMIT dismissals, dropping the oldest; Clear all drops them all', () => {
    let c = NOTHING_CLEARED
    for (let i = 0; i < CLEARED_LIMIT + 5; i++) c = dismissEvent(ev(`e${i}`, i + 1), c)
    expect(Object.keys(c.events)).toHaveLength(CLEARED_LIMIT)
    expect(c.events.e0).toBeUndefined()
    expect(clearAll([], c)).toEqual({ at: 0, events: {}, notes: {} })
  })

  it('the store clears one vault, keeps it on the device, and leaves other vaults alone', () => {
    useMemStorage()
    try {
      clearedNotices.set({})
      clearNotices('vault-a', [ev('a', 300)])
      expect(clearedFor(get(clearedNotices), 'vault-a').at).toBe(300)
      expect(clearedFor(get(clearedNotices), 'vault-b')).toBe(NOTHING_CLEARED)
      expect(JSON.parse(localStorage.getItem('editor:notices-cleared') ?? '{}')['vault-a'].at).toBe(300)
    } finally {
      dropStorage()
    }
  })
})
