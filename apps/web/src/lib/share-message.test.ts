/**
 * The link as it leaves the app, and the sentence it travels in
 * (first-run C1/C4): the URL form when an origin is known — the browser's
 * own, or the team host on the desktop — else the bare `editor1:` link; the
 * message with the network sentence only for the team's relay and the guide
 * only when there is an origin to put it on.
 */
import { describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { decodeShareLink, encodeShareLink } from './share-link.js'
import { guideUrl, isTeamRelay, linkOrigin, presentLink, shareMessage } from './share-message.js'

const LL = getLL()
const t = LL.web.share.sheet
const TEAM = 'wss://ohhi.example.ts.net/relay'
const target = { relay: TEAM, room: 'room-1', token: 'tok', label: 'Projects/Q4', from: 'Chris' }

describe('linkOrigin', () => {
  it('a browser uses its own origin', () => {
    expect(linkOrigin({ desktop: false, locationOrigin: 'https://ohhi.example.ts.net', relayUrl: TEAM })).toBe(
      'https://ohhi.example.ts.net'
    )
    expect(linkOrigin({ desktop: false, locationOrigin: 'http://localhost:5173', relayUrl: 'ws://localhost:8787' })).toBe(
      'http://localhost:5173'
    )
  })

  it('the desktop derives the team host from the room’s relay — only when it IS the team host — never the webview’s origin', () => {
    expect(
      linkOrigin({ desktop: true, locationOrigin: 'tauri://localhost', relayUrl: TEAM, teamHost: 'ohhi.example.ts.net' })
    ).toBe('https://ohhi.example.ts.net')
    expect(
      linkOrigin({ desktop: true, locationOrigin: 'tauri://localhost', relayUrl: TEAM, teamHost: 'OHHI.example.ts.net' })
    ).toBe('https://ohhi.example.ts.net')
  })

  it('the desktop never assumes someone else’s wss://<host>/relay serves the app: bare link', () => {
    // A generic build (no team host): nothing to point at.
    expect(linkOrigin({ desktop: true, locationOrigin: 'tauri://localhost', relayUrl: TEAM })).toBeNull()
    expect(linkOrigin({ desktop: true, locationOrigin: 'tauri://localhost', relayUrl: TEAM, teamHost: '' })).toBeNull()
    // A team build, but the room lives on another group's relay.
    expect(
      linkOrigin({
        desktop: true,
        locationOrigin: 'tauri://localhost',
        relayUrl: 'wss://their-relay.example/relay',
        teamHost: 'ohhi.example.ts.net',
      })
    ).toBeNull()
  })

  it('a public desktop build points links at its public web app — for a wss: relay off this machine only', () => {
    const pub = { desktop: true, locationOrigin: 'tauri://localhost', teamHost: '', publicOrigin: 'https://app.ohhi.md' }
    expect(linkOrigin({ ...pub, relayUrl: 'wss://their-relay.example/relay' })).toBe('https://app.ohhi.md')
    expect(linkOrigin({ ...pub, relayUrl: 'wss://relay.example:8443/' })).toBe('https://app.ohhi.md')
    // Nobody else's join page can reach the sharer's own machine, or a cleartext relay.
    expect(linkOrigin({ ...pub, relayUrl: 'ws://localhost:8787' })).toBeNull()
    expect(linkOrigin({ ...pub, relayUrl: 'wss://localhost:8787' })).toBeNull()
    expect(linkOrigin({ ...pub, relayUrl: 'wss://127.0.0.1/relay' })).toBeNull()
    expect(linkOrigin({ ...pub, relayUrl: 'ws://relay.example' })).toBeNull()
    expect(linkOrigin({ ...pub, relayUrl: 'not a url' })).toBeNull()
    // Not an origin anyone can open → as if unset.
    expect(linkOrigin({ ...pub, publicOrigin: 'tauri://localhost', relayUrl: 'wss://r.example/relay' })).toBeNull()
    // The team host still wins for its own relay.
    expect(
      linkOrigin({ ...pub, teamHost: 'ohhi.example.ts.net', relayUrl: TEAM })
    ).toBe('https://ohhi.example.ts.net')
    // A browser keeps its own origin.
    expect(linkOrigin({ ...pub, desktop: false, locationOrigin: 'https://app.ohhi.md', relayUrl: TEAM })).toBe(
      'https://app.ohhi.md'
    )
  })

  it('a browser’s own origin wins whatever the relay — the join page lives beside the app that made the link', () => {
    expect(
      linkOrigin({ desktop: false, locationOrigin: 'https://app.example', relayUrl: 'wss://their-relay.example/relay', teamHost: '' })
    ).toBe('https://app.example')
  })

  it('no origin anyone can open → null (the bare link)', () => {
    expect(linkOrigin({ desktop: true, locationOrigin: 'tauri://localhost', relayUrl: 'ws://localhost:8787' })).toBeNull()
    expect(linkOrigin({ desktop: false, locationOrigin: 'null', relayUrl: 'ws://localhost:8787' })).toBeNull()
    // A browser with no web origin does not guess one from the relay either.
    expect(linkOrigin({ desktop: false, locationOrigin: 'null', relayUrl: TEAM, teamHost: 'ohhi.example.ts.net' })).toBeNull()
  })
})

describe('presentLink', () => {
  it('is the URL form with the payload in the fragment, carrying label and from', () => {
    const link = presentLink(target, 'https://ohhi.example.ts.net')
    expect(link.startsWith('https://ohhi.example.ts.net/join#editor1:')).toBe(true)
    const decoded = decodeShareLink(link)
    expect(decoded).toMatchObject({ relay: TEAM, room: 'room-1', token: 'tok', label: 'Projects/Q4', from: 'Chris' })
  })

  it('without an origin it is the bare editor1: link', () => {
    expect(presentLink(target, null)).toBe(encodeShareLink(target))
  })
})

describe('isTeamRelay', () => {
  it('matches the build’s default relay by host, only when the build was given one', () => {
    expect(isTeamRelay('wss://ohhi.example.ts.net/relay/', { defaultRelay: TEAM, configured: true })).toBe(true)
    expect(isTeamRelay('wss://other.example/relay', { defaultRelay: TEAM, configured: true })).toBe(false)
    expect(isTeamRelay('ws://localhost:8787', { defaultRelay: 'ws://localhost:8787', configured: false })).toBe(false)
  })
})

describe('shareMessage', () => {
  const link = 'https://ohhi.example.ts.net/join#editor1:abc'

  it('names the folder and the link, then the network sentence, then the guide', () => {
    const msg = shareMessage({
      folder: 'Projects/Q4',
      link,
      networkNote: 'Shares work only while you are on the company tailnet.',
      origin: 'https://ohhi.example.ts.net',
    })
    expect(msg).toBe(
      [
        t.message({ folder: 'Projects/Q4', link }),
        'Shares work only while you are on the company tailnet.',
        t.message_guide({ url: 'https://ohhi.example.ts.net/guide/start.html' }),
      ].join(' ')
    )
  })

  it('with no origin: the bare link, how to paste it in the app, no network sentence when none is given, no guide', () => {
    const msg = shareMessage({ folder: 'notes', link: 'editor1:abc', networkNote: '', origin: null })
    expect(msg).toBe(t.message_bare({ folder: 'notes', link: 'editor1:abc' }))
    expect(msg).not.toBe(t.message({ folder: 'notes', link: 'editor1:abc' }))
  })

  it('guideUrl joins the origin and the getting-started page', () => {
    expect(guideUrl('https://h.example/')).toBe('https://h.example/guide/start.html')
    expect(guideUrl(null)).toBeNull()
  })
})
