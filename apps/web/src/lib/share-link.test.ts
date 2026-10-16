import { describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import {
  decodeShareLink,
  encodeDeviceLink,
  encodeShareLink,
  encodeShareUrl,
  folderNameOfLabel,
  LINK_TEXT_MAX,
  looksLikeShareLink,
  originForRelay,
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

describe('folderNameOfLabel (the folder a share suggests)', () => {
  it('is the label’s last segment, trimmed; empty without a label', () => {
    expect(folderNameOfLabel('team/notes')).toBe('notes')
    expect(folderNameOfLabel('HackMD notes')).toBe('HackMD notes')
    expect(folderNameOfLabel(' plans / ')).toBe('plans')
    expect(folderNameOfLabel('')).toBe('')
    expect(folderNameOfLabel(undefined)).toBe('')
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

/** A payload built by hand, the way an older (or a forged) link would carry it. */
function rawLink(obj: Record<string, unknown>): string {
  return `editor1:${btoa(JSON.stringify(obj))}`
}

describe('label and from (first-run-shaping C1)', () => {
  const target = { relay: 'wss://ohhi.example.ts.net/relay', room: 'team-room', token: 'tok' }

  it('round-trips with label and from', () => {
    const decoded = decodeShareLink(
      encodeShareLink({ ...target, label: 'Projects/Atlas', from: 'Cynthia' })
    )
    expect(decoded).toEqual({
      ...target,
      kind: 'folder',
      grants: [],
      label: 'Projects/Atlas',
      from: 'Cynthia',
    })
  })

  it('round-trips without them — both read as undefined, and the JSON omits them', () => {
    const link = encodeShareLink(target)
    const decoded = decodeShareLink(link)
    expect(decoded.label).toBeUndefined()
    expect(decoded.from).toBeUndefined()
    const json = JSON.parse(atob(link.slice('editor1:'.length))) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['relay', 'room', 'token', 'v'])
  })

  it('a device link carries the vault name as its label', () => {
    const decoded = decodeShareLink(
      encodeDeviceLink({ ...target, label: 'Notes', from: 'Chris' })
    )
    expect(decoded).toMatchObject({ kind: 'device', label: 'Notes', from: 'Chris' })
  })

  it('trims, drops blanks and truncates over-long text on encode', () => {
    const long = 'x'.repeat(LINK_TEXT_MAX + 50)
    const decoded = decodeShareLink(
      encodeShareLink({ ...target, label: `  ${long}  `, from: '   ' })
    )
    expect(decoded.label).toBe('x'.repeat(LINK_TEXT_MAX))
    expect(decoded.from).toBeUndefined()
    const json = JSON.parse(
      atob(encodeShareLink({ ...target, from: '   ' }).slice('editor1:'.length))
    ) as Record<string, unknown>
    expect('from' in json).toBe(false)
  })

  it('never splits a character when truncating', () => {
    const emoji = '\u{1F600}'.repeat(LINK_TEXT_MAX + 1)
    const label = decodeShareLink(encodeShareLink({ ...target, label: emoji })).label!
    expect(Array.from(label)).toHaveLength(LINK_TEXT_MAX)
    expect(label).toBe('\u{1F600}'.repeat(LINK_TEXT_MAX))
  })

  it('on decode: ignores a non-string, trims and truncates an over-long one', () => {
    const base = { v: 1, relay: 'ws://r', room: 'v', token: 't' }
    const nonString = decodeShareLink(rawLink({ ...base, label: 42, from: { name: 'x' } }))
    expect(nonString.label).toBeUndefined()
    expect(nonString.from).toBeUndefined()
    const long = decodeShareLink(rawLink({ ...base, label: ` ${'y'.repeat(500)}`, from: ' Ana ' }))
    expect(long.label).toBe('y'.repeat(LINK_TEXT_MAX))
    expect(long.from).toBe('Ana')
  })

  it('still refuses grants on a folder link with label and from present', () => {
    const grant = { room: 'other', relay: 'ws://r', token: 'g' }
    expect(
      codeOf(() => encodeShareLink({ ...target, grants: [grant], label: 'L', from: 'F' }))
    ).toBe('grants_on_folder_link')
    expect(
      codeOf(() =>
        decodeShareLink(
          rawLink({ v: 1, relay: 'ws://r', room: 'v', token: 't', grants: [grant], label: 'L', from: 'F' })
        )
      )
    ).toBe('grants_on_folder_link')
  })

  it('old fixture strings decode exactly as before', () => {
    // Pinned literals, not re-encoded at test time: these are links already
    // sitting in chat histories.
    const folder =
      'editor1:eyJ2IjoxLCJyZWxheSI6IndzOi8vciIsInJvb20iOiJvbGQtcm9vbSIsInRva2VuIjoib2xkLXRva2VuIn0'
    expect(decodeShareLink(folder)).toEqual({
      relay: 'ws://r',
      room: 'old-room',
      token: 'old-token',
      kind: 'folder',
      grants: [],
      label: undefined,
      from: undefined,
    })
    expect(encodeShareLink({ relay: 'ws://r', room: 'old-room', token: 'old-token' })).toBe(folder)
  })
})

describe('the URL form (Fork 1-A)', () => {
  const target = { relay: 'wss://ohhi.example.ts.net/relay', room: 'team-room', token: 'tok', label: 'Atlas' }

  it('puts the payload in the fragment of <origin>/join', () => {
    const link = encodeShareLink(target)
    expect(encodeShareUrl(target, 'https://ohhi.example.ts.net')).toBe(
      `https://ohhi.example.ts.net/join#${link}`
    )
    // A trailing slash on the origin is not doubled.
    expect(encodeShareUrl(target, 'https://ohhi.example.ts.net//')).toBe(
      `https://ohhi.example.ts.net/join#${link}`
    )
    // Nothing a server sees (path, query) carries the payload.
    const url = new URL(encodeShareUrl(target, 'https://ohhi.example.ts.net'))
    expect(url.pathname).toBe('/join')
    expect(url.search).toBe('')
  })

  it('decodes all three spellings, trimmed', () => {
    const link = encodeShareLink(target)
    const spellings = [
      link,
      `  https://ohhi.example.ts.net/join#${link}\n`,
      `https://ohhi.example.ts.net/?share=${link}`,
      `http://localhost:5173/?share=${encodeURIComponent(link)}`,
    ]
    for (const s of spellings) {
      expect(looksLikeShareLink(s)).toBe(true)
      expect(decodeShareLink(s)).toMatchObject({ room: 'team-room', token: 'tok', label: 'Atlas' })
    }
  })

  it('a URL carrying no payload is malformed, and does not look like a link', () => {
    for (const s of [
      'https://ohhi.example.ts.net/join',
      'https://ohhi.example.ts.net/join#nope',
      'https://ohhi.example.ts.net/?share=nope',
      'wss://ohhi.example.ts.net/relay',
    ]) {
      expect(looksLikeShareLink(s)).toBe(false)
      expect(codeOf(() => decodeShareLink(s))).toBe('malformed')
    }
  })
})

describe('originForRelay', () => {
  it('derives https://<host> from the team-host shape', () => {
    expect(originForRelay('wss://ohhi.example.ts.net/relay')).toBe('https://ohhi.example.ts.net')
    expect(originForRelay('wss://ohhi.example.ts.net:8443/relay')).toBe(
      'https://ohhi.example.ts.net:8443'
    )
  })

  it('tolerates one trailing slash on /relay', () => {
    expect(originForRelay('wss://ohhi.example.ts.net/relay/')).toBe('https://ohhi.example.ts.net')
  })

  it('is null for anything else — the caller falls back to the bare link', () => {
    expect(originForRelay('ws://ohhi.example.ts.net/relay')).toBeNull()
    expect(originForRelay('wss://localhost/relay')).toBeNull()
    expect(originForRelay('wss://127.0.0.1/relay')).toBeNull()
    expect(originForRelay('ws://localhost:8787')).toBeNull()
    expect(originForRelay('wss://relay.example.com')).toBeNull()
    expect(originForRelay('wss://relay.example.com/sync')).toBeNull()
    expect(originForRelay('wss://relay.example.com/relay/x')).toBeNull()
    expect(originForRelay('not a url')).toBeNull()
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
