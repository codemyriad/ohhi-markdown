import { describe, expect, it } from 'vitest'
import { getLL } from '@editor/i18n'
import {
  decodeShareLink,
  encodeDeviceLink,
  encodeShareLink,
  looksLikeShareLink,
  ShareLinkError,
  shareLinkErrorText,
  type ShareLinkErrorCode,
} from './share-link.js'

/**
 * Every refusal is asserted by CODE, never by the English it renders as:
 * the code is the contract the dialogs and the notice path map through, and
 * the sentence is the dictionary's business.
 */
function codeOf(run: () => unknown): ShareLinkErrorCode {
  try {
    run()
  } catch (err) {
    if (err instanceof ShareLinkError) return err.code
    throw err
  }
  throw new Error('expected a ShareLinkError, nothing was thrown')
}

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
    expect(codeOf(() => decodeShareLink('editor1:@@@not-base64@@@'))).toBe('malformed')
    expect(codeOf(() => decodeShareLink(''))).toBe('malformed')
    // Valid base64 of the wrong shape.
    expect(codeOf(() => decodeShareLink(`editor1:${btoa('{"nope":true}')}`))).toBe('missing_fields')
  })

  it('refuses to encode an incomplete target', () => {
    expect(codeOf(() => encodeShareLink({ relay: '', room: 'r', token: 't' }))).toBe('incomplete_target')
    expect(codeOf(() => encodeShareLink({ relay: 'x', room: '', token: 't' }))).toBe('incomplete_target')
    expect(codeOf(() => encodeShareLink({ relay: 'x', room: 'r', token: '' }))).toBe('incomplete_target')
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
      expect(codeOf(() => encodeDeviceLink({ ...device, grants: grantList as never }))).toBe(
        'bad_grant'
      )
      // …and the same on the way in, where the link came from elsewhere.
      const forged = `editor1:${btoa(
        JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'device', grants: grantList })
      )}`
      expect(codeOf(() => decodeShareLink(forged))).toBe('bad_grant')
    }
    const notAnArray = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'device', grants: 'nope' })
    )}`
    expect(codeOf(() => decodeShareLink(notAnArray))).toBe('bad_grant')
  })

  it('refuses grants on a folder link (R5: a folder share never carries the vault)', () => {
    expect(codeOf(() => encodeShareLink({ ...device, kind: 'folder' }))).toBe('grants_on_folder_link')
    // kind absent ⇒ folder
    expect(codeOf(() => encodeShareLink({ ...device }))).toBe('grants_on_folder_link')
    const forged = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', grants: [grants[0]] })
    )}`
    expect(codeOf(() => decodeShareLink(forged))).toBe('grants_on_folder_link')
  })

  it('rejects an unknown kind rather than guessing', () => {
    const forged = `editor1:${btoa(
      JSON.stringify({ v: 1, relay: 'ws://r', room: 'v', token: 't', kind: 'admin' })
    )}`
    expect(codeOf(() => decodeShareLink(forged))).toBe('unknown_kind')
  })

  it('a device link with no grants is still a device link', () => {
    const decoded = decodeShareLink(encodeDeviceLink({ relay: 'ws://r', room: 'v', token: 't' }))
    expect(decoded.kind).toBe('device')
    expect(decoded.grants).toEqual([])
  })
})

describe('shareLinkErrorText — what the rendering sites show', () => {
  const codes: ShareLinkErrorCode[] = [
    'malformed',
    'missing_fields',
    'unknown_kind',
    'bad_grant',
    'grants_on_folder_link',
    'incomplete_target',
  ]

  it('renders every code from the dictionary, never the code itself', () => {
    for (const code of codes) {
      const text = shareLinkErrorText(new ShareLinkError(code))
      expect(text).toBe(getLL().web.share.link_error[code]())
      expect(text).not.toContain(code)
    }
  })

  it('passes anything that is not a share-link failure straight through', () => {
    // The relay's and the workspace's own errors are already translated.
    expect(shareLinkErrorText(new Error('the relay rejected this token'))).toBe(
      'the relay rejected this token'
    )
    expect(shareLinkErrorText('not even an error')).toBe('not even an error')
  })
})
