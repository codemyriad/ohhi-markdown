/**
 * The shell's membership tracker: one ask per watched note, coalesced on
 * the injected clock, the last answer kept while watched until the next
 * lands, carried across a rename, dropped with its last watcher.
 */
import { MemoryIndex, type IndexDoc } from '@ohhi/index'
import { describe, expect, it, vi } from 'vitest'
import { createMembership, MEMBERSHIP_COALESCE_MS } from './collection-membership.svelte.js'

/** A clock that only moves when the test says so. */
function manualClock() {
  let time = 0
  const tasks: { at: number; fn: () => void; cancelled: boolean }[] = []
  return {
    now: () => time,
    schedule(fn: () => void, ms: number) {
      const task = { at: time + ms, fn, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    advance(ms: number) {
      time += ms
      for (const task of tasks.splice(0)) if (!task.cancelled && task.at <= time) task.fn()
    },
    pending: () => tasks.filter((t) => !t.cancelled).length,
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function setup() {
  const texts = new Map<string, string>([
    ['Competitors.base', 'filters:\n  and:\n    - file.inFolder("Competitors")\nviews:\n  - type: table\n    name: All\n'],
    ['Competitors/Ingredifind.md', '---\nthreat: direct\n---\n'],
    ['Areas/Loose.md', 'text\n'],
  ])
  const index = new MemoryIndex()
  const reindex = () => index.rebuild([...texts.entries()].map(([path, text]): IndexDoc => ({ guid: path, path, text })))
  reindex()
  const rows = vi.spyOn(index, 'rows')
  const clock = manualClock()
  const membership = createMembership({
    index: () => index,
    clock,
    paths: () => [...texts.keys()],
    textOf: (p) => texts.get(p) ?? null,
  })
  return { texts, index, reindex, rows, clock, membership }
}

describe('createMembership', () => {
  it('asks at once for a note never asked about, and keeps the answer per path', async () => {
    const { membership, rows } = setup()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
    const release = membership.watch('Competitors/Ingredifind.md')
    expect(rows).toHaveBeenCalledTimes(1)
    await flush()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(true)
    // A second watcher of the same note (another pane) costs no second ask.
    const again = membership.watch('Competitors/Ingredifind.md')
    expect(rows).toHaveBeenCalledTimes(1)
    release()
    again()
  })

  it('coalesces invalidations on the clock and asks once per watched note', async () => {
    const { membership, rows, clock } = setup()
    membership.watch('Competitors/Ingredifind.md')
    membership.watch('Areas/Loose.md')
    await flush()
    rows.mockClear()
    membership.invalidate()
    membership.invalidate()
    membership.invalidate()
    expect(rows).not.toHaveBeenCalled()
    expect(clock.pending()).toBe(1)
    clock.advance(MEMBERSHIP_COALESCE_MS)
    // One run: one ask per watched note (one collection each).
    expect(rows).toHaveBeenCalledTimes(2)
  })

  it('keeps the last answer until the new one lands, then follows the vault', async () => {
    const { membership, texts, reindex, clock } = setup()
    membership.watch('Competitors/Ingredifind.md')
    await flush()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(true)
    // The collection narrows; until the index answers, the form stays.
    texts.set('Competitors.base', 'filters:\n  and:\n    - threat == "adjacent"\nviews:\n  - type: table\n    name: All\n')
    reindex()
    membership.invalidate()
    clock.advance(MEMBERSHIP_COALESCE_MS)
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(true)
    await flush()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
  })

  it('a released note is not re-asked, and its answer goes with its last watcher', async () => {
    const { membership, rows, clock } = setup()
    const release = membership.watch('Competitors/Ingredifind.md')
    const second = membership.watch('Competitors/Ingredifind.md')
    await flush()
    second()
    // Another pane still shows it: the answer stands.
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(true)
    release()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
    rows.mockClear()
    membership.invalidate()
    clock.advance(MEMBERSHIP_COALESCE_MS)
    expect(rows).not.toHaveBeenCalled()
    // Watched again: asked at once, as a note never seen is.
    membership.watch('Competitors/Ingredifind.md')
    expect(rows).toHaveBeenCalledTimes(1)
    await flush()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(true)
  })

  it('an answer still in flight when its note is released is dropped, not kept', async () => {
    const { membership } = setup()
    const release = membership.watch('Competitors/Ingredifind.md')
    release()
    await flush()
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
  })

  it('a rename carries the answer to the new path — the note and everything under a folder — and the old path keeps none', async () => {
    const { membership, rows } = setup()
    const release = membership.watch('Competitors/Ingredifind.md')
    await flush()
    membership.renamed('Competitors', 'Rivals')
    expect(membership.isMember('Rivals/Ingredifind.md')).toBe(true)
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
    // The remount: the new path is watched (answer at once, no ask), the old released.
    rows.mockClear()
    const next = membership.watch('Rivals/Ingredifind.md')
    release()
    expect(membership.isMember('Rivals/Ingredifind.md')).toBe(true)
    expect(rows).not.toHaveBeenCalled()
    next()
    // A note created later at the old path has earned nothing.
    expect(membership.isMember('Competitors/Ingredifind.md')).toBe(false)
  })

  it('with nothing watched, an invalidation schedules nothing', () => {
    const { membership, clock } = setup()
    membership.invalidate()
    expect(clock.pending()).toBe(0)
  })
})
