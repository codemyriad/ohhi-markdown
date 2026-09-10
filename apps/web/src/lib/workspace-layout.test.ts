import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SavedGroup } from './groups.js'
import { createLayout, openPath, panes, serialize, split, type Layout } from './panes.js'
import {
  loadLayout,
  loadSavedGroups,
  normalizeSavedGroups,
  saveLayout,
  saveSavedGroups,
} from './workspace-layout.js'

/** Minimal Storage over a Map — config.ts's helpers only need these three. */
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
  keys(): string[] {
    return [...this.m.keys()]
  }
}

const g = globalThis as { localStorage?: unknown }

beforeEach(() => {
  g.localStorage = new MemStorage()
})
afterEach(() => {
  delete g.localStorage
})

function seed(key: string, value: unknown): void {
  ;(g.localStorage as MemStorage).setItem(
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}

function ids(prefix = 'i'): () => string {
  let n = 0
  return () => `${prefix}${n++}`
}

function sample(): Layout {
  const gen = ids()
  let l = openPath(createLayout(gen), 'a.md', {}, gen)
  l = split(l, panes(l.tree)[0].id, 'row', gen)
  return openPath(l, 'b.md', {}, gen)
}

const KEY = 'editor:workspace:room-a'

describe('the device-local workspace store', () => {
  it('starts empty and says so', () => {
    expect(loadLayout('room-a', ids())).toBeNull()
    expect(loadSavedGroups('room-a')).toEqual([])
  })

  it('round-trips a layout through localStorage under one key per vault', () => {
    const l = sample()
    saveLayout('room-a', l)
    expect((g.localStorage as MemStorage).keys()).toEqual([KEY])
    const back = loadLayout('room-a', ids('r'))
    expect(back).not.toBeNull()
    expect(serialize(back!)).toEqual(serialize(l))
  })

  it('keeps the two halves under one key, whichever is written', () => {
    const l = sample()
    const groups: SavedGroup[] = [
      { id: 'sg1', name: 'Edible', color: 7, lastActive: 5, tabs: [{ path: 'x.md', cursor: null, scroll: 0 }] },
    ]
    saveLayout('room-a', l)
    saveSavedGroups('room-a', groups)
    expect(loadSavedGroups('room-a')).toEqual(groups)
    expect(serialize(loadLayout('room-a', ids('r'))!)).toEqual(serialize(l))
    // …and writing the layout again does not drop the list.
    saveLayout('room-a', openPath(l, 'c.md', {}, ids('c')))
    expect(loadSavedGroups('room-a')).toEqual(groups)
  })

  it('is per vault: one room’s layout is not another’s', () => {
    saveLayout('room-a', sample())
    expect(loadLayout('room-b', ids())).toBeNull()
  })

  it('ignores anything it cannot read — losing it costs a re-open, not data', () => {
    seed(KEY, 'not json at all')
    expect(loadLayout('room-a', ids())).toBeNull()
    seed(KEY, { version: 99, layout: {}, savedGroups: [] })
    expect(loadLayout('room-a', ids())).toBeNull()
    expect(loadSavedGroups('room-a')).toEqual([])
    seed(KEY, { version: 1, layout: { version: 1, tree: { kind: 'wat' } }, savedGroups: 'nope' })
    expect(loadLayout('room-a', ids())).toBeNull()
    expect(loadSavedGroups('room-a')).toEqual([])
  })

  it('survives storage being unavailable', () => {
    delete g.localStorage
    expect(() => saveLayout('room-a', sample())).not.toThrow()
    expect(loadLayout('room-a', ids())).toBeNull()
    expect(loadSavedGroups('room-a')).toEqual([])
  })
})

describe('normalizeSavedGroups', () => {
  it('keeps a group that is still a usable list of paths', () => {
    expect(
      normalizeSavedGroups([
        { id: 'sg1', tabs: [{ path: 'a.md', cursor: { anchor: 1, head: 2 }, scroll: 10 }] },
        { name: 'no tabs', tabs: [] },
        { name: 'bad tabs', tabs: [{ path: 7 }, null] },
        'nope',
      ])
    ).toEqual([
      {
        id: 'sg1',
        name: '',
        color: 1,
        lastActive: 0,
        tabs: [{ path: 'a.md', cursor: { anchor: 1, head: 2 }, scroll: 10 }],
      },
    ])
  })

  it('clamps the colour into the token band and drops junk resume points', () => {
    const [only] = normalizeSavedGroups([
      {
        id: 'sg',
        name: 'x',
        color: 42,
        lastActive: 'soon',
        tabs: [{ path: 'a.md', cursor: { anchor: 'x' }, scroll: -5 }],
      },
    ])
    expect(only.color).toBe(1)
    expect(only.lastActive).toBe(0)
    expect(only.tabs[0]).toEqual({ path: 'a.md', cursor: null, scroll: 0 })
  })

  it('is not an array of groups → no groups', () => {
    expect(normalizeSavedGroups(undefined)).toEqual([])
    expect(normalizeSavedGroups({ id: 'sg' })).toEqual([])
  })
})
