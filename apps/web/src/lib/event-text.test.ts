import { getLL } from '@ohhi/i18n'
import type { AppEvent } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { describeEvent, refusalCase } from './event-text.js'

const LL = getLL()

/**
 * A `relay.state` refusal on a room at `mount` ('' = the vault's root). With
 * `joined`, the event says whether the room is a share this device joined;
 * without it (an event logged before the field), the room's place decides.
 */
function refused(mount: string, reason?: string, joined?: boolean): AppEvent<'relay.state'> {
  return {
    id: 'r',
    at: 0,
    level: 'error',
    kind: 'relay.state',
    scope: { room: 'room-x', mount, ...(mount ? { path: mount } : {}) },
    actor: { kind: 'relay', name: 'relay.example' },
    count: 1,
    payload: { to: 'refused', ...(reason ? { reason } : {}), ...(joined !== undefined ? { joined } : {}) },
  }
}

describe('a relay refusal, worded by reason and by whose room it is', () => {
  it('an unknown token on a joined folder is a link to ask for again', () => {
    const e = refused('team', 'unknown_token')
    expect(refusalCase(e)).toBe('link')
    expect(describeEvent(e, LL)).toBe(LL.web.notices.relay_refused_link())
  })

  it('an unknown token on the vault’s own room is this device’s access, not a share link', () => {
    const e = refused('', 'unknown_token')
    expect(refusalCase(e)).toBe('device')
    expect(describeEvent(e, LL)).toBe(LL.web.notices.relay_refused_device())
    expect(describeEvent(e, LL)).not.toBe(LL.web.notices.relay_refused_link())
  })

  it('a folder share opened as a vault of its own: its root room’s dead token is the link’s', () => {
    const e = refused('', 'unknown_token', true)
    expect(refusalCase(e)).toBe('link')
    expect(describeEvent(e, LL)).toBe(LL.web.notices.relay_refused_link())
    expect(describeEvent(e, LL)).not.toBe(LL.web.notices.relay_refused_device())
  })

  it('the event’s own word wins over the room’s place', () => {
    expect(refusalCase(refused('', 'unknown_token', false))).toBe('device')
    expect(refusalCase(refused('team', 'unknown_token', true))).toBe('link')
    expect(refusalCase(refused('team', 'unknown_token', false))).toBe('device')
    expect(refusalCase(refused('', 'out_of_scope', true))).toBe('other')
  })

  it('any other refusal names the reason and says nothing about links', () => {
    for (const reason of ['out_of_scope', 'permission-denied']) {
      expect(refusalCase(refused('team', reason))).toBe('other')
      expect(describeEvent(refused('team', reason), LL)).toBe(LL.web.notices.relay_refused({ reason }))
      expect(describeEvent(refused('', reason), LL)).toBe(LL.web.notices.relay_refused_vault({ reason }))
    }
    expect(describeEvent(refused('team'), LL)).toBe(LL.web.notices.relay_refused({ reason: '' }))
  })
})

describe('a refusal the mount is retrying', () => {
  /** What the mount logs for the first refusal of a retry run: info, `retrying`. */
  const retrying = (mount: string): AppEvent<'relay.state'> => ({
    ...refused(mount, 'permission-denied', false),
    level: 'info',
    payload: { to: 'refused', reason: 'permission-denied', joined: false, retrying: true },
  })

  it('says the relay could not open a document and the app is retrying — not that the device must be linked again', () => {
    const vault = describeEvent(retrying(''), LL)
    expect(vault).toBe(LL.web.notices.relay_refused_retrying_vault({ host: 'relay.example' }))
    expect(vault).not.toBe(LL.web.notices.relay_refused_device())
    expect(vault).not.toBe(LL.web.notices.relay_refused_vault({ reason: 'permission-denied' }))
    expect(describeEvent(retrying('team'), LL)).toBe(LL.web.notices.relay_refused_retrying({ host: 'relay.example' }))
  })

  it('once the retries run out, the final refusal reads as a refusal again', () => {
    // The mount's final refusal after `REFUSAL_RETRY_LIMIT`: error, no `retrying`.
    expect(describeEvent(refused('', 'permission-denied', false), LL)).toBe(
      LL.web.notices.relay_refused_vault({ reason: 'permission-denied' })
    )
  })
})

describe('the mass-change breaker', () => {
  it('a dismissed batch is worded with its count', () => {
    const e: AppEvent<'breaker.dismissed'> = {
      id: 'b',
      at: 0,
      level: 'info',
      kind: 'breaker.dismissed',
      scope: { room: 'room-x', mount: '' },
      actor: { kind: 'disk' },
      count: 1,
      payload: { count: 21 },
    }
    expect(describeEvent(e, LL)).toBe(LL.web.notices.breaker_dismissed({ count: 21 }))
    expect(describeEvent(e, LL)).toContain('21')
  })
})
