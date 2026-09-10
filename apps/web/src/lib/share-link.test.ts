import { describe, expect, it } from 'vitest'
import {
  decodeShareLink,
  encodeDeviceLink,
  encodeShareLink,
  looksLikeShareLink,
} from './share-link.js'

describe('share-link codec', () => {
  const target = {
    relay: 'wss://relay.example.com',
    room: '6f3c1e2a-0000-4a1b-9c3d-abcdef012345',
    token: 'deadbeefcafef00d',
  }

  it('round-trips a target', () => {
    // A link with no kind is a folder link, carrying no grants.
    expect(decodeShareLink(encodeShareLink(target))).toEqual({
      ...target,
      kind: 'folder',
      grants: [],
    })
  })

  it('produces an opaque, prefixed string that hides the secret in plain sight', () => {
    const link = encodeShareLink(target)
    expect(link.startsWith('editor1:')).toBe(true)
    // The token must not appear verbatim (it's inside base64) — that's the R5 point.
    expect(link.includes(target.token)).toBe(false)
    expect(looksLikeShareLink(link)).toBe(true)
    expect(looksLikeShareLink('ws://localhost:8787')).toBe(false)
  })

  it('decodes with or without the prefix', () => {
    const link = encodeShareLink(target)
    const noPrefix = link.slice('editor1:'.length)
    expect(decodeShareLink(noPrefix).room).toBe(target.room)
  })

  it('tolerates surrounding whitespace (copy-paste slop)', () => {
    expect(decodeShareLink(`  ${encodeShareLink(target)}\n`).token).toBe(target.token)
  })

  it('rejects malformed input', () => {
    expect(() => decodeShareLink('editor1:@@@not-base64@@@')).toThrow()
    expect(() => decodeShareLink('')).toThrow()
    // Valid base64 of the wrong shape.
    expect(() => decodeShareLink(`editor1:${btoa('{"nope":true}')}`)).toThrow(/missing/)
  })

  it('refuses to encode an incomplete target', () => {
    expect(() => encodeShareLink({ relay: '', room: 'r', token: 't' })).toThrow()
    expect(() => encodeShareLink({ relay: 'x', room: '', token: 't' })).toThrow()
    expect(() => encodeShareLink({ relay: 'x', room: 'r', token: '' })).toThrow()
  })
})

describe('device links (device-link-shaping A4-B)', () => {
  const grants = [
    { room: 'team-room', relay: 'wss://relay.example.com', token: 'team-token' },
    { room: 'cynthias-room', relay: 'wss://other-relay.example.com', token: 'foreign-token' },
  ]
  const device = {
    relay: 'wss://relay.example.com',
    room: 'vault-room',
    token: 'device-token',
    grants,
  }

  it('round-trips a device link with its grants', () => {
    const decoded = decodeShareLink(encodeDeviceLink(device))
    expect(decoded).toEqual({ ...device, kind: 'device' })
    // Foreign mounts keep their own relay — a bundle is not one relay's list.
    expect(decoded.grants[1]!.relay).toBe('wss://other-relay.example.com')
  })

  it('a link written before N2 (no kind) decodes as a folder link', () => {
    const legacy = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'old-room', token: 'old-token' })
    )}`
    expect(decodeShareLink(legacy)).toEqual({
      relay: 'ws://r',
      room: 'old-room',
      token: 'old-token',
      kind: 'folder',
      grants: [],
    })
  })

  it('a folder link is byte-identical to the pre-N2 format (no kind, no grants)', () => {
    const link = encodeShareLink({ relay: 'ws://r', room: 'x', token: 't' })
    const json = JSON.parse(atob(link.slice('editor1:'.length))) as Record<string, unknown>
    expect(json).toEqual({ v: 1, relay: 'ws://r', room: 'x', token: 't' })
  })

  it('drops a redundant grant for the link’s own room and dedupes by room', () => {
    const decoded = decodeShareLink(
      encodeDeviceLink({
        ...device,
        grants: [
          { room: 'vault-room', relay: 'ws://r', token: 'same-as-the-link' },
          grants[0]!,
          { room: 'team-room', relay: 'ws://r', token: 'a-second-team-token' },
        ],
      })
    )
    expect(decoded.grants).toEqual([grants[0]])
  })

  it('is strict about malformed grants — a broken link is an error, not a partial one', () => {
    const bad = [
      [{ room: 'r', relay: 'ws://r' }], // no token
      [{ room: '', relay: 'ws://r', token: 't' }], // blank room
      [{ room: 'r', relay: '', token: 't' }], // blank relay
      [null],
      ['not-a-grant'],
    ]
    for (const grantList of bad) {
      expect(() =>
        encodeDeviceLink({ ...device, grants: grantList as never })
      ).toThrow(/grant/)
      // …and the same on the way in, where the link came from elsewhere.
      const forged = `editor1:${btoa(
        JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'device', grants: grantList })
      )}`
      expect(() => decodeShareLink(forged)).toThrow(/grant/)
    }
    const notAnArray = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'device', grants: 'nope' })
    )}`
    expect(() => decodeShareLink(notAnArray)).toThrow(/grant/)
  })

  it('refuses grants on a folder link (R5: a folder share never carries the vault)', () => {
    expect(() => encodeShareLink({ ...device, kind: 'folder' })).toThrow(/device link/)
    expect(() => encodeShareLink({ ...device })).toThrow(/device link/) // kind absent ⇒ folder
    const forged = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', grants: [grants[0]] })
    )}`
    expect(() => decodeShareLink(forged)).toThrow(/device link/)
  })

  it('rejects an unknown kind rather than guessing', () => {
    const forged = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'admin' })
    )}`
    expect(() => decodeShareLink(forged)).toThrow(/kind/)
  })

  it('a device link with no grants is still a device link', () => {
    const decoded = decodeShareLink(encodeDeviceLink({ relay: 'ws://r', room: 'v', token: 't' }))
    expect(decoded.kind).toBe('device')
    expect(decoded.grants).toEqual([])
  })
})
