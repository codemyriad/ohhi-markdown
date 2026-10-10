/**
 * The manager's row facts (first-run B1): counts are what the mount table
 * says — carved / joined, an adopted mount on its relay's side — and "when
 * opened" is calendar days on this device.
 */
import type { MountDesc } from '@ohhi/vault'
import { describe, expect, it } from 'vitest'
import { factsFromMounts, factsFromUi, openedWhen, readVaultFacts } from './vault-facts.js'
import type { VaultEntry } from './config.js'

const ROOT_RELAY = 'wss://team.example/relay'
const mount = (over: Partial<MountDesc>): MountDesc => ({
  room: 'r',
  path: 'p',
  provenance: 'local',
  status: 'active',
  ...over,
})

describe('factsFromMounts', () => {
  it('counts carved as shared by you and joined as shared with you; the root and local mounts are not shares', () => {
    const facts = factsFromMounts(
      [
        mount({ room: 'root', path: '', provenance: 'local' }),
        mount({ room: 'a', path: 'clients', provenance: 'carved' }),
        mount({ room: 'b', path: 'notes', provenance: 'carved', status: 'needs-token' }),
        mount({ room: 'c', path: 'team', provenance: 'joined', relay: { url: ROOT_RELAY } }),
      ],
      ROOT_RELAY
    )
    expect(facts).toEqual({ sharedByYou: 2, sharedWithYou: 1 })
  })

  it('an adopted mount is yours on the vault\'s own relay and someone else\'s on another', () => {
    const facts = factsFromMounts(
      [
        mount({ room: 'a', path: 'mine', provenance: 'adopted', relay: { url: ROOT_RELAY } }),
        mount({ room: 'b', path: 'theirs', provenance: 'adopted', relay: { url: 'wss://elsewhere.example' } }),
      ],
      ROOT_RELAY
    )
    expect(facts).toEqual({ sharedByYou: 1, sharedWithYou: 1 })
  })

  it('an empty table is nothing shared', () => {
    expect(factsFromMounts([], ROOT_RELAY)).toEqual({ sharedByYou: 0, sharedWithYou: 0 })
  })
})

describe('factsFromUi', () => {
  it('reads the workspace projection by its foreign flag', () => {
    expect(
      factsFromUi([
        { path: 'a', provenance: 'carved', foreign: false },
        { path: 'b', provenance: 'adopted', foreign: true },
        { path: 'c', provenance: 'joined', foreign: true },
      ])
    ).toEqual({ sharedByYou: 1, sharedWithYou: 2 })
  })
})

describe('readVaultFacts', () => {
  const entry: VaultEntry = { name: 'A', room: 'room-a', vault: { kind: 'opfs', id: 'a' } }

  it('is null — never zero — when the table cannot be read', async () => {
    expect(await readVaultFacts(entry, async () => Promise.reject(new Error('locked')))).toBeNull()
  })

  it('counts what the reader returns', async () => {
    expect(await readVaultFacts(entry, async () => [mount({ provenance: 'carved' })])).toEqual({
      sharedByYou: 1,
      sharedWithYou: 0,
    })
  })
})

describe('openedWhen', () => {
  const noon = new Date(2026, 9, 10, 12, 0).getTime()

  it('today, yesterday, then a date — by calendar day, not by 24 hours', () => {
    expect(openedWhen(new Date(2026, 9, 10, 0, 5).getTime(), noon)).toEqual({ kind: 'today' })
    expect(openedWhen(new Date(2026, 9, 9, 23, 59).getTime(), noon)).toEqual({ kind: 'yesterday' })
    expect(openedWhen(new Date(2026, 9, 9, 0, 1).getTime(), noon)).toEqual({ kind: 'yesterday' })
    const older = openedWhen(new Date(2026, 9, 8, 12).getTime(), noon, 'en-GB')
    expect(older).toEqual({ kind: 'date', date: '8 Oct' })
  })

  it('names the year only when it is not this one', () => {
    expect(openedWhen(new Date(2025, 0, 3).getTime(), noon, 'en-GB')).toEqual({ kind: 'date', date: '3 Jan 2025' })
  })
})
