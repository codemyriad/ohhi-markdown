/**
 * `VaultAdapter` over WebDAV (Nextcloud Files) — the headless custodian's
 * disk (nextcloud-build NC2, decisions 9, 10, 12).
 *
 * - Every URL (and every MOVE `Destination`) is the fixed base plus
 *   percent-encoded segments, and is asserted to stay under the base.
 * - `read` returns `null` ONLY for a 404 on the file; a 404 on the vault root
 *   is `VaultUnavailableError`; any other failure is a `WebDavError`.
 * - `writeAtomic` with `expectHash` is a real compare-and-swap: GET, hash,
 *   PUT `If-Match` the etag of the bytes that were hashed. No etag↔hash map
 *   is persisted; the transient etags from the last walk are only a HINT for
 *   DELETE's `If-Match`, never for CAS.
 * - `watch` is the ETag walk of `walk.ts` on the INJECTED clock.
 */
import type { Clock } from '../session.js'
import { hashBytes } from '../hash.js'
import {
  IGNORED_DIRS,
  isReservedFile,
  isTempName,
  VaultUnavailableError,
  WebDavError,
  WriteConflictError,
  type FileStat,
  type VaultAdapter,
  type WatchEvent,
  type WriteOptions,
} from '../types.js'
import { httpError, pathSegments, WebDavPathError } from './errors.js'
import { foreignReason, httpDate, PROPFIND_BODY, parseMultistatus, type DavEntry } from './propfind.js'
import { diffTables, walkTree, WalkRaceError, type HeldVanishes, type Listing, type WalkTable } from './walk.js'

export interface WebDavAdapterOptions {
  /** `…/remote.php/dav/files/<owner>/<ownerPath>/` (a trailing slash is added if missing). */
  baseUrl: string
  /** Per-request auth headers (AUTHORIZATION-APP-API, Basic, …). */
  headers: () => Record<string, string>
  fetch?: typeof fetch
  clock: Clock
  /** Walk interval: `active` while `isActive()` or after a hint, else `idle`. */
  pollMs?: { active: number; idle: number }
  /** The room has peers → the active interval. */
  isActive?: () => boolean
  /** The uid every visible entry's `oc:owner-id` must equal (decision 3). */
  owner: string
  /** Called once per path hidden for a foreign owner or a non-home mount. */
  onIgnored?: (path: string, reason: 'owner' | 'mount') => void
  /** A watch walk failed (it is retried on the next tick; nothing is emitted). */
  onWalkError?: (err: unknown) => void
  /**
   * A walk answered — a watch tick's, or `list()`/`listDirs()`'s — and what
   * it cost: its PROPFINDs, and whether it listed every folder (`full`, no
   * baseline to compare etags with). An unchanged tree costs one request.
   */
  onWalk?: (stats: WalkStats) => void
}

/** One walk's cost, for the host's debug log and the bench. */
export interface WalkStats {
  requests: number
  full: boolean
}

export const DEFAULT_POLL_MS = { active: 2_000, idle: 30_000 } as const

type Cb = (ev: WatchEvent) => void

interface Got {
  bytes: Uint8Array
  etag: string | null
  /** `Last-Modified` and the server `Date`, epoch ms (second resolution). */
  lastModified: number | null
  date: number | null
}

/**
 * How many times a CAS write waits a second for a file that was modified in
 * the CURRENT server second (see `writeAtomic`) before giving up as a conflict.
 */
const MAX_SETTLE_WAITS = 3

/** How many torn walks `list()` re-walks before it gives up. */
const FULL_WALK_ATTEMPTS = 3


const quoted = (etag: string): string => (etag.startsWith('"') || etag.startsWith('W/') ? etag : `"${etag}"`)

const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export class WebDavVaultAdapter implements VaultAdapter {
  private readonly base: string
  private readonly doFetch: typeof fetch
  private readonly clock: Clock
  private readonly poll: { active: number; idle: number }

  /** The last walk's table: the watcher's baseline (`null` until primed). */
  private table: WalkTable | null = null
  /** Vanishes held one walk, to pair with a move the walk tore (walk.ts). */
  private held: HeldVanishes = new Map()
  /** Transient etag hints for DELETE `If-Match` — from walks and our own PUTs. Never used for CAS. */
  private readonly etagHint = new Map<string, string>()
  private readonly ignoredReported = new Set<string>()
  /** Walks and `list()` run one at a time over the shared table. */
  private chain: Promise<unknown> = Promise.resolve()
  private readonly watchers = new Set<Cb>()
  private cancelTick: (() => void) | null = null
  private ticking: Promise<void> | null = null
  private hintedAt = Number.NEGATIVE_INFINITY

  constructor(private readonly opts: WebDavAdapterOptions) {
    const withSlash = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`
    this.base = new URL(withSlash).href
    this.doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.clock = opts.clock
    this.poll = opts.pollMs ?? DEFAULT_POLL_MS
  }

  // ---- URLs (decision 12) ----

  /** Absolute URL of a vault-relative path; throws rather than leave the base. */
  url(path: string, dir = false): string {
    if (path === '') return this.base
    const out = this.base + pathSegments(path).map(encodeURIComponent).join('/') + (dir ? '/' : '')
    if (!out.startsWith(this.base) || !new URL(out).href.startsWith(this.base)) {
      throw new WebDavPathError(path)
    }
    return out
  }

  // ---- HTTP ----

  private async send(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: BodyInit; dir?: boolean } = {}
  ): Promise<Response> {
    const url = this.url(path, init.dir)
    try {
      return await this.doFetch(url, {
        method,
        headers: { ...this.opts.headers(), ...init.headers },
        body: init.body,
        // Decision 15: never follow a redirect off the configured origin.
        redirect: 'manual',
      })
    } catch (err) {
      // Nextcloud unreachable: a typed error that names the path (status 0),
      // so the custodian can say which file is waiting and retry it.
      throw new WebDavError(0, method, path, `${method} ${path}: ${err instanceof Error ? err.name : 'network error'}`)
    }
  }

  /** A parent MKCOL made for `path` failed: the same error, naming the FILE being written (nextcloud-build R1 #8). */
  private async mkdirFor(path: string): Promise<void> {
    try {
      await this.mkdir(parentOf(path))
    } catch (err) {
      if (err instanceof WebDavError) throw httpError('MKCOL', path, err.status, true)
      throw err
    }
  }

  /** Drain a body we do not need, so the connection is reusable. */
  private static async drain(res: Response): Promise<void> {
    try {
      await res.arrayBuffer()
    } catch {
      // already consumed or aborted
    }
  }

  /** PROPFIND at `depth`; `null` on 404. */
  private async propfind(path: string, depth: 0 | 1): Promise<DavEntry[] | null> {
    return (await this.propfindListing(path, depth))?.entries ?? null
  }

  /** PROPFIND at `depth` with the server's `Date`; `null` on 404. */
  private async propfindListing(path: string, depth: 0 | 1): Promise<Listing | null> {
    const res = await this.send('PROPFIND', path, {
      headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
      body: PROPFIND_BODY,
      dir: path !== '',
    })
    if (res.status === 404) {
      await WebDavVaultAdapter.drain(res)
      return null
    }
    if (res.status !== 207) {
      await WebDavVaultAdapter.drain(res)
      throw httpError('PROPFIND', path, res.status, false)
    }
    const at = httpDate(res.headers.get('date'))
    return { entries: parseMultistatus(await res.text(), this.base), at }
  }

  /** Throws `VaultUnavailableError` when the vault root itself answers 404. */
  private async assertRoot(): Promise<void> {
    if ((await this.propfind('', 0)) === null) throw new VaultUnavailableError('/')
  }

  private async isDir(path: string): Promise<boolean> {
    const self = await this.propfind(path, 0)
    return self?.find((e) => e.path === path)?.isDir === true
  }

  /** GET bytes + etag; `null` only for a 404 on the file (root checked). */
  private async get(path: string): Promise<Got | null> {
    const res = await this.send('GET', path)
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      // OC-ETag first: a compressing proxy may rewrite ETag (`-gzip`), never OC-ETag.
      const etag = res.headers.get('oc-etag') ?? res.headers.get('etag')
      // Nextcloud answers GET on a COLLECTION with 200 and an HTML notice and
      // no etag (measured on NC 35): a directory reads as null, never as bytes.
      if (etag === null && (await this.isDir(path))) return null
      return {
        bytes,
        etag,
        lastModified: httpDate(res.headers.get('last-modified')),
        date: httpDate(res.headers.get('date')),
      }
    }
    await WebDavVaultAdapter.drain(res)
    if (res.status === 404) {
      await this.assertRoot()
      return null
    }
    // Plain Sabre refuses GET on a collection instead (405/501).
    if ((res.status === 405 || res.status === 501) && (await this.isDir(path))) return null
    throw httpError('GET', path, res.status, false)
  }

  // ---- VaultAdapter ----

  async read(path: string): Promise<Uint8Array | null> {
    return (await this.get(path))?.bytes ?? null
  }

  /**
   * Defence in depth behind the session's key filter (decision 12): this
   * adapter never writes, moves, makes or deletes anything under an ignored
   * directory or at a reserved name — whatever a caller asks. The ONE way to
   * write a reserved file is `writeReserved`, the custodian's marker lease.
   */
  private guardWrite(path: string): void {
    if (isReservedFile(path) || path.split('/').some((seg) => IGNORED_DIRS.has(seg))) {
      throw new WebDavPathError(path)
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    this.guardWrite(path)
    await this.cas(path, bytes, opts)
  }

  /** Write a reserved root file (the host marker), CAS rules as `writeAtomic`. */
  async writeReserved(name: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    if (!isReservedFile(name)) throw new WebDavPathError(name)
    await this.cas(name, bytes, opts)
  }

  private async cas(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    const expect = opts?.expectHash
    if (expect === undefined) {
      await this.put(path, bytes, {})
      return
    }
    if (expect === '') {
      const ok = await this.put(path, bytes, { 'If-None-Match': '*' }, true)
      if (!ok) throw new WriteConflictError(path, '', await this.hashOf(path))
      return
    }
    // GET → hash → PUT If-Match <the etag of the bytes we hashed>.
    let retried = false
    let waits = 0
    for (;;) {
      const cur = await this.get(path)
      const actual = cur ? hashBytes(cur.bytes) : ''
      if (actual !== expect) throw new WriteConflictError(path, expect, actual)
      if (!cur!.etag) throw httpError('GET', path, 0, false) // no etag: CAS impossible
      // Nextcloud keeps a file's etag for a second write inside the same
      // wall-clock second (measured on NC 35), so If-Match cannot see a write
      // that lands in the second the file was last modified. While the file
      // is that fresh, wait for the next second (injected clock) and re-read.
      if (cur!.lastModified !== null && cur!.date !== null && cur!.lastModified >= cur!.date) {
        if (waits++ >= MAX_SETTLE_WAITS) throw new WriteConflictError(path, expect, actual)
        await this.sleep(1_000)
        continue
      }
      if (await this.put(path, bytes, { 'If-Match': quoted(cur!.etag) }, true)) return
      // 412: the etag moved. Retry once if the BYTES did not (decision 9).
      if (retried) break
      retried = true
    }
    throw new WriteConflictError(path, expect, await this.hashOf(path))
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.clock.schedule(resolve, ms))
  }

  /**
   * PUT; `true` on success. With `conditional`, a 412 returns `false`
   * instead of throwing. A 409 (missing parent) creates the parents once.
   */
  private async put(
    path: string,
    bytes: Uint8Array,
    headers: Record<string, string>,
    conditional = false
  ): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.send('PUT', path, {
        headers: { 'Content-Type': 'application/octet-stream', ...headers },
        body: bytes as unknown as BodyInit,
      })
      await WebDavVaultAdapter.drain(res)
      if (res.ok) {
        const etag = res.headers.get('oc-etag') ?? res.headers.get('etag')
        if (etag) this.etagHint.set(path, etag)
        else this.etagHint.delete(path)
        return true
      }
      if (res.status === 412 && conditional) return false
      // A missing parent: Nextcloud says 404 (measured), plain Sabre 409.
      if (res.status === 404 || res.status === 409) {
        if (attempt === 0 && path.includes('/')) {
          await this.mkdirFor(path)
          continue
        }
        await this.assertRoot()
      }
      throw httpError('PUT', path, res.status, true)
    }
  }

  private async hashOf(path: string): Promise<string> {
    const cur = await this.get(path)
    return cur ? hashBytes(cur.bytes) : ''
  }

  async rename(from: string, to: string): Promise<void> {
    await this.move(from, to, false)
  }

  async renameDir(from: string, to: string): Promise<void> {
    await this.move(from, to, true)
  }

  private async move(from: string, to: string, dir: boolean): Promise<void> {
    this.guardWrite(from)
    this.guardWrite(to)
    const destination = this.url(to, dir)
    for (let attempt = 0; ; attempt++) {
      const res = await this.send('MOVE', from, {
        headers: { Destination: destination, Overwrite: 'F' },
        dir,
      })
      await WebDavVaultAdapter.drain(res)
      if (res.ok) {
        const hint = this.etagHint.get(from)
        this.etagHint.delete(from)
        if (hint !== undefined && !dir) this.etagHint.set(to, hint)
        if (dir) for (const k of [...this.etagHint.keys()]) if (k.startsWith(`${from}/`)) this.etagHint.delete(k)
        return
      }
      if (res.status === 412) throw new WriteConflictError(to, '', dir ? '' : await this.hashOf(to))
      if (res.status === 409 && attempt === 0 && to.includes('/')) {
        await this.mkdirFor(to)
        continue
      }
      throw httpError('MOVE', from, res.status, true)
    }
  }

  async remove(path: string): Promise<void> {
    this.guardWrite(path)
    const hint = this.etagHint.get(path)
    const res = await this.send('DELETE', path, {
      headers: hint ? { 'If-Match': quoted(hint) } : {},
    })
    await WebDavVaultAdapter.drain(res)
    this.etagHint.delete(path)
    if (res.ok || res.status === 404) return
    if (res.status === 412) {
      // The file changed since the etag we hold was current: not ours to delete.
      // `expected` names that etag (a hint, not a content hash).
      throw new WriteConflictError(path, hint ?? '', await this.hashOf(path))
    }
    throw httpError('DELETE', path, res.status, true)
  }

  async mkdir(path: string): Promise<void> {
    if (path === '') return
    this.guardWrite(path)
    for (let attempt = 0; ; attempt++) {
      const res = await this.send('MKCOL', path, { dir: true })
      await WebDavVaultAdapter.drain(res)
      if (res.ok || res.status === 405) return // 405: it already exists
      if (res.status === 409) {
        if (attempt === 0 && path.includes('/')) {
          await this.mkdir(parentOf(path))
          continue
        }
        await this.assertRoot()
      }
      throw httpError('MKCOL', path, res.status, true)
    }
  }

  async removeDir(path: string): Promise<void> {
    this.guardWrite(path)
    const entries = await this.propfind(path, 1)
    if (entries === null) return // missing is a no-op
    const self = entries.find((e) => e.path === path)
    if (self && !self.isDir) throw new Error(`removeDir: not a directory ${path}`)
    if (entries.some((e) => e.path !== path)) throw new Error(`removeDir: not empty ${path}`)
    // No If-Match: Nextcloud never matches one on a collection (measured: 412
    // with the folder's current etag). A child that lands between the listing
    // and this DELETE is the residual window — one round trip wide.
    const res = await this.send('DELETE', path, { dir: true })
    await WebDavVaultAdapter.drain(res)
    if (res.ok || res.status === 404) return
    throw httpError('DELETE', path, res.status, true)
  }

  async list(): Promise<FileStat[]> {
    const table = await this.fullWalk()
    return [...table.files].map(([path, rec]) => ({ path, size: rec.size }))
  }

  async listDirs(): Promise<string[]> {
    const table = await this.fullWalk()
    return [...table.dirs.keys()].filter((d) => d !== '').sort()
  }

  async listAppDir(dir: string): Promise<string[]> {
    const rel = dir.replace(/^\/+|\/+$/g, '')
    const entries = await this.propfind(rel, 1)
    if (entries === null) return []
    return entries
      .filter((e) => e.path !== rel && !e.isDir && parentOf(e.path) === rel && !isTempName(e.path))
      .map((e) => e.path)
      .sort()
  }

  // ---- the walk (decision 10) ----

  /** Is this entry visible to the vault at all? Logs foreign entries once. */
  private visible(e: DavEntry): boolean {
    const name = e.path.slice(e.path.lastIndexOf('/') + 1)
    if (e.isDir && IGNORED_DIRS.has(name)) return false
    if (!e.isDir && (isReservedFile(e.path) || isTempName(name))) return false
    const reason = foreignReason(e, this.opts.owner)
    if (reason === null) return true
    if (!this.ignoredReported.has(e.path)) {
      this.ignoredReported.add(e.path)
      this.opts.onIgnored?.(e.path, reason)
    }
    return false
  }

  /** The walk's view of the server, counting its PROPFINDs into `stats`. */
  private walkDeps(stats: WalkStats) {
    return {
      propfind: (path: string) => {
        stats.requests++
        return this.propfindListing(path, 1)
      },
      visible: (e: DavEntry) => this.visible(e),
    }
  }

  /** One walk from `base` (null = list every folder), its cost reported once it answered. */
  private async walkOnce(base: WalkTable | null): Promise<WalkTable> {
    const stats: WalkStats = { requests: 0, full: base === null }
    const next = await walkTree(this.walkDeps(stats), base)
    this.opts.onWalk?.(stats)
    return next
  }

  /** Serialize over the shared table. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Install a new table; emit its diff to watchers when there was a baseline. */
  private adopt(next: WalkTable): void {
    const prev = this.table
    this.table = next
    this.etagHint.clear()
    for (const [path, rec] of next.files) if (rec.etag) this.etagHint.set(path, rec.etag)
    if (!prev) return
    const { event, held } = diffTables(prev, next, this.held)
    this.held = held
    // A vanish held for one walk is answered on the ACTIVE interval, not idle.
    if (held.size > 0) this.hintedAt = this.clock.now()
    if (!event) return
    for (const cb of [...this.watchers]) cb(event)
  }

  /**
   * The table as the server has it now, for `list()` and `listDirs()`. With a
   * baseline this is an incremental walk like a watch tick — descending only
   * where a folder's etag moved, so an unchanged tree costs ONE PROPFIND
   * (bench 2026-10-11: a full listing here re-listed every folder, 84
   * PROPFINDs per call on the 1,000-note vault, and `bootScan` asks for both
   * lists); its diff reaches the watchers exactly as the next tick's would
   * have. Without one, every folder is listed. A torn walk is walked again
   * from the root, a bounded number of times.
   */
  private fullWalk(): Promise<WalkTable> {
    return this.serial(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const next = await this.walkOnce(this.table)
          this.adopt(next)
          return next
        } catch (err) {
          if (!(err instanceof WalkRaceError) || attempt >= FULL_WALK_ATTEMPTS) throw err
        }
      }
    })
  }

  private incrementalWalk(): Promise<void> {
    return this.serial(async () => {
      this.adopt(await this.walkOnce(this.table))
    })
  }

  watch(cb: Cb): () => void {
    this.watchers.add(cb)
    if (this.watchers.size === 1) this.schedule(0)
    return () => {
      this.watchers.delete(cb)
      if (this.watchers.size === 0) {
        this.cancelTick?.()
        this.cancelTick = null
      }
    }
  }

  /** Walk again ~now (a peer arrived, an edit was announced). */
  hint(): void {
    this.hintedAt = this.clock.now()
    if (this.watchers.size > 0) this.schedule(0)
  }

  /** Resolves once no watch walk is in flight (for tests and orderly shutdown). */
  async idle(): Promise<void> {
    while (this.ticking) await this.ticking
  }

  private interval(): number {
    const hinted = this.clock.now() - this.hintedAt < this.poll.idle
    return this.opts.isActive?.() === true || hinted ? this.poll.active : this.poll.idle
  }

  private schedule(ms: number): void {
    this.cancelTick?.()
    this.cancelTick = this.clock.schedule(() => {
      this.cancelTick = null
      const run = this.tick()
      this.ticking = run
      void run.finally(() => {
        if (this.ticking === run) this.ticking = null
      })
    }, ms)
  }

  private async tick(): Promise<void> {
    if (this.watchers.size === 0) return
    try {
      await this.incrementalWalk()
    } catch (err) {
      this.opts.onWalkError?.(err)
    }
    // Disposed meanwhile, or a hint already queued the next walk.
    if (this.watchers.size === 0 || this.cancelTick) return
    this.schedule(this.interval())
  }
}
