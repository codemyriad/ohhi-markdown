/**
 * The custodian's three small machines, each on a SimClock: the marker lease
 * (decision 13), held decisions (decision 7) and honest Files status (decision 8).
 */
import { SimClock } from '@ohhi/testkit'
import {
  formatHostMarker,
  hashBytes,
  MemVaultAdapter,
  OHHI_HOST_MARKER,
  parseHostMarker,
  WebDavError,
  WriteConflictError,
  WriteRefusedError,
  type DivergenceReview,
} from '@ohhi/vault'
import { FOLDER_RECORD_KEY, type CustodianState } from '@ohhi/workspace'
import { describe, expect, it, vi } from 'vitest'
import { FilesStatus } from '../src/files-status.js'
import { HoldBook, type HoldTarget } from '../src/holds.js'
import { MarkerLease } from '../src/marker.js'

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

function lease(adapter: MemVaultAdapter, clock: SimClock, over: Partial<ConstructorParameters<typeof MarkerLease>[0]> = {}) {
  const lost: string[] = []
  const l = new MarkerLease({
    adapter,
    clock,
    instance: 'inst-A',
    room: 'room-1',
    vault: 'vault-1',
    epoch: 1,
    onLost: (h) => lost.push(h),
    ...over,
  })
  return { l, lost }
}

describe('marker lease', () => {
  it('writes the marker on create and re-writes it every 30 s', async () => {
    const clock = new SimClock()
    clock.advance(1_700_000_000_000)
    const adapter = new MemVaultAdapter()
    const { l } = lease(adapter, clock)
    expect(await l.acquire('create')).toEqual({ ok: true })
    const first = parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)
    expect(first).toMatchObject({ room: 'room-1', vault: 'vault-1', epoch: 1, instance: 'inst-A' })
    expect(await adapter.list()).toEqual([]) // reserved: never a vault file
    clock.advance(30_000)
    await vi.waitFor(async () => {
      expect(parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)!.heartbeat).not.toBe(first!.heartbeat)
    })
    l.stop()
  })

  it('create refuses a folder already marked; reopen checks room and epoch', async () => {
    const clock = new SimClock()
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic(
      OHHI_HOST_MARKER,
      formatHostMarker({ room: 'room-1', vault: 'vault-1', epoch: 2, instance: 'inst-A', heartbeat: new Date(0).toISOString() })
    )
    expect(await lease(adapter, clock).l.acquire('create')).toEqual({ ok: false, reason: 'other-room' })
    expect(await lease(adapter, clock).l.acquire('reopen')).toEqual({ ok: false, reason: 'epoch-mismatch' })
    expect(await lease(adapter, clock, { room: 'room-2' }).l.acquire('reopen')).toEqual({ ok: false, reason: 'other-room' })
    expect(await lease(adapter, clock, { epoch: 2 }).l.acquire('reopen')).toEqual({ ok: true })
  })

  it('a live holder keeps the lease; a stale one is taken over', async () => {
    const clock = new SimClock()
    clock.advance(1_700_000_000_000)
    const adapter = new MemVaultAdapter()
    const other = lease(adapter, clock, { instance: 'inst-B' })
    await other.l.acquire('create')
    other.l.stop()
    expect(await lease(adapter, clock).l.acquire('reopen')).toEqual({ ok: false, reason: 'held-elsewhere' })
    clock.advance(90_000)
    expect(await lease(adapter, clock).l.acquire('reopen')).toEqual({ ok: true })
  })

  it('a heartbeat that loses to another instance stops the lease and reports once', async () => {
    const clock = new SimClock()
    const adapter = new MemVaultAdapter()
    const { l, lost } = lease(adapter, clock)
    await l.acquire('create')
    // A second container took the folder (its own CAS won).
    await adapter.writeAtomic(
      OHHI_HOST_MARKER,
      formatHostMarker({ room: 'room-1', vault: 'vault-1', epoch: 1, instance: 'inst-B', heartbeat: new Date(0).toISOString() })
    )
    await l.beat()
    await l.beat()
    expect(lost).toEqual(['inst-B'])
    expect(parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)!.instance).toBe('inst-B') // never clobbered
    expect(clock.pendingCount()).toBe(0)
  })

  it('a deleted marker is put back with If-None-Match', async () => {
    const clock = new SimClock()
    const adapter = new MemVaultAdapter()
    const { l, lost } = lease(adapter, clock)
    await l.acquire('create')
    await adapter.remove(OHHI_HOST_MARKER)
    await l.beat()
    expect(lost).toEqual([])
    expect(parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)!.instance).toBe('inst-A')
    l.stop()
  })
})

function target(): HoldTarget & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    confirmBreaker: async () => void calls.push('confirm'),
    dismissBreaker: () => void calls.push('dismiss'),
    resolveReview: async (guid, t) => void calls.push(`review ${guid} ${t}`),
    resolveVanished: async (guid, a) => void calls.push(`vanished ${guid} ${a}`),
  }
}

const review = (over: Partial<DivergenceReview> = {}): DivergenceReview => ({
  guid: 'g1',
  path: 'a.md',
  base: 'base',
  mine: 'doc side',
  theirs: 'disk side',
  reason: 'three-way',
  ...over,
})

describe('holds', () => {
  it('holds a breaker until a user confirms or discards it', async () => {
    const book = new HoldBook(() => 5)
    const hold = book.addBreaker(['a.md', 'b.md'])
    expect(book.list()).toEqual([{ id: hold.id, kind: 'breaker', paths: ['a.md', 'b.md'], since: 5 }])
    const t = target()
    await expect(book.apply(hold.id, 'disk', t)).rejects.toMatchObject({ status: 400 })
    await expect(book.apply(hold.id, 'confirm', null)).rejects.toMatchObject({ status: 409 })
    await book.apply(hold.id, 'confirm', t)
    expect(t.calls).toEqual(['confirm'])
    expect(book.list()).toEqual([])
    const again = book.addBreaker(['c.md'])
    await book.apply(again.id, 'discard', t)
    expect(t.calls).toEqual(['confirm', 'dismiss'])
    await expect(book.apply(again.id, 'confirm', t)).rejects.toMatchObject({ status: 404 })
  })

  it('a second breaker trip joins the held one: same hold, the union of paths (nextcloud-build R1 #9)', async () => {
    let now = 5
    const book = new HoldBook(() => now)
    const first = book.addBreaker(['a.md', 'b.md'])
    now = 9
    const second = book.addBreaker(['b.md', 'c.md'])
    expect(second.id).toBe(first.id)
    expect(book.list()).toEqual([{ id: first.id, kind: 'breaker', paths: ['a.md', 'b.md', 'c.md'], since: 5 }])
    const t = target()
    await book.apply(first.id, 'confirm', t)
    expect(t.calls).toEqual(['confirm'])
    expect(book.list()).toEqual([])
  })

  it('resolves a review with the side the user picked; a vanished file restores or goes', async () => {
    const book = new HoldBook(() => 0)
    const t = target()
    const r = book.addReview(review())
    await book.apply(r.id, 'disk', t)
    const v = book.addReview(review({ guid: 'g2', reason: 'vanished' }))
    await book.apply(v.id, 'doc', t)
    const w = book.addReview(review({ guid: 'g3' }))
    await book.apply(w.id, 'doc', t)
    expect(t.calls).toEqual(['review g1 disk side', 'vanished g2 restore', 'review g3 doc side'])
    expect(book.list()).toEqual([])
  })
})

describe('files status', () => {
  function setup() {
    const clock = new SimClock()
    const published: CustodianState[] = []
    let retries = 0
    const fs = new FilesStatus({
      clock,
      instance: 'inst-A',
      publish: (s) => published.push(s),
      retry: async () => void retries++,
      guidForPath: (p) => (p === 'a.md' ? 'g-a' : p === 'b.md' ? 'g-b' : null),
    })
    return { clock, fs, published, retries: () => retries }
  }

  it('publishes match/behind from the records, throttled to once per 500 ms', () => {
    const { clock, fs, published } = setup()
    fs.recordFor(FOLDER_RECORD_KEY)
    const a = fs.recordFor('g-a')
    const b = fs.recordFor('g-b')
    expect(published).toEqual([])
    clock.advance(0)
    expect(published).toHaveLength(1)
    a.diskMatchesCrdt = false
    b.diskMatchesCrdt = false
    clock.advance(499)
    expect(published).toHaveLength(1)
    clock.advance(1)
    expect(published.at(-1)).toEqual({ type: 'custodian', instance: 'inst-A', disk: { 'g-a': 'behind', 'g-b': 'behind' }, blocked: {}, holds: 0 })
  })

  it('carries the hold count, and a hold coming or going is published at once (throttled like the rest)', async () => {
    const clock = new SimClock()
    const published: CustodianState[] = []
    // Wired as custodian.ts wires it: the book's onChange publishes, the snapshot reads its size.
    let fs: FilesStatus | null = null
    const book = new HoldBook(
      () => clock.now(),
      () => fs?.changed()
    )
    fs = new FilesStatus({
      clock,
      instance: 'inst-A',
      publish: (s) => published.push(s),
      retry: async () => {},
      guidForPath: () => null,
      holds: () => book.list().length,
    })
    fs.publishNow()
    expect(published.at(-1)?.holds).toBe(0)
    book.addBreaker(['a.md', 'b.md'])
    clock.advance(499)
    expect(published).toHaveLength(1)
    clock.advance(1)
    expect(published.at(-1)?.holds).toBe(1)
    book.addBreaker(['c.md']) // joins the held batch: still one hold
    clock.advance(500)
    expect(published.at(-1)?.holds).toBe(1)
    await book.apply(book.list()[0]!.id, 'discard', { confirmBreaker: async () => {}, dismissBreaker: () => {}, resolveReview: async () => {}, resolveVanished: async () => {} })
    clock.advance(500)
    expect(published.at(-1)?.holds).toBe(0)
    fs.stop()
  })

  it('a refused write is blocked with its status, retried with backoff, and clears on match', async () => {
    const { clock, fs, published, retries } = setup()
    const a = fs.recordFor('g-a')
    fs.recordFor('g-b')
    expect(fs.noteError(new WriteRefusedError(423, 'PUT', 'a.md'))).toBe(true)
    expect(fs.noteError(new Error('other'))).toBe(false)
    clock.advance(500)
    expect(published.at(-1)).toMatchObject({ disk: { 'g-a': 'blocked', 'g-b': 'match' }, blocked: { 'g-a': 423 } })
    clock.advance(5_000)
    await vi.waitFor(() => expect(retries()).toBe(1))
    await new Promise((r) => setImmediate(r)) // the retry's settle re-arms the backoff
    clock.advance(15_000)
    await vi.waitFor(() => expect(retries()).toBe(2))
    a.diskMatchesCrdt = true // the retry's write landed
    clock.advance(500)
    expect(published.at(-1)).toMatchObject({ disk: { 'g-a': 'match' }, blocked: {} })
    clock.advance(600_000)
    expect(retries()).toBe(2) // nothing blocked, nothing retried
    fs.stop()
  })

  it('ANY failed write is retried on the clock: a 5xx or an unsettled CAS is behind, a refusal blocked (nextcloud-build R1 #8)', async () => {
    const { clock, fs, published, retries } = setup()
    const a = fs.recordFor('g-a')
    const b = fs.recordFor('g-b')
    expect(fs.noteError(new WebDavError(503, 'PUT', 'a.md'))).toBe(true)
    expect(fs.noteError(new WebDavError(0, 'PUT', 'b.md'))).toBe(true) // Nextcloud unreachable
    clock.advance(500)
    expect(published.at(-1)).toMatchObject({ disk: { 'g-a': 'behind', 'g-b': 'behind' }, blocked: {} })
    clock.advance(5_000)
    await vi.waitFor(() => expect(retries()).toBe(1))
    // A later refusal of the same doc shows its status; a transient error never hides it.
    expect(fs.noteError(new WriteRefusedError(423, 'PUT', 'a.md'))).toBe(true)
    expect(fs.noteError(new WriteConflictError('a.md', 'x', 'x'))).toBe(true)
    clock.advance(500)
    expect(published.at(-1)).toMatchObject({ disk: { 'g-a': 'blocked', 'g-b': 'behind' }, blocked: { 'g-a': 423 } })
    a.diskMatchesCrdt = true
    b.diskMatchesCrdt = true
    clock.advance(500)
    expect(published.at(-1)).toMatchObject({ disk: { 'g-a': 'match', 'g-b': 'match' }, blocked: {} })
    fs.stop()
  })

  it('the hash the CAS compares is the adapter hash (sanity for the lease)', () => {
    const bytes = formatHostMarker({ room: 'r', vault: 'v', epoch: 1, instance: 'i', heartbeat: 'h' })
    expect(text(bytes)).toContain('instance: i')
    expect(hashBytes(bytes)).toMatch(/^[0-9a-f]{64}$/)
  })
})
