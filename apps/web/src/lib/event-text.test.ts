import { getLL } from '@ohhi/i18n'
import type { AppEvent } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { describeEvent, refusalCase } from './event-text.js'

const LL = getLL()

/** A `relay.state` refusal on a room: the vault's own (`mount: ''`) or a joined folder's. */
function refused(mount: string, reason?: string): AppEvent<'relay.state'> {
  return {
    id: 'r',
    at: 0,
    level: 'error',
    kind: 'relay.state',
    scope: { room: 'room-x', mount, ...(mount ? { path: mount } : {}) },
    actor: { kind: 'relay', name: 'relay.example' },
    payload: { to: 'refused', ...(reason ? { reason } : {}) },
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

  it('any other refusal names the reason and says nothing about links', () => {
    for (const reason of ['out_of_scope', 'permission-denied']) {
      expect(refusalCase(refused('team', reason))).toBe('other')
      expect(describeEvent(refused('team', reason), LL)).toBe(LL.web.notices.relay_refused({ reason }))
      expect(describeEvent(refused('', reason), LL)).toBe(LL.web.notices.relay_refused_vault({ reason }))
    }
    expect(describeEvent(refused('team'), LL)).toBe(LL.web.notices.relay_refused({ reason: '' }))
  })
})
