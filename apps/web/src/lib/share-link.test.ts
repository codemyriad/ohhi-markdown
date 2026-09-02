import { describe, expect, it } from 'vitest'
import { decodeShareLink, encodeShareLink, looksLikeShareLink } from './share-link.js'

describe('share-link codec', () => {
  const target = {
    relay: 'wss://relay.example.com',
    room: '6f3c1e2a-0000-4a1b-9c3d-abcdef012345',
    token: 'deadbeefcafef00d',
  }

  it('round-trips a target', () => {
    expect(decodeShareLink(encodeShareLink(target))).toEqual(target)
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
    expect(decodeShareLink(noPrefix)).toEqual(target)
  })

  it('tolerates surrounding whitespace (copy-paste slop)', () => {
    expect(decodeShareLink(`  ${encodeShareLink(target)}\n`)).toEqual(target)
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
