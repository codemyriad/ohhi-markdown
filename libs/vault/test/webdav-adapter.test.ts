/**
 * WebDavVaultAdapter over the testkit's in-memory WebDAV fake, on a SimClock
 * (nextcloud-build decisions 9, 10, 12). The conformance suites
 * (adapters.test.ts, dir-ops.test.ts) run this adapter too; this file pins
 * what only a WebDAV adapter has: the CAS matrix, status mapping, URL
 * containment, foreign-entry hiding and the ETag walk.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebDavFake, SimClock, type WebDavFake } from '@ohhi/testkit'
import { hashBytes } from '../src/hash.js'
import {
  OHHI_HOST_MARKER,
  VaultUnavailableError,
  WebDavError,
  WriteConflictError,
  WriteRefusedError,
  type WatchEvent,
} from '../src/types.js'
import {
  WalkRaceError,
  hrefToPath,
  parseMultistatus,
  parseXml,
  WebDavPathError,
  WebDavVaultAdapter,
  type WebDavAdapterOptions,
} from '../src/webdav/index.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))

const fakes: WebDavFake[] = []
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close()
})

interface Rig {
  fake: WebDavFake
  clock: SimClock
  a: WebDavVaultAdapter
  ignored: [string, string][]
  walkErrors: unknown[]
  /** Requests since the last call (method + vault-relative-ish path). */
  since: () => string[]
}

async function rig(
  o: Partial<WebDavAdapterOptions> & {
    vault?: string
    beforeFetch?: (method: string, url: string) => void
    /** Model Nextcloud's same-second etag stickiness, on the rig's SimClock. */
    sameSecondEtags?: boolean
  } = {}
): Promise<Rig> {
  const clock = new SimClock()
  const fake = await createWebDavFake(
    o.sameSecondEtags ? { owner: 'alice', clock, sameSecondEtags: true } : { owner: 'alice' }
  )
  fakes.push(fake)
  const vault = o.vault ?? 'vault'
  fake.mkdir('vault')
  const ignored: [string, string][] = []
  const walkErrors: unknown[] = []
  const a = new WebDavVaultAdapter({
    baseUrl: `${fake.url}${vault}/`,
    headers: () => ({ Authorization: 'Basic eDp4' }),
    clock,
    owner: 'alice',
    onIgnored: (p, r) => ignored.push([p, r]),
    onWalkError: (e) => walkErrors.push(e),
    fetch: (input, init) => {
      o.beforeFetch?.(init?.method ?? 'GET', String(input))
      return fetch(input, init)
    },
    ...o,
  })
  let mark = fake.requests.length
  const since = (): string[] => {
    const out = fake.requests.slice(mark).map((r) => `${r.method} ${r.path}`)
    mark = fake.requests.length
    return out
  }
  return { fake, clock, a, ignored, walkErrors, since }
}

const rejection = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e)

describe('writeAtomic compare-and-swap over WebDAV (decision 9)', () => {
  it("new: expectHash '' creates with If-None-Match", async () => {
    const { a, fake, since } = await rig()
    await a.writeAtomic('n.md', enc('new\n'), { expectHash: '' })
    expect(dec(fake.files.get('vault/n.md')!.bytes)).toBe('new\n')
    expect(since()).toEqual(['PUT vault/n.md'])
  })

  it("exists: expectHash '' on an existing file is a conflict naming what is there", async () => {
    const { a, fake } = await rig()
    fake.put('vault/n.md', 'theirs\n')
    const err = await rejection(a.writeAtomic('n.md', enc('mine\n'), { expectHash: '' }))
    expect(err).toBeInstanceOf(WriteConflictError)
    expect(err).toMatchObject({ path: 'n.md', expected: '', actual: hashBytes(enc('theirs\n')) })
    expect(dec(fake.files.get('vault/n.md')!.bytes)).toBe('theirs\n')
  })

  it('stale: a hash that no longer matches refuses before any PUT', async () => {
    const { a, fake, since } = await rig()
    fake.put('vault/n.md', 'v2\n')
    since()
    const err = await rejection(a.writeAtomic('n.md', enc('v3\n'), { expectHash: hashBytes(enc('v1\n')) }))
    expect(err).toMatchObject({ expected: hashBytes(enc('v1\n')), actual: hashBytes(enc('v2\n')) })
    expect(since()).toEqual(['GET vault/n.md'])
    expect(dec(fake.files.get('vault/n.md')!.bytes)).toBe('v2\n')
  })

  it("expecting content where there is none reports actual ''", async () => {
    const { a } = await rig()
    const err = await rejection(a.writeAtomic('gone.md', enc('x'), { expectHash: hashBytes(enc('x')) }))
    expect(err).toMatchObject({ actual: '' })
  })

  it('good: GET → hash → PUT If-Match, and the new etag is the server’s', async () => {
    const { a, fake, since } = await rig()
    fake.put('vault/n.md', 'v1\n')
    const before = fake.etagOf('vault/n.md')
    since()
    await a.writeAtomic('n.md', enc('v2\n'), { expectHash: hashBytes(enc('v1\n')) })
    expect(since()).toEqual(['GET vault/n.md', 'PUT vault/n.md'])
    expect(dec(fake.files.get('vault/n.md')!.bytes)).toBe('v2\n')
    expect(fake.etagOf('vault/n.md')).not.toBe(before)
  })

  it('etag bumped, same bytes: the 412 re-GETs and retries ONCE', async () => {
    let bumped = false
    const r = await rig({
      beforeFetch: (method) => {
        if (method === 'PUT' && !bumped) {
          bumped = true
          r.fake.bump('vault/n.md') // a metadata touch: new etag, same bytes
        }
      },
    })
    r.fake.put('vault/n.md', 'v1\n')
    r.since()
    await r.a.writeAtomic('n.md', enc('v2\n'), { expectHash: hashBytes(enc('v1\n')) })
    expect(r.since()).toEqual(['GET vault/n.md', 'PUT vault/n.md', 'GET vault/n.md', 'PUT vault/n.md'])
    expect(dec(r.fake.files.get('vault/n.md')!.bytes)).toBe('v2\n')
  })

  it('bytes changed between GET and PUT: the If-Match 412 becomes a conflict, theirs kept', async () => {
    let raced = false
    const r = await rig({
      beforeFetch: (method) => {
        if (method === 'PUT' && !raced) {
          raced = true
          r.fake.put('vault/n.md', 'agent\n')
        }
      },
    })
    r.fake.put('vault/n.md', 'v1\n')
    const err = await rejection(r.a.writeAtomic('n.md', enc('mine\n'), { expectHash: hashBytes(enc('v1\n')) }))
    expect(err).toBeInstanceOf(WriteConflictError)
    expect(err).toMatchObject({ actual: hashBytes(enc('agent\n')) })
    expect(dec(r.fake.files.get('vault/n.md')!.bytes)).toBe('agent\n')
  })

  it('etag bumped twice: one retry only, then a conflict', async () => {
    const r = await rig({
      beforeFetch: (method) => {
        if (method === 'PUT') r.fake.bump('vault/n.md')
      },
    })
    r.fake.put('vault/n.md', 'v1\n')
    r.since()
    const err = await rejection(r.a.writeAtomic('n.md', enc('v2\n'), { expectHash: hashBytes(enc('v1\n')) }))
    expect(err).toBeInstanceOf(WriteConflictError)
    expect(r.since().filter((x) => x.startsWith('PUT'))).toHaveLength(2)
    expect(dec(r.fake.files.get('vault/n.md')!.bytes)).toBe('v1\n')
  })

  it('no expectHash: a plain PUT, parents created on 409', async () => {
    const { a, fake, since } = await rig()
    await a.writeAtomic('deep/er/n.md', enc('x'))
    expect(dec(fake.files.get('vault/deep/er/n.md')!.bytes)).toBe('x')
    expect(since()).toEqual([
      'PUT vault/deep/er/n.md',
      'MKCOL vault/deep/er',
      'MKCOL vault/deep',
      'MKCOL vault/deep/er',
      'PUT vault/deep/er/n.md',
    ])
  })
})

/**
 * Nextcloud 35 keeps a FILE's etag for a rewrite inside the same wall-clock
 * second (measured). If-Match alone would then let a write that landed in
 * that second through; the adapter waits for the next second instead.
 */
describe('same-second etags (measured NC 35 quirk)', () => {
  it('CAS waits out the second the file was modified in, then sees the hidden write', async () => {
    const r = await rig({ sameSecondEtags: true })
    r.clock.advance(400)
    r.fake.put('vault/n.md', 'v1\n')
    const etag = r.fake.etagOf('vault/n.md')
    r.since()
    const write = rejection(r.a.writeAtomic('n.md', enc('mine\n'), { expectHash: hashBytes(enc('v1\n')) }))
    await vi.waitFor(() => expect(r.clock.pendingCount()).toBe(1))
    // Another client rewrites it inside the same second: the etag does not move.
    r.fake.put('vault/n.md', 'agent\n')
    expect(r.fake.etagOf('vault/n.md')).toBe(etag)
    r.clock.advance(1_000)
    const err = await write
    expect(err).toBeInstanceOf(WriteConflictError)
    expect(err).toMatchObject({ actual: hashBytes(enc('agent\n')) })
    expect(dec(r.fake.files.get('vault/n.md')!.bytes)).toBe('agent\n')
    expect(r.since()).toEqual(['GET vault/n.md', 'GET vault/n.md'])
  })

  it('a settled file is written at once; a fresh one after one wait', async () => {
    const r = await rig({ sameSecondEtags: true })
    r.fake.put('vault/n.md', 'v1\n')
    r.clock.advance(1_000)
    r.since()
    await r.a.writeAtomic('n.md', enc('v2\n'), { expectHash: hashBytes(enc('v1\n')) })
    expect(r.since()).toEqual(['GET vault/n.md', 'PUT vault/n.md'])
    const again = r.a.writeAtomic('n.md', enc('v3\n'), { expectHash: hashBytes(enc('v2\n')) })
    await vi.waitFor(() => expect(r.clock.pendingCount()).toBe(1))
    r.clock.advance(1_000)
    await again
    expect(dec(r.fake.files.get('vault/n.md')!.bytes)).toBe('v3\n')
    expect(r.since()).toEqual(['GET vault/n.md', 'GET vault/n.md', 'PUT vault/n.md'])
  })

  it('the walk re-reports a file rewritten in the second it was listed', async () => {
    const r = await rig({ sameSecondEtags: true })
    r.fake.put('vault/x/1.md', 'one')
    r.fake.put('vault/y/2.md', 'two')
    const events: WatchEvent[] = []
    const stop = r.a.watch((ev) => events.push(ev))
    r.clock.advance(0)
    await r.a.idle() // primed at t=0
    const etag = r.fake.etagOf('vault/x/1.md')
    r.fake.put('vault/x/1.md', 'ONE, same second') // after the listing, same second
    expect(r.fake.etagOf('vault/x/1.md')).toBe(etag)
    r.clock.advance(30_000)
    await r.a.idle()
    expect(events).toEqual([{ paths: ['x/1.md'] }])
    r.clock.advance(30_000) // nothing new: no re-report
    await r.a.idle()
    expect(events).toHaveLength(1)
    stop()
  })
})

describe('typed errors (decision 9)', () => {
  it('a 404 on the vault root is VaultUnavailableError, never "absent"', async () => {
    const { a } = await rig({ vault: 'missing' })
    await expect(a.read('a.md')).rejects.toBeInstanceOf(VaultUnavailableError)
    await expect(a.list()).rejects.toBeInstanceOf(VaultUnavailableError)
    await expect(a.writeAtomic('a.md', enc('x'), { expectHash: hashBytes(enc('x')) })).rejects.toBeInstanceOf(
      VaultUnavailableError
    )
  })

  it('a 404 on the file is null', async () => {
    const { a } = await rig()
    expect(await a.read('nope.md')).toBeNull()
  })

  it('503 on a read throws a WebDavError with the vault-relative path', async () => {
    const { a, fake } = await rig()
    fake.put('vault/a.md', 'x')
    fake.failNext('GET', 503)
    const err = await rejection(a.read('a.md'))
    expect(err).toBeInstanceOf(WebDavError)
    expect(err).not.toBeInstanceOf(WriteRefusedError)
    expect(err).toMatchObject({ status: 503, method: 'GET', path: 'a.md' })
  })

  it('401 on a listing throws, it never reads as an empty vault', async () => {
    const { a, fake } = await rig()
    fake.failNext('PROPFIND', 401)
    await expect(a.list()).rejects.toMatchObject({ status: 401, method: 'PROPFIND' })
  })

  it.each([403, 423, 507, 400])('%i on a write is WriteRefusedError', async (status) => {
    const { a, fake } = await rig()
    fake.failNext('PUT', status)
    const err = await rejection(a.writeAtomic('a.md', enc('x')))
    expect(err).toBeInstanceOf(WriteRefusedError)
    expect(err).toMatchObject({ status, method: 'PUT', path: 'a.md' })
  })

  it('a 5xx on a write is a plain WebDavError', async () => {
    const { a, fake } = await rig()
    fake.failNext('PUT', 502)
    const err = await rejection(a.writeAtomic('a.md', enc('x')))
    expect(err).toBeInstanceOf(WebDavError)
    expect(err).not.toBeInstanceOf(WriteRefusedError)
  })
})

describe('errors name the file being written (nextcloud-build R1 #8)', () => {
  it('a refused parent MKCOL names the FILE, so its doc can be marked blocked', async () => {
    const { a, fake } = await rig()
    fake.failNext('MKCOL', 423)
    const err = await rejection(a.writeAtomic('deep/new.md', enc('x')))
    expect(err).toBeInstanceOf(WriteRefusedError)
    expect(err).toMatchObject({ status: 423, method: 'MKCOL', path: 'deep/new.md' })
  })

  it('Nextcloud unreachable is a WebDavError with status 0 and the path', async () => {
    const { a } = await rig({
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    const err = await rejection(a.writeAtomic('a.md', enc('x')))
    expect(err).toBeInstanceOf(WebDavError)
    expect(err).toMatchObject({ status: 0, method: 'PUT', path: 'a.md' })
  })
})

describe('URL containment (decision 12)', () => {
  it('percent-encodes every segment and stays under the base', async () => {
    const { a, fake } = await rig()
    const base = `${fake.url}vault/`
    expect(a.url('a b/c#d?e%.md')).toBe(`${base}a%20b/c%23d%3Fe%25.md`)
    expect(a.url('sub', true)).toBe(`${base}sub/`)
    expect(a.url('')).toBe(base)
  })

  it.each(['../x.md', 'a/../../x.md', './x.md', 'a//b.md', '/abs.md', 'a/', 'nul\0.md'])(
    'refuses %j before any request',
    async (path) => {
      const { a, since } = await rig()
      expect(() => a.url(path)).toThrow(WebDavPathError)
      await expect(a.read(path)).rejects.toBeInstanceOf(WebDavPathError)
      await expect(a.writeAtomic(path, enc('x'))).rejects.toBeInstanceOf(WebDavPathError)
      await expect(a.rename('ok.md', path)).rejects.toBeInstanceOf(WebDavPathError)
      expect(since()).toEqual([])
    }
  )

  it('refuses every write under an ignored dir or at a reserved name; the marker goes through writeReserved', async () => {
    const { a, fake, since } = await rig()
    await a.writeAtomic('ok.md', enc('ok'))
    since()
    for (const path of ['.obsidian/plugins/x/main.js', 'notes/.git/config', OHHI_HOST_MARKER]) {
      await expect(a.writeAtomic(path, enc('x')), path).rejects.toBeInstanceOf(WebDavPathError)
      await expect(a.rename('ok.md', path), path).rejects.toBeInstanceOf(WebDavPathError)
      await expect(a.remove(path), path).rejects.toBeInstanceOf(WebDavPathError)
    }
    await expect(a.rename('.obsidian/app.json', 'stolen.md')).rejects.toBeInstanceOf(WebDavPathError)
    await expect(a.mkdir('.obsidian/plugins')).rejects.toBeInstanceOf(WebDavPathError)
    await expect(a.removeDir('.trash')).rejects.toBeInstanceOf(WebDavPathError)
    expect(since()).toEqual([])
    // The one exception: the custodian's lease, under CAS like any write.
    await a.writeReserved(OHHI_HOST_MARKER, enc('marker'), { expectHash: '' })
    expect(dec(fake.files.get(`vault/${OHHI_HOST_MARKER}`)!.bytes)).toBe('marker')
    await expect(a.writeReserved('ok.md', enc('x'))).rejects.toBeInstanceOf(WebDavPathError)
    await expect(a.writeReserved(OHHI_HOST_MARKER, enc('y'), { expectHash: '' })).rejects.toBeInstanceOf(
      WriteConflictError
    )
  })

  it('round-trips awkward names through PUT, PROPFIND and GET', async () => {
    const { a } = await rig()
    const name = 'Ünïcode & spaces/50% #1 (draft)?.md'
    await a.writeAtomic(name, enc('ok'))
    expect((await a.list()).map((f) => f.path)).toEqual([name])
    expect(dec(await a.read(name))).toBe('ok')
  })

  it('maps hrefs onto the vault only when they are under the base', () => {
    const base = 'https://nc.test/remote.php/dav/files/alice/My%20Vault/'
    expect(hrefToPath('/remote.php/dav/files/alice/My%20Vault/a%20b.md', base)).toBe('a b.md')
    expect(hrefToPath('/remote.php/dav/files/alice/My Vault/sub/', base)).toBe('sub')
    expect(hrefToPath('/remote.php/dav/files/alice/My%20Vault/', base)).toBe('')
    expect(hrefToPath('/remote.php/dav/files/alice/Other/x.md', base)).toBeNull()
    expect(hrefToPath('/remote.php/dav/files/alice/My%20Vault/a%2Fb.md', base)).toBeNull()
    expect(hrefToPath('https://nc.test/remote.php/dav/files/alice/My%20Vault/x.md', base)).toBe('x.md')
  })
})

describe('the multistatus reader', () => {
  it('resolves namespaces by URI, not by prefix, and keeps only 200 propstats', () => {
    const xml = `<?xml version="1.0"?>
      <!-- any prefixes will do -->
      <multistatus xmlns="DAV:" xmlns:o="http://owncloud.org/ns" xmlns:n="http://nextcloud.org/ns">
        <response><href>/dav/v/</href><propstat><prop><getetag>&quot;r1&quot;</getetag>
          <resourcetype><collection/></resourcetype><o:fileid>7</o:fileid></prop>
          <status>HTTP/1.1 200 OK</status></propstat></response>
        <response><href>/dav/v/a%26b.md</href>
          <propstat><prop><getetag>"f1"</getetag><resourcetype/><getcontentlength>12</getcontentlength>
            <getlastmodified>Sun, 11 Oct 2026 13:44:10 GMT</getlastmodified><o:fileid>8</o:fileid><o:owner-id>alice</o:owner-id><n:mount-type/></prop>
            <status>HTTP/1.1 200 OK</status></propstat>
          <propstat><prop><o:permissions>XX</o:permissions></prop><status>HTTP/1.1 404 Not Found</status></propstat>
        </response>
        <response><href>/dav/v/gone.md</href><status>HTTP/1.1 404 Not Found</status></response>
      </multistatus>`
    expect(parseMultistatus(xml, 'https://h/dav/v/')).toEqual([
      { path: '', isDir: true, etag: '"r1"', fileid: '7', permissions: '', ownerId: '', mountType: '', size: 0, mtime: null },
      {
        path: 'a&b.md',
        isDir: false,
        etag: '"f1"',
        fileid: '8',
        permissions: '',
        ownerId: 'alice',
        mountType: '',
        size: 12,
        mtime: Date.parse('Sun, 11 Oct 2026 13:44:10 GMT'),
      },
    ])
  })

  it('handles CDATA, numeric entities and rejects unbalanced documents', () => {
    const doc = parseXml('<a xmlns="urn:x"><b><![CDATA[<raw>]]>&#65;&#x42;</b></a>')
    expect(doc.children[0]!.children[0]!.text).toBe('<raw>AB')
    expect(() => parseXml('<a><b></a>')).toThrow()
    expect(() => parseXml('<a>')).toThrow()
  })
})

describe('hidden entries: foreign owner, foreign mount, ignored dirs, reserved root file', () => {
  it('never lists them, never descends into them, and logs each foreign path once', async () => {
    const { a, fake, ignored, since } = await rig()
    fake.put('vault/mine.md', '1')
    fake.put('vault/shared/theirs.md', '2')
    fake.setOwner('vault/shared', 'bob')
    fake.put('vault/gf/team.md', '3')
    fake.setMountType('vault/gf', 'group')
    fake.put('vault/home/ok.md', '4')
    fake.setMountType('vault/home', 'home')
    fake.put('vault/.obsidian/app.json', '{}')
    fake.put('vault/.ohhi/layouts/x.json', '{}')
    fake.put('vault/ohhi-host.md', 'marker')
    fake.put('vault/notes/ohhi-host.md', 'an ordinary note')
    fake.put('vault/stray.md', 'foreign file')
    fake.setOwner('vault/stray.md', 'mallory')
    // No owner said at all (a nested mount whose propstat 404s): foreign, fail closed (nextcloud-build R1 #14).
    fake.put('vault/nested/x.md', 'unknown owner')
    fake.setOwner('vault/nested', '')
    since()

    expect((await a.list()).map((f) => f.path).sort()).toEqual(['home/ok.md', 'mine.md', 'notes/ohhi-host.md'])
    expect(await a.listDirs()).toEqual(['home', 'notes'])
    const listed = since().filter((r) => r.startsWith('PROPFIND'))
    for (const hidden of ['shared', 'gf', '.obsidian', '.ohhi']) {
      expect(listed).not.toContain(`PROPFIND vault/${hidden}`)
    }
    expect(ignored.sort()).toEqual([
      ['gf', 'mount'],
      ['nested', 'owner'],
      ['shared', 'owner'],
      ['stray.md', 'owner'],
    ])
    // A hidden path still READS directly (that is how .ohhi/ resources load).
    expect(dec(await a.read('.ohhi/layouts/x.json'))).toBe('{}')
    expect(await a.listAppDir('.ohhi/layouts')).toEqual(['.ohhi/layouts/x.json'])
  })

  it('a hidden subtree changing never reaches a watcher', async () => {
    const { a, fake, clock } = await rig()
    fake.put('vault/shared/theirs.md', '1')
    fake.setOwner('vault/shared', 'bob')
    fake.put('vault/.git/HEAD', 'ref')
    fake.put('vault/ohhi-host.md', 'heartbeat: 1')
    await a.list()
    const events: WatchEvent[] = []
    a.watch((ev) => events.push(ev))
    fake.put('vault/shared/theirs.md', '2')
    fake.put('vault/.git/HEAD', 'ref2')
    fake.put('vault/ohhi-host.md', 'heartbeat: 2')
    clock.advance(0)
    await a.idle()
    expect(events).toEqual([])
  })
})

describe('watch: the ETag walk on the injected clock (decision 10)', () => {
  async function tree(o: Partial<WebDavAdapterOptions> = {}) {
    const r = await rig(o)
    r.fake.put('vault/a.md', 'a')
    r.fake.put('vault/x/1.md', '1')
    r.fake.put('vault/y/2.md', '2')
    r.fake.put('vault/z/3.md', '3')
    const events: WatchEvent[] = []
    const stop = r.a.watch((ev) => events.push(ev))
    r.since()
    const tick = async (ms: number) => {
      r.clock.advance(ms)
      await r.a.idle()
    }
    return { ...r, events, stop, tick }
  }

  it('first walk is on the first tick (not synchronous) and only primes', async () => {
    const t = await tree()
    expect(t.since()).toEqual([])
    await t.tick(0)
    expect(t.since()).toEqual(['PROPFIND vault', 'PROPFIND vault/x', 'PROPFIND vault/y', 'PROPFIND vault/z'])
    expect(t.events).toEqual([])
    t.stop()
  })

  it('an idle vault costs one PROPFIND; a change descends ONLY into the changed folder', async () => {
    const t = await tree()
    await t.tick(0)
    t.since()
    await t.tick(30_000)
    expect(t.since()).toEqual(['PROPFIND vault'])
    expect(t.events).toEqual([])

    t.fake.put('vault/y/2.md', 'two')
    await t.tick(30_000)
    expect(t.since()).toEqual(['PROPFIND vault', 'PROPFIND vault/y'])
    expect(t.events).toEqual([{ paths: ['y/2.md'] }])

    t.fake.put('vault/x/new/deep.md', 'n')
    t.fake.put('vault/a.md', 'A')
    await t.tick(30_000)
    expect(t.since()).toEqual(['PROPFIND vault', 'PROPFIND vault/x', 'PROPFIND vault/x/new'])
    expect(t.events[1]).toEqual({ paths: ['a.md', 'x/new', 'x/new/deep.md'] })
    t.stop()
  })

  it('a 3-deep tree: after the priming walk, an unchanged tree costs ONE PROPFIND per walk, list() and listDirs() included (bench 2026-10-11)', async () => {
    const walks: { requests: number; full: boolean }[] = []
    const r = await rig({ onWalk: (st) => walks.push(st) })
    for (const top of ['Areas', 'Projects', 'Data Vis']) {
      r.fake.put(`vault/${top}/top.md`, top)
      for (const mid of ['CS', 'Team']) {
        r.fake.put(`vault/${top}/${mid}/mid.md`, mid)
        r.fake.put(`vault/${top}/${mid}/drafts/leaf.md`, 'leaf')
      }
    }
    r.fake.put('vault/root.md', 'root')
    const events: WatchEvent[] = []
    const stop = r.a.watch((ev) => events.push(ev))
    const tick = async (ms: number) => {
      r.clock.advance(ms)
      await r.a.idle()
    }
    r.since()
    await tick(0) // priming: every folder, once
    expect(r.since().length).toBe(1 + 3 + 6 + 6)
    expect(walks).toEqual([{ requests: 16, full: true }])

    await tick(30_000)
    expect(r.since()).toEqual(['PROPFIND vault'])
    // The custodian's marker heartbeat moves the ROOT's etag every 30 s: still one.
    r.fake.put(`vault/${OHHI_HOST_MARKER}`, 'heartbeat')
    await tick(30_000)
    expect(r.since()).toEqual(['PROPFIND vault'])
    // bootScan's list() + syncDirs' listDirs(): from the baseline, one each.
    expect((await r.a.list()).length).toBe(1 + 3 + 6 + 6)
    expect((await r.a.listDirs()).length).toBe(3 + 6 + 6)
    expect(r.since()).toEqual(['PROPFIND vault', 'PROPFIND vault'])
    expect(walks.slice(1)).toEqual([1, 1, 1, 1].map((requests) => ({ requests, full: false })))
    expect(events).toEqual([])

    // A change three folders down descends that one path only.
    r.fake.put('vault/Data Vis/Team/drafts/leaf.md', 'changed')
    await tick(30_000)
    expect(r.since()).toEqual(['PROPFIND vault', 'PROPFIND vault/Data Vis', 'PROPFIND vault/Data Vis/Team', 'PROPFIND vault/Data Vis/Team/drafts'])
    expect(events).toEqual([{ paths: ['Data Vis/Team/drafts/leaf.md'] }])
    stop()
  })

  it('a MOVE is a move (oc:fileid continuity), not a delete + create', async () => {
    const t = await tree()
    await t.tick(0)
    await t.a.rename('x/1.md', 'z/one.md')
    await t.tick(30_000)
    expect(t.events).toEqual([{ paths: ['x/1.md', 'z/one.md'], moves: [{ from: 'x/1.md', to: 'z/one.md' }] }])

    await t.a.renameDir('y', 'w')
    await t.tick(30_000)
    expect(t.events[1]).toEqual({
      paths: ['w', 'w/2.md', 'y', 'y/2.md'],
      moves: [
        { from: 'y', to: 'w' },
        { from: 'y/2.md', to: 'w/2.md' },
      ],
    })
    t.stop()
  })

  it('same-bytes etag bumps are reported as paths; a delete one (active-interval) walk later', async () => {
    const t = await tree()
    await t.tick(0)
    await t.a.remove('z/3.md')
    t.fake.bump('vault/a.md')
    await t.tick(30_000)
    expect(t.events).toEqual([{ paths: ['a.md'] }])
    // Held one walk (it might have been a move the walk tore), on the 2 s interval.
    await t.tick(2_000)
    expect(t.events).toEqual([{ paths: ['a.md'] }, { paths: ['z/3.md'] }])
    t.stop()
  })

  it('a folder renamed mid-walk (sub-folder 404) aborts the walk; the next one pairs every file as a move (nextcloud-build R1 #5)', async () => {
    const t = await tree()
    await t.tick(0)
    // `x` is renamed to `v` after the root listing named it, before `x` is listed.
    t.fake.put('vault/x/1.md', 'changed') // so the root sees x's etag move
    t.fake.failNext('PROPFIND', 404, { path: 'vault/x' })
    await t.tick(30_000)
    expect(t.events).toEqual([])
    expect(t.walkErrors[0]).toBeInstanceOf(WalkRaceError)
    await t.a.renameDir('x', 'v')
    await t.tick(30_000)
    expect(t.events).toEqual([
      {
        paths: ['v', 'v/1.md', 'x', 'x/1.md'],
        moves: [
          { from: 'x', to: 'v' },
          { from: 'x/1.md', to: 'v/1.md' },
        ],
      },
    ])
    t.stop()
  })

  it('a file moved between two folders\' listings pairs as a move, whichever folder was listed first', async () => {
    const t = await tree()
    await t.tick(0)
    const raceBefore = (listing: string, from: string, to: string) => {
      let done = false
      t.fake.beforeRequest = (method, path) => {
        if (done || method !== 'PROPFIND' || path !== listing) return
        done = true
        t.fake.move(from, to)
      }
    }
    // Twice: x is listed BEFORE the move, y AFTER it — one file id at two
    // paths. The walk is torn: nothing is reported, the next walk re-lists.
    t.fake.put('vault/x/side.md', 's')
    t.fake.put('vault/y/other.md', 'o')
    raceBefore('vault/y', 'vault/x/1.md', 'vault/y/1.md')
    await t.tick(30_000)
    expect(t.walkErrors.at(-1)).toBeInstanceOf(WalkRaceError)
    expect(t.events).toEqual([])
    await t.tick(30_000)
    expect(t.events).toEqual([
      { paths: ['x/1.md', 'x/side.md', 'y/1.md', 'y/other.md'], moves: [{ from: 'x/1.md', to: 'y/1.md' }] },
    ])

    // Nowhere: x (the destination) is listed BEFORE the move, y (the source)
    // AFTER it. The vanish is held one walk; the next walk pairs it.
    t.fake.put('vault/x/side.md', 's2')
    t.fake.put('vault/y/other.md', 'o2')
    raceBefore('vault/y', 'vault/y/2.md', 'vault/x/2.md')
    await t.tick(30_000)
    expect(t.events[1]).toEqual({ paths: ['x/side.md', 'y/other.md'] })
    await t.tick(2_000) // the held vanish brings the next walk in on the active interval
    expect(t.events[2]).toEqual({ paths: ['x/2.md', 'y/2.md'], moves: [{ from: 'y/2.md', to: 'x/2.md' }] })
    expect(t.events).toHaveLength(3)
    t.fake.beforeRequest = null
    t.stop()
  })

  it('interval: idle 30 s, active 2 s while isActive()', async () => {
    let active = false
    const t = await tree({ isActive: () => active })
    await t.tick(0)
    t.since()
    await t.tick(29_999)
    expect(t.since()).toEqual([])
    await t.tick(1)
    expect(t.since()).toEqual(['PROPFIND vault'])
    active = true
    await t.tick(30_000) // the walk after this one is scheduled on the active interval
    t.since()
    await t.tick(1_999)
    expect(t.since()).toEqual([])
    await t.tick(1)
    expect(t.since()).toEqual(['PROPFIND vault'])
    t.stop()
  })

  it('hint() walks ~immediately and keeps the active interval for a while', async () => {
    const t = await tree()
    await t.tick(0)
    t.fake.put('vault/a.md', 'hinted')
    await t.tick(5_000)
    expect(t.events).toEqual([])
    t.a.hint()
    await t.tick(0)
    expect(t.events).toEqual([{ paths: ['a.md'] }])
    t.since()
    await t.tick(2_000)
    expect(t.since()).toEqual(['PROPFIND vault'])
    t.stop()
  })

  it('the disposer stops the loop: no timer, no request', async () => {
    const t = await tree()
    await t.tick(0)
    t.stop()
    expect(t.clock.pendingCount()).toBe(0)
    t.since()
    t.a.hint()
    await t.tick(120_000)
    expect(t.since()).toEqual([])
  })

  it('list() primes the table, so the first tick reports what changed since', async () => {
    const r = await rig()
    r.fake.put('vault/a.md', '1')
    await r.a.list()
    const events: WatchEvent[] = []
    r.a.watch((ev) => events.push(ev))
    r.fake.put('vault/b.md', '2')
    r.clock.advance(0)
    await r.a.idle()
    expect(events).toEqual([{ paths: ['b.md'] }])
  })

  it('a failed walk emits nothing and keeps its baseline (an outage is never a mass delete)', async () => {
    const t = await tree()
    await t.tick(0)
    t.fake.failNext('PROPFIND', 503, { path: 'vault/y' })
    t.fake.put('vault/y/2.md', 'changed')
    await t.tick(30_000)
    expect(t.events).toEqual([])
    expect(t.walkErrors).toHaveLength(1)
    t.fake.failNext('PROPFIND', 404, { path: 'vault' }) // the root vanished: unavailable
    await t.tick(30_000)
    expect(t.events).toEqual([])
    expect(t.walkErrors[1]).toBeInstanceOf(VaultUnavailableError)
    await t.tick(30_000)
    expect(t.events).toEqual([{ paths: ['y/2.md'] }])
    t.stop()
  })
})

describe('directory ops over WebDAV', () => {
  it('mkdir creates parents and is idempotent', async () => {
    const { a } = await rig()
    await a.mkdir('p/q/r')
    await a.mkdir('p/q/r')
    await a.mkdir('p')
    expect(await a.listDirs()).toEqual(['p', 'p/q', 'p/q/r'])
  })

  it('removeDir: refuses non-empty (hidden children count), missing is a no-op', async () => {
    const { a, fake } = await rig()
    await a.writeAtomic('d/f.md', enc('x'))
    await expect(a.removeDir('d')).rejects.toThrow(/not empty/)
    fake.put('vault/g/.git/HEAD', 'ref')
    await expect(a.removeDir('g')).rejects.toThrow(/not empty/)
    await a.removeDir('nope')
    await a.mkdir('e')
    await a.removeDir('e')
    expect(fake.files.has('vault/e')).toBe(false)
  })

  it('rename / renameDir never overwrite (Overwrite: F → WriteConflictError)', async () => {
    const { a, fake } = await rig()
    fake.put('vault/a.md', 'a')
    fake.put('vault/b.md', 'b')
    const err = await rejection(a.rename('a.md', 'b.md'))
    expect(err).toBeInstanceOf(WriteConflictError)
    expect(err).toMatchObject({ path: 'b.md', actual: hashBytes(enc('b')) })
    expect(dec(fake.files.get('vault/a.md')!.bytes)).toBe('a')
    fake.mkdir('vault/d1')
    fake.mkdir('vault/d2')
    await expect(a.renameDir('d1', 'd2')).rejects.toBeInstanceOf(WriteConflictError)
  })

  it('rename keeps the fileid and creates the destination parent', async () => {
    const { a, fake } = await rig()
    fake.put('vault/a.md', 'a')
    const id = fake.files.get('vault/a.md')!.fileid
    await a.rename('a.md', 'new/dir/a.md')
    expect(fake.files.get('vault/new/dir/a.md')!.fileid).toBe(id)
  })

  it('remove: If-Match the walk’s etag hint, so a file changed since is not deleted', async () => {
    const { a, fake } = await rig()
    fake.put('vault/a.md', 'seen')
    await a.list()
    fake.put('vault/a.md', 'changed by someone else')
    await expect(a.remove('a.md')).rejects.toBeInstanceOf(WriteConflictError)
    expect(dec(fake.files.get('vault/a.md')!.bytes)).toBe('changed by someone else')
    // Our OWN write refreshes the hint: write-then-delete is not a conflict.
    await a.writeAtomic('a.md', enc('mine'))
    await a.remove('a.md')
    expect(fake.files.has('vault/a.md')).toBe(false)
    await a.remove('a.md') // missing is fine
  })

  it('read of a directory is null', async () => {
    const { a, fake } = await rig()
    fake.mkdir('vault/dir')
    expect(await a.read('dir')).toBeNull()
  })
})
