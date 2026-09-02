/**
 * MountSession: host-neutral orchestration of ONE mount — a vault subtree
 * bound to a room. Extracted verbatim-in-behavior from the web shell's
 * setupWorkspace closure (apps/web workspace.svelte.ts) so every host — the
 * Svelte shell, a future Obsidian plugin, a headless peer — consumes the same
 * wiring (dogfood-shaping B4 / obsidian-shaping B1; spike S8 Q7 phase 1).
 *
 * Boot machine (spike S8 Q3, slice M1) — the mount decides how to boot from
 * DURABLE STATE, not from a config mode:
 *   1. Durable state present (doc blobs + LCA in the StoreDir) → REOPEN:
 *      restore docs, then run the reconciler's four-way classification over
 *      every file (offline edits ingest, remote-ahead docs materialize, true
 *      divergence reviews) plus a membership delta scan for files that
 *      appeared on disk while closed. Providers connect in the background and
 *      are never awaited — offline reopen of a shared mount works.
 *   2. No durable state + `firstJoin` → first materialization of a joined
 *      mount: pull the relay room (awaited), then persist everything. The
 *      historical pre-M1 wipe is gone — a first join's destination is fresh
 *      by construction, and a stores-lost rejoin tolerates byte-identical
 *      disk (joinFolder reports anything else as a problem, never deletes).
 *   3. No durable state otherwise → enroll disk (one-time seeding), then
 *      persist.
 *
 * Origin note (verified against @hocuspocus/provider 4.1.2): provider-applied
 * updates carry the provider INSTANCE as origin, not the seam's 'remote'
 * string, so we route doc updates ourselves and only trust the seam strings
 * we emit ('seed' from enrollment, 'disk' from reconciler ingest).
 *
 * No Svelte, no ambient timers: the Clock is injected (golden rule 5), and
 * reactive state lives host-side behind the `recordFor` factory + events.
 */
import type {
  Clock,
  DivergenceReview,
  DocStore,
  LcaStore,
  MountProvenance,
  MountsFile,
  PreImageJournal,
  ReconcileThresholds,
  VaultAdapter,
} from '@editor/vault'
import {
  BlobDocStore,
  decodeFile,
  DEFAULT_THRESHOLDS,
  enrollFolder,
  FOLDER_DOC_KEY,
  hashBytes,
  joinFolder,
  JsonFileLcaStore,
  looksBinary,
  NEVER_ON_DISK,
  VaultSession,
  type StoreDir,
} from '@editor/vault'
import type { EngineDoc, FileEntry, SyncEngine } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import { connectDoc, whenSynced, type DocConnection } from './providers.js'
import {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type FileRow,
  type MountEvents,
  type RelayConfig,
  type SyncRecordFields,
} from './types.js'

const FLUSH_DEBOUNCE_MS = 800
const CLOSED_RECONCILE_MS = 200

export interface MountSessionConfig {
  engine: SyncEngine
  adapter: VaultAdapter
  user: CollabUser
  /** Folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /**
   * When no durable state exists, bootstrap by pulling the relay room
   * (awaited) instead of enrolling disk. True for a first join, and for any
   * relay-attached session whose stores are gone — enrolling fresh GUIDs into
   * an existing room would double its content (see header note 2).
   */
  firstJoin?: boolean
  /** Present → connect to the relay (background, except a firstJoin pull). */
  relay?: RelayConfig
  clock: Clock
  lcaStore: LcaStore
  journal: PreImageJournal
  /** Durable doc-state blobs; presence of a folder blob switches boot to reopen. */
  docStore?: DocStore
  /** The vault's mount table; this mount upserts its own desc ('active'). */
  mountsFile?: MountsFile
  /** Workspace-relative mount root for the mounts.json desc ('' = root). */
  mountPath?: string
  /** Recorded in the mount desc; default: 'joined' when firstJoin, else 'local'. */
  provenance?: MountProvenance
  thresholds?: Partial<ReconcileThresholds>
  /** Stable reactive record factory, keyed by doc GUID + FOLDER_RECORD_KEY (guids are rename-stable). */
  recordFor: (key: string) => SyncRecordFields
  events?: MountEvents
  /** Builds the copyable share link once the mount is shared. */
  makeShareLink: (relay: RelayConfig, room: string) => string
  /** Non-browser hosts pass their WebSocket impl through to providers. */
  webSocketPolyfill?: unknown
}

export class MountSession {
  readonly room: string
  readonly user: CollabUser

  private readonly cfg: MountSessionConfig
  private readonly engine: SyncEngine
  private readonly adapter: VaultAdapter
  private readonly clock: Clock
  private readonly lcaStore: LcaStore
  private readonly journal: PreImageJournal
  private readonly events: MountEvents

  private readonly folderDoc: EngineDoc
  private readonly docs = new Map<string, EngineDoc>()
  private readonly conns = new Map<string, DocConnection>()
  private readonly tracked = new Set<string>()
  private readonly debounces = new Map<string, () => void>()

  /** Mutable so enableSharing() can attach a relay to an already-running local mount. */
  private relay: RelayConfig | null
  private folderConn: DocConnection | null = null
  private sessionRef: VaultSession | null = null
  private adoptionEnabled = false
  private mapWork: Promise<void> = Promise.resolve()
  private openPath: string | null = null
  private authFailure: string | null = null
  private sharedLink: string | null = null

  static async create(cfg: MountSessionConfig): Promise<MountSession> {
    const session = new MountSession(cfg)
    await session.boot()
    return session
  }

  private constructor(cfg: MountSessionConfig) {
    this.cfg = cfg
    this.room = cfg.room
    this.user = cfg.user
    this.engine = cfg.engine
    this.adapter = cfg.adapter
    this.clock = cfg.clock
    this.lcaStore = cfg.lcaStore
    this.journal = cfg.journal
    this.events = cfg.events ?? {}
    this.relay = cfg.relay ?? null
    this.folderDoc = cfg.engine.createDoc(`${cfg.room}/folder`)

    this.folderDoc.getMap().observe(() => {
      if (this.adoptionEnabled) void this.queueMapScan()
      else this.refreshFiles()
    })
  }

  // ---- public surface ----

  isShared(): boolean {
    return this.sharedLink !== null
  }

  shareLink(): string | null {
    return this.sharedLink
  }

  files(): FileRow[] {
    return this.currentRows()
  }

  docForPath(path: string): EngineDoc | null {
    const guid = this.guidFor(path)
    return guid ? (this.docs.get(guid) ?? null) : null
  }

  awarenessForPath(path: string): Awareness | null {
    const guid = this.guidFor(path)
    return guid ? (this.conns.get(guid)?.awareness ?? null) : null
  }

  /** Editor lifecycle: the open path's file is owned by the editor (no materialize). */
  setOpenPath(path: string | null): void {
    if (this.openPath === path) return
    const prevPath = this.openPath
    this.openPath = path // before flush routing so prev counts as closed
    if (prevPath) {
      const prevGuid = this.guidFor(prevPath)
      if (prevGuid) {
        this.debounces.get(prevGuid)?.()
        this.debounces.delete(prevGuid)
        void this.reconcileClosedDoc(prevGuid, prevPath)
      }
    }
    if (path) {
      const guid = this.guidFor(path)
      if (guid) this.sessionRef?.markOpen(guid)
    }
  }

  /** Create an empty untitled note in `dir` ('' = root); returns its path. */
  async createFile(dir = ''): Promise<string | null> {
    try {
      const base = dir ? `${dir}/` : ''
      const taken = new Set(this.folderDoc.getMap().entries().map(([p]) => p))
      let n = 1
      while (taken.has(`${base}untitled-${n}.md`)) n++
      const path = `${base}untitled-${n}.md`
      const bytes = new TextEncoder().encode('')
      await this.adapter.writeAtomic(path, bytes)
      const guid = crypto.randomUUID()
      const doc = this.engine.createDoc(guid)
      this.docs.set(guid, doc) // before the map txn so our own observer won't adopt it
      this.cfg.docStore?.track(guid, doc)
      await this.lcaStore.put({
        guid,
        path,
        baseText: '',
        contentHash: hashBytes(bytes),
        heads: this.engine.encodeHeads(this.engine.heads(doc)),
        eol: 'lf',
        bom: false,
      })
      this.folderDoc.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
      this.trackDoc(guid, path)
      await this.restartSession()
      this.refreshFiles()
      return path
    } catch (err) {
      this.pushError(err)
      return null
    }
  }

  async resolveReview(guid: string, mergedText: string): Promise<void> {
    if (!this.sessionRef) return
    try {
      await this.sessionRef.resolveReview(guid, mergedText)
      const path = this.pathForGuid(guid)
      if (path) await this.refreshDiskMatch(path, guid)
    } catch (err) {
      this.pushError(err)
    }
  }

  // ---- tree operations (M3) — thin wrappers over VaultSession's local ops ----

  async createDir(path: string): Promise<void> {
    try {
      await this.sessionRef?.createDir(path)
      this.refreshFiles()
    } catch (err) {
      this.pushError(err)
    }
  }

  /** Rename/move a file or directory (kind read from the map). */
  async renamePath(from: string, to: string): Promise<void> {
    const entry = this.folderDoc.getMap().get(from)
    if (!entry || entry.deleted) {
      this.pushError(new Error(`rename: unknown path ${from}`))
      return
    }
    try {
      if (entry.kind === 'dir') await this.sessionRef?.renameDir(from, to)
      else await this.sessionRef?.renameFile(from, to)
      this.refreshFiles()
    } catch (err) {
      this.pushError(err)
    }
  }

  async deletePath(path: string): Promise<void> {
    const entry = this.folderDoc.getMap().get(path)
    if (!entry || entry.deleted) {
      this.pushError(new Error(`delete: unknown path ${path}`))
      return
    }
    try {
      if (this.openPath === path || (entry.kind === 'dir' && this.openPath?.startsWith(`${path}/`))) {
        this.setOpenPath(null)
      }
      if (entry.kind === 'dir') await this.sessionRef?.deleteDir(path)
      else await this.sessionRef?.deleteFile(path)
      this.refreshFiles()
    } catch (err) {
      this.pushError(err)
    }
  }

  // ---- carve (spike S8 Q1, slice M4) — this mount is the PARENT being carved ----

  /**
   * Carve step 3 (seeding): copy this mount's subtree state into a fresh
   * mount namespace — folder doc with keys rebased subtree-relative and the
   * SAME doc guids, LCA records with rebased paths, doc-state blobs. Pure
   * copies; this mount is untouched, so the step is idempotent and a crash
   * here rolls BACK (recoverMounts drops the target namespace).
   */
  async seedCarveStores(prefix: string, targetDir: StoreDir): Promise<void> {
    const pre = `${prefix}/`
    const subtree = this.folderDoc
      .getMap()
      .entries()
      .filter(([p, e]) => !e.deleted && (p === prefix || p.startsWith(pre)))

    // Temp doc under a throwaway name — never `${room}/folder`, which the new
    // mount's own MountSession will create as its instance later.
    const tmp = this.engine.createDoc(`carve-tmp:${crypto.randomUUID()}`)
    const store = new BlobDocStore(this.engine, targetDir, this.clock)
    try {
      tmp.transactMap((m) => {
        for (const [path, entry] of subtree) {
          if (path === prefix) continue // the carved dir itself becomes the new vault root
          m.set(path.slice(pre.length), entry)
        }
      }, 'seed')
      store.track(FOLDER_DOC_KEY, tmp)
      await store.flush(FOLDER_DOC_KEY)

      const lcas = new JsonFileLcaStore(targetDir.io('lca.json'))
      for (const [path, entry] of subtree) {
        if (entry.kind !== 'text') continue
        const doc = this.docs.get(entry.guid)
        if (doc) {
          store.track(entry.guid, doc)
          await store.flush(entry.guid)
        }
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) await lcas.put({ ...lca, path: path.slice(pre.length) })
      }
    } finally {
      store.dispose()
      tmp.destroy()
    }
  }

  /**
   * Carve step 5 (detaching): remove the subtree from this mount — one map
   * transaction for the entries (the carved dir's own entry included), then
   * per-doc teardown (providers, debounces, blobs, LCAs, doc instances). The
   * adapter the host gave us must already ignore `prefix` (live ignore set)
   * so the restarted watcher never sees the subtree again. Idempotent —
   * recoverMounts re-runs it as store surgery after a crash.
   */
  async detachSubtree(prefix: string): Promise<void> {
    const pre = `${prefix}/`
    const doomed = this.folderDoc
      .getMap()
      .entries()
      .filter(([p]) => p === prefix || p.startsWith(pre))

    this.folderDoc.transactMap((m) => {
      for (const [path] of doomed) m.delete(path)
    }, 'local')

    for (const [, entry] of doomed) {
      if (entry.kind !== 'text') continue
      const guid = entry.guid
      this.debounces.get(guid)?.()
      this.debounces.delete(guid)
      this.conns.get(guid)?.destroy()
      this.conns.delete(guid)
      this.tracked.delete(guid)
      this.cfg.docStore?.untrack(guid)
      await this.cfg.docStore?.remove(guid)
      await this.lcaStore.remove(guid)
      const doc = this.docs.get(guid)
      this.docs.delete(guid)
      doc?.destroy()
    }

    // Shorten the rollforward window: the map deletion is durable now, not at
    // the next debounce tick (crash between txn and flush is still covered by
    // recoverMounts' store surgery).
    await this.cfg.docStore?.flush(FOLDER_DOC_KEY)
    await this.restartSession()
    this.refreshFiles()
  }

  /** Promote a local mount to a shared one; returns the copyable link. */
  enableSharing(newRelay: RelayConfig): { link: string } {
    this.relay = newRelay
    this.connectFolder() // sets sharedLink + fires onShared, wires presence
    for (const guid of this.docs.keys()) {
      const path = this.pathForGuid(guid)
      if (path) this.attachProvider(guid, path)
    }
    // Remember the relay in the mount desc so a reopen reconnects it.
    void this.writeMountDesc().catch((err) => this.pushError(err))
    return { link: this.sharedLink! }
  }

  dispose(): void {
    for (const cancel of this.debounces.values()) cancel()
    this.debounces.clear()
    this.sessionRef?.dispose()
    for (const conn of this.conns.values()) conn.destroy()
    this.conns.clear()
    this.folderConn?.destroy()
    this.folderConn = null
    // Best-effort tail flush: the debounced blob writes run continuously
    // during the session, so this only catches the last debounce window (a
    // page close can't await it either way — bounded loss, spike S8 Q2).
    const ds = this.cfg.docStore
    if (ds) void ds.flushAll().finally(() => ds.dispose())
  }

  // ---- internals ----

  private pushError(err: unknown): void {
    this.events.onError?.(err)
  }

  private recordFor(key: string): SyncRecordFields {
    return this.cfg.recordFor(key)
  }

  private guidFor(path: string): string | null {
    const entry = this.folderDoc.getMap().get(path)
    return entry && entry.kind === 'text' && !entry.deleted ? entry.guid : null
  }

  private pathForGuid(guid: string): string | null {
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.guid === guid && !entry.deleted) return path
    }
    return null
  }

  private currentRows(): FileRow[] {
    return this.folderDoc
      .getMap()
      .entries()
      .filter(([, e]) => !e.deleted)
      .map(([path, e]) => ({ path, guid: e.guid, kind: e.kind }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  private refreshFiles(): void {
    const rows = this.currentRows()
    // Records exist for every text row before the host renders pills for them.
    for (const row of rows) if (row.kind === 'text') this.recordFor(row.guid)
    this.events.onFiles?.(rows)
  }

  /** Recompute diskMatchesCrdt from actual bytes — never guessed. */
  private async refreshDiskMatch(path: string, guid: string): Promise<void> {
    const doc = this.docs.get(guid)
    if (!doc) return
    const bytes = await this.adapter.read(path)
    const diskText = bytes ? decodeFile(bytes).text : ''
    this.recordFor(guid).diskMatchesCrdt = diskText === doc.getText()
  }

  private debounceDoc(guid: string, ms: number, fn: () => void): void {
    this.debounces.get(guid)?.()
    this.debounces.set(
      guid,
      this.clock.schedule(() => {
        this.debounces.delete(guid)
        fn()
      }, ms)
    )
  }

  private async flushOpenDoc(guid: string, path: string): Promise<void> {
    if (!this.sessionRef) return
    try {
      await this.sessionRef.flush(guid)
      await this.refreshDiskMatch(path, guid)
    } catch (err) {
      this.pushError(err)
    }
  }

  private async reconcileClosedDoc(guid: string, path: string): Promise<void> {
    if (!this.sessionRef) return
    try {
      await this.sessionRef.markClosed(guid)
      await this.refreshDiskMatch(path, guid)
    } catch (err) {
      this.pushError(err)
    }
  }

  private routeDocUpdate(guid: string, origin: unknown): void {
    if (origin === 'seed' || origin === 'disk') return
    const path = this.pathForGuid(guid)
    if (!path) return
    this.recordFor(guid).diskMatchesCrdt = false
    if (this.openPath === path) {
      this.debounceDoc(guid, FLUSH_DEBOUNCE_MS, () => void this.flushOpenDoc(guid, path))
    } else {
      this.debounceDoc(guid, CLOSED_RECONCILE_MS, () => void this.reconcileClosedDoc(guid, path))
    }
  }

  /** Connect a relay provider for one doc. No-op without a relay. */
  private attachProvider(guid: string, path: string): void {
    if (!this.relay || this.conns.has(guid)) return
    const doc = this.docs.get(guid)
    if (!doc) return
    this.conns.set(
      guid,
      connectDoc({
        relay: this.relay.url,
        name: `${this.room}/${guid}`,
        token: this.relay.token,
        doc,
        user: this.user,
        record: this.recordFor(guid),
        onAuthFailed: (reason) => this.reportAuthFailure(reason),
        webSocketPolyfill: this.cfg.webSocketPolyfill,
      })
    )
  }

  /**
   * Track a doc for disk reconciliation (always) and connect its provider (if
   * a relay is attached). Update routing is registered exactly once per doc
   * so a later enableSharing doesn't double-subscribe.
   */
  private trackDoc(guid: string, path: string): void {
    const doc = this.docs.get(guid)
    if (!doc) return
    if (!this.tracked.has(guid)) {
      this.tracked.add(guid)
      this.engine.onUpdate(doc, (_update, origin) => this.routeDocUpdate(guid, origin))
    }
    this.attachProvider(guid, path)
  }

  /** Bind a doc/provider/LCA for a folder-map entry we did not create. */
  private async adoptEntry(path: string, entry: FileEntry): Promise<void> {
    const doc = this.engine.createDoc(entry.guid)
    this.docs.set(entry.guid, doc)
    // Track before the LCA put so the guard's flush persists a blob first.
    this.cfg.docStore?.track(entry.guid, doc)
    await this.lcaStore.put({
      guid: entry.guid,
      path,
      baseText: '',
      contentHash: NEVER_ON_DISK,
      heads: this.engine.encodeHeads(this.engine.heads(doc)),
      eol: 'lf',
      bom: false,
    })
    this.trackDoc(entry.guid, path)
  }

  private async scanMap(): Promise<void> {
    const adopted: { guid: string; path: string }[] = []
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (!this.docs.has(entry.guid)) {
        await this.adoptEntry(path, entry)
        adopted.push({ guid: entry.guid, path })
      }
    }
    if (adopted.length > 0 && this.sessionRef) {
      // VaultSession only learns paths at start() — rebuild so flush/watch
      // routing knows the new files, then materialize whatever has content.
      await this.restartSession()
      for (const { guid, path } of adopted) await this.reconcileClosedDoc(guid, path)
    }
    this.refreshFiles()
  }

  private queueMapScan(): Promise<void> {
    this.mapWork = this.mapWork.then(() => this.scanMap()).catch((err) => this.pushError(err))
    return this.mapWork
  }

  private makeSession(): VaultSession {
    return new VaultSession({
      engine: this.engine,
      adapter: this.adapter,
      lcaStore: this.lcaStore,
      journal: this.journal,
      clock: this.clock,
      folderDoc: this.folderDoc,
      docs: this.docs,
      thresholds: this.cfg.thresholds,
      events: {
        onReview: (review) => {
          // Identical-sides fast path (Invariant D's k=1 crash artifact — a
          // lost LCA write behind a durable blob classifies as diverged with
          // mine === theirs): resolving with either side is safe by
          // construction, so never surface it as a review.
          if (review.mine === review.theirs) {
            void this.sessionRef
              ?.resolveReview(review.guid, review.mine)
              .catch((err) => this.pushError(err))
            return
          }
          this.recordFor(review.guid).diverged = true
          this.events.onReview?.(review)
        },
        onReviewCleared: (guid) => {
          this.recordFor(guid).diverged = false
          this.events.onReviewCleared?.(guid)
        },
        onActivity: (guid) => {
          const path = this.pathForGuid(guid)
          if (path) void this.refreshDiskMatch(path, guid)
        },
        onPathsRenamed: (moves) => {
          for (const { from, to } of moves) {
            if (this.openPath === from) this.openPath = to
          }
          this.events.onPathsRenamed?.(moves)
        },
        onBreaker: (paths) => this.holdBatch('watch', paths),
        onError: (err) => this.pushError(err),
      },
    })
  }

  // ---- mass-change breaker (M3): one held batch, watch- or boot-shaped ----

  /** Which machinery holds the current batch (null = nothing held). */
  private pendingBatchKind: 'watch' | 'boot' | null = null

  private holdBatch(kind: 'watch' | 'boot', paths: string[]): void {
    if (this.events.onBreaker) {
      this.pendingBatchKind = kind
      this.events.onBreaker(paths)
    } else {
      // No host affordance (headless/tests): keep the historical auto-confirm.
      console.warn('[workspace] mass-change breaker tripped — auto-confirming', paths)
      if (kind === 'watch') void this.sessionRef?.confirmPendingBatch()
      else void this.confirmBootBatch()
    }
  }

  /** Apply the held batch (host confirm affordance). */
  async confirmBreaker(): Promise<void> {
    const kind = this.pendingBatchKind
    this.pendingBatchKind = null
    if (kind === 'watch') await this.sessionRef?.confirmPendingBatch()
    else if (kind === 'boot') await this.confirmBootBatch()
  }

  /** Drop the held batch: nothing is enrolled, ingested, or reconciled. */
  dismissBreaker(): void {
    const kind = this.pendingBatchKind
    this.pendingBatchKind = null
    if (kind === 'watch') this.sessionRef?.dismissPendingBatch()
    else if (kind === 'boot') this.dismissBootBatch()
  }

  private async restartSession(): Promise<void> {
    this.sessionRef?.dispose()
    this.sessionRef = this.makeSession()
    await this.sessionRef.start()
    if (this.openPath) {
      const guid = this.guidFor(this.openPath)
      if (guid) this.sessionRef.markOpen(guid)
    }
  }

  // ---- relay / presence (only when a relay is attached) ----

  private reportAuthFailure(reason: string): void {
    this.authFailure = `relay rejected this token (${reason}) — check that the share exists on the relay (share CLI / SEED_SHARE) and that the room/token match it`
    this.pushError(new Error(this.authFailure))
  }

  private updatePresence(): void {
    if (!this.folderConn) {
      this.events.onPresence?.([])
      return
    }
    const names = new Set<string>()
    for (const state of this.folderConn.awareness.getStates().values()) {
      const name = (state as { user?: { name?: string } }).user?.name
      if (name) names.add(name)
    }
    this.events.onPresence?.([...names].sort())
  }

  /** Create the folder-doc provider + presence wiring. Idempotent; no-op without a relay. */
  private connectFolder(): DocConnection | null {
    if (this.folderConn || !this.relay) return this.folderConn
    this.folderConn = connectDoc({
      relay: this.relay.url,
      name: `${this.room}/folder`,
      token: this.relay.token,
      doc: this.folderDoc,
      user: this.user,
      record: this.recordFor(FOLDER_RECORD_KEY),
      onAuthFailed: (reason) => this.reportAuthFailure(reason),
      webSocketPolyfill: this.cfg.webSocketPolyfill,
    })
    this.folderConn.awareness.on('change', () => this.updatePresence())
    this.folderConn.awareness.on('update', () => this.updatePresence())
    this.updatePresence()
    this.sharedLink = this.cfg.makeShareLink(this.relay, this.room)
    this.events.onShared?.(this.sharedLink)
    return this.folderConn
  }

  // ---- boot (the spike S8 Q3 machine — see header) ----

  private async boot(): Promise<void> {
    if (await this.tryDurableReopen()) {
      this.refreshFiles()
      return
    }

    if (this.cfg.firstJoin) {
      const folderProvider = this.connectFolder()
      if (!folderProvider) throw new Error('a first join requires a relay')
      // Folder doc first; "synced" alone is not enough — the seeder may arrive
      // later, so also wait for the map to be non-empty. Auth rejection fails
      // fast with a real message instead of timing out as "connecting…".
      await whenSynced(
        folderProvider.provider,
        () => this.folderDoc.getMap().entries().some(([, e]) => !e.deleted),
        60_000,
        () => this.authFailure
      )
      this.adoptionEnabled = true
      await this.queueMapScan() // creates per-file docs + providers
      await Promise.all(
        [...this.conns.values()].map((c) => whenSynced(c.provider, undefined, 60_000, () => this.authFailure))
      )
      // No wipe: a first join's destination is fresh by construction, and a
      // stores-lost rejoin keeps its disk — joinFolder binds byte-identical
      // files and reports anything else as a problem, never deleting content
      // (the pre-M1 wipe here destroyed offline edits; see spike S8 Q3/Q4).
      const { problems } = await joinFolder(this.engine, this.adapter, this.folderDoc, this.docs, this.lcaStore)
      if (problems.length > 0) {
        this.pushError(
          new Error(`join problems: ${problems.map((p) => `${p.path} (${p.reason})`).join(', ')}`)
        )
      }
      await this.restartSession()
      // Materialize relay content onto the joiner's vault backend — dirs too:
      // the map arrived before the session started, so onRemoteMapChange never
      // saw the initial dir entries (M3).
      await this.syncDirs()
      for (const guid of this.docs.keys()) {
        const path = this.pathForGuid(guid)
        if (path) await this.reconcileClosedDoc(guid, path)
      }
    } else {
      // Fresh vault: enroll disk (one-time seeding). Any attached relay (the
      // memory contract's seed role) is connected but NOT awaited.
      this.connectFolder()
      const enrolled = await enrollFolder(this.engine, this.adapter, this.folderDoc, this.lcaStore)
      for (const [guid, doc] of enrolled.docs) this.docs.set(guid, doc)
      for (const [path, entry] of this.folderDoc.getMap().entries()) {
        if (entry.kind === 'text' && !entry.deleted) this.trackDoc(entry.guid, path)
      }
      await this.restartSession()
      this.adoptionEnabled = true
    }

    await this.persistBaseline()
    this.refreshFiles()
  }

  /**
   * Reopen from durable state. Returns false when there is none (no docStore
   * configured, or no folder blob — a fresh boot). On true, docs and LCAs are
   * restored, the session is running, and the boot scan has classified every
   * file (or held a mass-change batch for confirmation).
   */
  private async tryDurableReopen(): Promise<boolean> {
    const ds = this.cfg.docStore
    if (!ds) return false
    if (!(await ds.restore(FOLDER_DOC_KEY, this.folderDoc))) return false
    ds.track(FOLDER_DOC_KEY, this.folderDoc)

    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      const doc = this.engine.createDoc(entry.guid)
      this.docs.set(entry.guid, doc)
      const hadBlob = await ds.restore(entry.guid, doc)
      ds.track(entry.guid, doc)
      if (!hadBlob) {
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) {
          // Blob lost (crash before its first flush): re-seed from the LCA
          // shadow copy — text and hash unchanged, so reconciliation semantics
          // hold; re-record heads for the fresh doc through the guard.
          doc.transact((t) => t.insert(0, lca.baseText), 'seed')
          await this.lcaStore.put({
            ...lca,
            heads: this.engine.encodeHeads(this.engine.heads(doc)),
          })
        } else {
          // Neither blob nor LCA: adopt like a remote entry — content arrives
          // from the provider, or the boot reconcile ingests it from disk.
          await this.lcaStore.put({
            guid: entry.guid,
            path,
            baseText: '',
            contentHash: NEVER_ON_DISK,
            heads: this.engine.encodeHeads(this.engine.heads(doc)),
            eol: 'lf',
            bom: false,
          })
        }
      }
      this.trackDoc(entry.guid, path)
    }

    // Providers connect in the BACKGROUND — never awaited, so a reopen with
    // the relay down is fully usable and catches up on reconnect.
    this.connectFolder()
    this.adoptionEnabled = true
    await this.restartSession()
    await this.bootScan()
    await this.writeMountDesc()
    return true
  }

  /**
   * Membership delta scan + reconcile pass (spike S8 Q3 step 3): files that
   * appeared on disk while closed enroll additively; every known doc runs the
   * reconciler's four-way classification. A batch larger than massChangePaths
   * is HELD (git-branch-switch shape) behind onBreaker.
   */
  private async bootScan(): Promise<void> {
    const knownPaths = new Set<string>()
    const textEntries: [string, FileEntry][] = []
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (!entry.deleted) knownPaths.add(path)
      if (entry.kind === 'text' && !entry.deleted) textEntries.push([path, entry])
    }

    const additions = (await this.adapter.list()).filter((s) => !knownPaths.has(s.path))

    // Pre-pass: which known files changed (or vanished) on disk while closed?
    const changed: string[] = []
    for (const [path, entry] of textEntries) {
      const lca = await this.lcaStore.get(entry.guid)
      if (!lca) continue
      const bytes = await this.adapter.read(path)
      const diskHash = bytes ? hashBytes(bytes) : ''
      if (diskHash !== lca.contentHash) changed.push(path)
    }

    // Directory delta (M3): dir map-adds and mkdirs carry no content risk, so
    // they apply immediately and never count toward the mass-change breaker.
    await this.syncDirs()

    const threshold = this.cfg.thresholds?.massChangePaths ?? DEFAULT_THRESHOLDS.massChangePaths
    const touched = [...additions.map((s) => s.path), ...changed]
    if (touched.length > threshold) {
      this.pendingBootBatch = { additions: additions.map((s) => s.path), changed }
      this.holdBatch('boot', touched)
      // Unchanged docs still reconcile below (doc-ahead-of-LCA is our own
      // durable state, not an external change — safe while the batch is held).
      await this.reconcileKnown(new Set(changed))
      return
    }

    for (const path of additions.map((s) => s.path)) await this.enrollOne(path)
    if (additions.length > 0) await this.restartSession()
    await this.reconcileKnown()
  }

  /**
   * Two-way directory sync (M3): dirs on disk missing from the map enroll as
   * dir entries; dir entries missing on disk materialize as mkdirs.
   */
  private async syncDirs(): Promise<void> {
    try {
      const mapPaths = new Set(
        this.folderDoc.getMap().entries().filter(([, e]) => !e.deleted).map(([p]) => p)
      )
      const onDisk = new Set(await this.adapter.listDirs())
      for (const dir of onDisk) {
        if (!mapPaths.has(dir)) {
          this.folderDoc.transactMap(
            (m) => m.set(dir, { guid: crypto.randomUUID(), kind: 'dir' }),
            'local'
          )
        }
      }
      for (const [path, entry] of this.folderDoc.getMap().entries()) {
        if (entry.kind !== 'dir' || entry.deleted) continue
        if (!onDisk.has(path)) await this.adapter.mkdir(path)
      }
    } catch (err) {
      this.pushError(err)
    }
  }

  /** Reconcile every known text doc except the skipped paths. */
  private async reconcileKnown(skip?: Set<string>): Promise<void> {
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (skip?.has(path)) continue
      await this.reconcileClosedDoc(entry.guid, path)
    }
  }

  /** Held boot batch, if the mass-change breaker tripped during bootScan. */
  private pendingBootBatch: { additions: string[]; changed: string[] } | null = null

  /** Process a held boot batch: enroll additions, reconcile changed files. */
  async confirmBootBatch(): Promise<void> {
    const batch = this.pendingBootBatch
    if (!batch) return
    this.pendingBootBatch = null
    for (const path of batch.additions) await this.enrollOne(path)
    if (batch.additions.length > 0) await this.restartSession()
    for (const path of batch.changed) {
      const guid = this.guidFor(path)
      if (guid) await this.reconcileClosedDoc(guid, path)
    }
    this.refreshFiles()
  }

  /** Drop a held boot batch: nothing is enrolled or reconciled. */
  dismissBootBatch(): void {
    this.pendingBootBatch = null
  }

  /** Enroll one on-disk file that is not in the folder map (boot delta scan). */
  private async enrollOne(path: string): Promise<void> {
    try {
      const bytes = await this.adapter.read(path)
      if (bytes === null) return
      if (looksBinary(path, bytes)) {
        this.folderDoc.transactMap(
          (m) => m.set(path, { guid: crypto.randomUUID(), kind: 'binary' }),
          'local'
        )
        return
      }
      const guid = crypto.randomUUID()
      const decoded = decodeFile(bytes)
      const doc = this.engine.createDoc(guid)
      this.docs.set(guid, doc) // before the map txn so our own observer won't adopt it
      doc.transact((t) => t.insert(0, decoded.text), 'seed')
      this.cfg.docStore?.track(guid, doc)
      await this.lcaStore.put({
        guid,
        path,
        baseText: decoded.text,
        contentHash: hashBytes(bytes),
        heads: this.engine.encodeHeads(this.engine.heads(doc)),
        eol: decoded.eol,
        bom: decoded.bom,
      })
      this.folderDoc.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
      this.trackDoc(guid, path)
    } catch (err) {
      this.pushError(err)
    }
  }

  /**
   * Make a fresh boot durable (enroll and firstJoin paths): track everything,
   * flush blobs, then re-record every LCA through the guard — enrollment and
   * join wrote LCAs before their docs were tracked, so the guard was a no-op
   * there (Invariant D would otherwise have a hole on the very first boot).
   */
  private async persistBaseline(): Promise<void> {
    const ds = this.cfg.docStore
    if (!ds) return
    ds.track(FOLDER_DOC_KEY, this.folderDoc)
    for (const [guid, doc] of this.docs) ds.track(guid, doc)
    await ds.flushAll()
    for (const rec of await this.lcaStore.all()) await this.lcaStore.put(rec)
    await this.writeMountDesc()
  }

  /** Upsert this mount's desc in the vault's mount table (idempotent). */
  private async writeMountDesc(): Promise<void> {
    const provenance: MountProvenance =
      this.cfg.provenance ?? (this.cfg.firstJoin ? 'joined' : 'local')
    await this.cfg.mountsFile?.upsert({
      room: this.room,
      path: this.cfg.mountPath ?? '',
      provenance,
      ...(this.relay ? { relay: { url: this.relay.url } } : {}),
      status: 'active',
    })
  }
}
