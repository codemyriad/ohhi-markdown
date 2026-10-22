import { describe, expect, it } from 'vitest'
import { formatHostMarker, parseHostMarker } from '../src/index.js'

describe('host marker (nextcloud-build decision 13)', () => {
  const m = { room: 'r1', vault: 'v1', epoch: 3, instance: 'i1', heartbeat: '2026-10-11T00:00:00.000Z' }

  it('round-trips the fields the custodian writes', () => {
    expect(parseHostMarker(formatHostMarker(m))).toEqual(m)
  })

  it('reads a BOM, CRLF and quoted values; refuses a marker missing a field', () => {
    const crlf = new TextEncoder().encode('﻿---\r\nroom: "r1"\r\nvault: v1\r\nepoch: 3\r\ninstance: i1\r\n---\r\n')
    expect(parseHostMarker(crlf)).toMatchObject({ room: 'r1', epoch: 3, heartbeat: '' })
    expect(parseHostMarker(new TextEncoder().encode('---\nroom: r1\n---\n'))).toBeNull()
    expect(parseHostMarker(new TextEncoder().encode('no frontmatter'))).toBeNull()
  })
})
