/**
 * *Get the desktop app*: the manifest as the app reads it (and as
 * scripts/downloads-manifest.mjs writes it), the OS a page runs on, the file
 * it is offered, and when any of it is offered at all.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildDownloads } from '../../scripts/downloads-manifest.mjs'
import { detectOs, offersDesktopDownload, parseDownloads, pickDownload } from './downloads.js'
import { createDesktopDownloads } from './downloads.svelte.js'

const written = buildDownloads({
  files: [
    { name: 'ohhi_0.1.42_amd64.deb', size: 9_000_000, sha256: 'c'.repeat(64) },
    { name: 'ohhi_0.1.42_amd64.AppImage', size: 90_000_000, sha256: 'b'.repeat(64) },
    { name: 'ohhi_0.1.42_universal.dmg', size: 30_000_000, sha256: 'a'.repeat(64) },
    { name: 'ohhi_0.1.42_amd64.AppImage.sig', size: 1, sha256: '' },
  ],
  version: '0.1.42',
  baseUrl: 'https://dist.ohhi.md/0.1.42',
  date: '2026-10-16T10:00:00Z',
})

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}

describe('parseDownloads', () => {
  it('reads what scripts/downloads-manifest.mjs writes', () => {
    const m = parseDownloads(JSON.parse(JSON.stringify(written)))!
    expect(m.version).toBe('0.1.42')
    expect(m.date).toBe('2026-10-16T10:00:00Z')
    expect(m.files.map((f) => [f.os, f.kind, f.size])).toEqual([
      ['macos', 'dmg', 30_000_000],
      ['linux', 'appimage', 90_000_000],
      ['linux', 'deb', 9_000_000],
    ])
  })

  it('drops an entry it cannot use, never the list; nothing usable or not a manifest → null', () => {
    const m = parseDownloads({
      schema: 1,
      version: '0.1.42',
      files: [
        { kind: 'dmg', name: 'a.dmg', url: 'http://insecure.example/a.dmg' },
        { kind: 'exe', name: 'a.exe', url: 'https://x.example/a.exe' },
        { kind: 'deb', name: 'a.deb', url: 'https://x.example/a.deb', size: -1 },
        null,
      ],
    })!
    expect(m.files).toEqual([
      { os: 'linux', kind: 'deb', arch: 'universal', name: 'a.deb', url: 'https://x.example/a.deb', size: 0, sha256: '' },
    ])
    expect(parseDownloads({ schema: 1, version: '0.1.42', files: [] })).toBeNull()
    expect(parseDownloads({ schema: 2, version: '0.1.42', files: written.files })).toBeNull()
    expect(parseDownloads('nope')).toBeNull()
    expect(parseDownloads(null)).toBeNull()
  })
})

describe('detectOs', () => {
  it('tells the five apart, Android before Linux and an iPad before a Mac', () => {
    expect(detectOs({ userAgent: UA.mac })).toBe('macos')
    expect(detectOs({ userAgent: UA.linux })).toBe('linux')
    expect(detectOs({ userAgent: UA.windows })).toBe('windows')
    expect(detectOs({ userAgent: UA.android })).toBe('android')
    expect(detectOs({ userAgent: UA.iphone })).toBe('ios')
    // iPadOS asks for the desktop site as a Mac, with a touch screen.
    expect(detectOs({ userAgent: UA.mac, maxTouchPoints: 5 })).toBe('ios')
    // Client hints when the UA string says nothing useful.
    expect(detectOs({ userAgent: 'Mozilla/5.0', userAgentData: { platform: 'Linux' } })).toBe('linux')
    expect(detectOs({ userAgent: '' })).toBeNull()
  })
})

describe('pickDownload', () => {
  const m = parseDownloads(written)!
  it('offers the first file for the OS — the AppImage on Linux, it updates itself — and lists the rest', () => {
    const linux = pickDownload(m, 'linux')
    expect(linux.primary?.kind).toBe('appimage')
    expect(linux.others.map((f) => f.kind)).toEqual(['dmg', 'deb'])
    expect(pickDownload(m, 'macos').primary?.kind).toBe('dmg')
  })
  it('nothing for this OS (Windows, unknown): no primary, every file', () => {
    expect(pickDownload(m, 'windows')).toEqual({ primary: null, others: m.files })
    expect(pickDownload(m, null).primary).toBeNull()
  })
})

describe('offersDesktopDownload', () => {
  it('a browser with a list only', () => {
    expect(offersDesktopDownload(false, 'https://dist.ohhi.md/stable/downloads.json')).toBe(true)
    expect(offersDesktopDownload(true, 'https://dist.ohhi.md/stable/downloads.json')).toBe(false)
    expect(offersDesktopDownload(false, '')).toBe(false)
  })
})

describe('createDesktopDownloads', () => {
  const URL_ = 'https://dist.ohhi.md/stable/downloads.json'
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

  it('fetches once, without credentials or referrer, and picks for this computer', async () => {
    const fetch = ok(written)
    const d = createDesktopDownloads({ url: URL_, desktop: () => false, fetch, navigator: () => ({ userAgent: UA.mac }) })
    expect(d.status).toBe('idle')
    await d.load()
    await d.load()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(URL_, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }))
    expect(d.status).toBe('ready')
    expect(d.pick.primary?.kind).toBe('dmg')
  })

  it('a failed or unusable answer is `failed`, and may be retried', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"schema":1}', { status: 200 }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(written), { status: 200 }))
    const d = createDesktopDownloads({ url: URL_, desktop: () => false, fetch, navigator: () => ({ userAgent: UA.linux }) })
    for (let i = 0; i < 3; i++) {
      await d.load()
      expect(d.status).toBe('failed')
    }
    await d.load()
    expect(d.status).toBe('ready')
    expect(d.pick.primary?.kind).toBe('appimage')
  })

  it('never fetches in the desktop app or without a list', async () => {
    const fetch = ok(written)
    await createDesktopDownloads({ url: URL_, desktop: () => true, fetch }).load()
    await createDesktopDownloads({ url: '', desktop: () => false, fetch }).load()
    expect(fetch).not.toHaveBeenCalled()
  })
})
