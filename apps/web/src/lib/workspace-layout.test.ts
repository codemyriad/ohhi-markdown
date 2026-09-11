import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SavedGroup } from './groups.js'
import { openPath, serialize, split, type Layout } from './panes.js'
import { ids, paneAt, strip } from './panes.fixture.js'
import { dropStorage, seedStored as seed, useMemStorage } from './storage.fixture.js'
import {
  loadLayout,
  loadSavedGroups,
  normalizeSavedGroups,
  saveLayout,
  saveSavedGroups,
} from './workspace-layout.js'

let store = useMemStorage()

beforeEach(() => {
  store = useMemStorage()
})
afterEach(dropStorage)

/** Two panes, two notes — enough shape that a round-trip can lose something. */
function sample(): Layout {
  const { l, gen } = strip('a.md')
  return openPath(split(l, paneAt(l).id, 'row', gen), 'b.md', {}, gen)
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
    expect(store.keys()).toEqual([KEY])
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
    dropStorage()
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
