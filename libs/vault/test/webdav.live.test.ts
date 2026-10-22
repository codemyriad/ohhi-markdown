/**
 * WebDavVaultAdapter against a REAL Nextcloud (decisions 9, 10, 12). Skipped
 * unless OHHI_NC_URL, OHHI_NC_USER and OHHI_NC_APP_PASSWORD are set. Creates
 * `remote.php/dav/files/<user>/ohhi-adapter-test-<random>/` and deletes it.
 *
 *   OHHI_NC_URL=http://localhost:28080 OHHI_NC_USER=admin OHHI_NC_APP_PASSWORD=… \
 *     npx vitest run test/webdav.live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RealClock, SimClock } from '@ohhi/testkit'
import { hashBytes } from '../src/hash.js'
import { VaultUnavailableError, WriteConflictError, type WatchEvent } from '../src/types.js'
import { WebDavVaultAdapter, type WebDavAdapterOptions } from '../src/webdav/index.js'

const URL_ = process.env.OHHI_NC_URL
const USER = process.env.OHHI_NC_USER
const PASS = process.env.OHHI_NC_APP_PASSWORD
const live = Boolean(URL_ && USER && PASS)

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b))
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe.skipIf(!live)('WebDavVaultAdapter against a live Nextcloud', { timeout: 120_000 }, () => {
  const auth = { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}` }
  const userRoot = `${(URL_ ?? '').replace(/\/+$/, '')}/remote.php/dav/files/${encodeURIComponent(USER ?? '')}/`
  const folder = `ohhi-adapter-test-${Math.random().toString(36).slice(2, 10)}`
  const base = `${userRoot}${folder}/`
  const log: { method: string; url: string }[] = []
  let beforeFetch: ((method: string, url: string) => Promise<void>) | null = null

  const make = (o: Partial<WebDavAdapterOptions> = {}) =>
    new WebDavVaultAdapter({
      baseUrl: base,
      headers: () => auth,
      // Real time: a CAS write waits out a same-second modification (NC 35 quirk).
      clock: new RealClock(),
      owner: USER!,
      fetch: async (input, init) => {
        const method = init?.method ?? 'GET'
        log.push({ method, url: String(input) })
        if (beforeFetch) await beforeFetch(method, String(input))
        return fetch(input, init)
      },
      ...o,
    })

  /** A raw PUT from "someone else" (another client). */
  const external = async (path: string, body: string) => {
    const res = await fetch(base + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT',
      headers: auth,
      body,
    })
    expect(res.ok).toBe(true)
  }

  beforeAll(async () => {
    const root = new WebDavVaultAdapter({ baseUrl: userRoot, headers: () => auth, clock: new SimClock(), owner: USER! })
    await root.mkdir(folder)
  })

  afterAll(async () => {
    await fetch(base, { method: 'DELETE', headers: auth })
  })

  it('CAS matrix: new / exists / stale / good / plain', async () => {
    const a = make()
    await a.writeAtomic('cas.md', enc('v1\n'), { expectHash: '' })
    expect(dec(await a.read('cas.md'))).toBe('v1\n')
    await expect(a.writeAtomic('cas.md', enc('x'), { expectHash: '' })).rejects.toMatchObject({
      expected: '',
      actual: hashBytes(enc('v1\n')),
    })
    await expect(
      a.writeAtomic('cas.md', enc('x'), { expectHash: hashBytes(enc('stale')) })
    ).rejects.toBeInstanceOf(WriteConflictError)
    await a.writeAtomic('cas.md', enc('v2\n'), { expectHash: hashBytes(enc('v1\n')) })
    expect(dec(await a.read('cas.md'))).toBe('v2\n')
    await a.writeAtomic('cas.md', enc('v3\n'))
    expect(dec(await a.read('cas.md'))).toBe('v3\n')
  })

  it('CAS: an etag that moved over the same bytes is retried once; moved bytes conflict', async () => {
    const a = make()
    await a.writeAtomic('race.md', enc('base\n'))
    let n = 0
    beforeFetch = async (method) => {
      if (method === 'PUT' && n++ === 0) await external('race.md', 'base\n') // same bytes, new etag
    }
    await new Promise((r) => setTimeout(r, 1_100)) // past race.md's mtime second
    const mark = log.length
    await a.writeAtomic('race.md', enc('mine\n'), { expectHash: hashBytes(enc('base\n')) })
    // The external same-bytes PUT lands in a new second (etag moves → 412 →
    // re-GET, perhaps a same-second wait and another GET → one retry) or not
    // (etag kept → the first PUT wins). Bytes are identical either way.
    const seq = log.slice(mark).map((r) => r.method).join(',')
    expect(seq).toMatch(/^GET,PUT(,GET)*(,PUT)?$/)
    expect(seq.split('PUT').length - 1).toBeLessThanOrEqual(2)
    expect(dec(await a.read('race.md'))).toBe('mine\n')

    n = 0
    beforeFetch = async (method) => {
      if (method === 'PUT' && n++ === 0) await external('race.md', 'agent\n')
    }
    // Inside the same second as our own write: the adapter waits it out, and
    // the agent's bytes are never overwritten whichever second they land in.
    await expect(
      a.writeAtomic('race.md', enc('lost?\n'), { expectHash: hashBytes(enc('mine\n')) })
    ).rejects.toMatchObject({ actual: hashBytes(enc('agent\n')) })
    beforeFetch = null
    expect(dec(await a.read('race.md'))).toBe('agent\n')
  })

  it('same second: a hidden rewrite is caught by the CAS wait, and by the walk', async () => {
    const a = make()
    await a.writeAtomic('sec.md', enc('v1\n'))
    // Another client rewrites it at once — likely inside the same second, with the SAME etag.
    await external('sec.md', 'agent same second\n')
    await expect(
      a.writeAtomic('sec.md', enc('mine\n'), { expectHash: hashBytes(enc('v1\n')) })
    ).rejects.toMatchObject({ actual: hashBytes(enc('agent same second\n')) })
    expect(dec(await a.read('sec.md'))).toBe('agent same second\n')

    const clock = new SimClock()
    const w = make({ clock })
    const events: WatchEvent[] = []
    await w.list() // primes the table
    const stop = w.watch((ev) => events.push(ev))
    await external('sec.md', 'rewritten right after the listing\n')
    clock.advance(0)
    await w.idle()
    stop()
    expect(events.flatMap((e) => e.paths)).toContain('sec.md')
  })

  it('typed reads: missing file null, directory null, missing root unavailable', async () => {
    const a = make()
    expect(await a.read('nope.md')).toBeNull()
    await a.mkdir('somedir')
    expect(await a.read('somedir')).toBeNull()
    const gone = new WebDavVaultAdapter({
      baseUrl: `${userRoot}${folder}-does-not-exist/`,
      headers: () => auth,
      clock: new SimClock(),
      owner: USER!,
    })
    await expect(gone.read('a.md')).rejects.toBeInstanceOf(VaultUnavailableError)
  })

  it('dir ops: mkdir parents, removeDir refuses non-empty, MOVE never overwrites', async () => {
    const a = make()
    await a.mkdir('p/q/r')
    expect(await a.listDirs()).toEqual(expect.arrayContaining(['p', 'p/q', 'p/q/r']))
    await a.writeAtomic('p/q/f.md', enc('f'))
    await expect(a.removeDir('p/q')).rejects.toThrow(/not empty/)
    await a.removeDir('p/q/r')
    await a.removeDir('p/q/r') // missing: no-op
    await a.writeAtomic('m1.md', enc('1'))
    await a.writeAtomic('m2.md', enc('2'))
    await expect(a.rename('m1.md', 'm2.md')).rejects.toBeInstanceOf(WriteConflictError)
    await a.rename('m1.md', 'p/moved.md')
    expect(dec(await a.read('p/moved.md'))).toBe('1')
    // DELETE If-Match the walk's etag hint: a file changed since is not deleted.
    // (The hint is only as good as Nextcloud's etag: a rewrite inside the
    // second the file was last modified keeps it, so step past that second.)
    await a.writeAtomic('del.md', enc('seen'))
    await new Promise((r) => setTimeout(r, 1_100))
    await a.list()
    await external('del.md', 'changed elsewhere')
    await expect(a.remove('del.md')).rejects.toBeInstanceOf(WriteConflictError)
    expect(dec(await a.read('del.md'))).toBe('changed elsewhere')
    await a.writeAtomic('del.md', enc('mine'))
    await a.remove('del.md')
    expect(await a.read('del.md')).toBeNull()
    await a.writeAtomic('Ünï & 50% #x?.md', enc('odd'))
    expect((await a.list()).map((f) => f.path)).toContain('Ünï & 50% #x?.md')
  })

  it('walk: idle costs one PROPFIND, a change descends one folder, MOVE is a move', async () => {
    const clock = new SimClock()
    const a = make({ clock, baseUrl: `${base}walk/` })
    const root = make()
    await root.mkdir('walk')
    for (const d of ['a', 'b', 'c']) await a.writeAtomic(`${d}/note.md`, enc(d))
    await a.writeAtomic('top.md', enc('top'))
    await a.writeAtomic('ohhi-host.md', enc('marker'))
    // Let the seed settle: a file modified in the second of a listing is
    // re-reported once by the next walk (the same-second rule), by design.
    await new Promise((r) => setTimeout(r, 1_100))
    const events: WatchEvent[] = []
    const stop = a.watch((ev) => events.push(ev))
    const walk = async (ms: number) => {
      const mark = log.length
      const t0 = performance.now()
      clock.advance(ms)
      await a.idle()
      return { requests: log.slice(mark).length, ms: performance.now() - t0 }
    }
    const prime = await walk(0)
    const idle = await walk(30_000)
    await external('walk/b/note.md', 'b changed')
    const changed = await walk(30_000)
    expect(events).toEqual([{ paths: ['b/note.md'] }])
    await a.rename('a/note.md', 'c/moved.md')
    await walk(30_000)
    expect(events[1]).toEqual({
      paths: ['a/note.md', 'c/moved.md'],
      moves: [{ from: 'a/note.md', to: 'c/moved.md' }],
    })
    stop()

    // PUT / GET round trips — on a real-clock adapter (a CAS write may wait a second).
    const b = make({ baseUrl: `${base}walk/` })
    let t0 = 0
    const put: number[] = []
    const get: number[] = []
    for (let i = 0; i < 10; i++) {
      t0 = performance.now()
      await b.writeAtomic('top.md', enc(`top ${i}`))
      put.push(performance.now() - t0)
      t0 = performance.now()
      await b.read('top.md')
      get.push(performance.now() - t0)
    }
    const cas: number[] = []
    let prev = 'top 9'
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1_100)) // a settled file: no same-second wait
      const t0 = performance.now()
      await b.writeAtomic('top.md', enc(`cas ${i}`), { expectHash: hashBytes(enc(prev)) })
      cas.push(performance.now() - t0)
      prev = `cas ${i}`
    }
    // Back-to-back on the file we just wrote: the same-second wait kicks in.
    t0 = performance.now()
    await b.writeAtomic('top.md', enc('fresh'), { expectHash: hashBytes(enc(prev)) })
    const fresh = performance.now() - t0
    console.log(
      `[webdav.live] 3-folder tree walk requests: prime=${prime.requests} (${prime.ms.toFixed(0)} ms), ` +
        `idle=${idle.requests} (${idle.ms.toFixed(0)} ms), one-folder change=${changed.requests} (${changed.ms.toFixed(0)} ms); ` +
        `median PUT ${median(put).toFixed(1)} ms, GET ${median(get).toFixed(1)} ms, CAS write on a settled file (GET+PUT) ${median(cas).toFixed(1)} ms, CAS right after our own write ${fresh.toFixed(0)} ms`
    )
    expect(prime.requests).toBe(4)
    expect(idle.requests).toBe(1)
    expect(changed.requests).toBe(2)
  })
})
