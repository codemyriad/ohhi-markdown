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
  DocBlobStat,
  DocStore,
  LcaRecord,
  LcaStore,
  MountProvenance,
  MountsFile,
  MountStatus,
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
  mountRootsFrom,
  NEVER_ON_DISK,
  VaultSession,
  type StoreDir,
} from '@editor/vault'
import type { EngineDoc, FileEntry, SyncEngine } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import {
  connectDoc,
  createRoomSocket,
  ProgressTracker,
  whenSynced,
  type DocConnection,
  type RoomSocket,
} from './providers.js'
import {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type FileRow,
  type MountEntryInfo,
  type MountEvents,
  type PullProgress,
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
  /**
   * This device has never held the room's content and has no credential for
   * it yet (`MountDesc.neverHeld`, spike S10 Q2 + N3's empty-adopt finding).
   * Boot with an EMPTY map and no delta scan: the files under the mount root
   * belong to a room this session cannot see, and enrolling them with fresh
   * guids would LWW-clobber the owner's entries at the next paste.
   *
   * "Keep + mark", read exactly: the bytes stay on disk, untouched and
   * unmanaged, and the tree marks the folder as needing a link. Listing them
   * as managed rows would be the dishonest half — they are not this mount's
   * files until the pull says so.
   */
  neverHeld?: boolean
  thresholds?: Partial<ReconcileThresholds>
  /** Stable reactive record factory, keyed by doc GUID + FOLDER_RECORD_KEY (guids are rename-stable). */
  recordFor: (key: string) => SyncRecordFields
  events?: MountEvents
  /** Builds the copyable share link once the mount is shared. */
  makeShareLink: (relay: RelayConfig, room: string) => string
  /** Non-browser hosts pass their WebSocket impl through to providers. */
  webSocketPolyfill?: unknown
}

/** How a mount namespace is seeded (spike S10 Q1 step 3). */
export interface SeedOptions {
  /**
   * The ANNOUNCED seed: base64 of the announcer's own folder-doc state
   * (`FileEntry.seed`). Applied to a fresh doc, so every device's copy of the
   * room's map is the SAME Yjs history — the fix for `fuzz-crashers/0003`,
   * where N independently-seeded folder docs merged as a union and no hard
   * delete could ever remove another device's copy of a key.
   */
  seed?: string
  /**
   * Explicit membership, for a seeding that is not driven by an announcement.
   * The carver passes nothing (its live map is the authority).
   */
  entries?: readonly (readonly [string, FileEntry])[]
}

/** What `seedCarveStores` wrote, and what the caller's detach needs next. */
export interface SeedResult {
  /**
   * The subtree that moved, as `[workspace-relative path, entry]` — the
   * carver's live map filtered, or the announced seed rebased under the mount
   * root. This is the membership the parent teardown works from.
   */
  members: readonly (readonly [string, FileEntry])[]
  /**
   * The seeded folder doc's full state — what the announcer puts in the map
   * entry so every other device seeds the identical history.
   */
  seed: Uint8Array
  /**
   * Did this device actually contribute the room's CONTENT — a doc blob or an
   * LCA record for at least one text member?
   *
   * False means the namespace is a map with nothing behind it: a device that
   * linked after the carve, or whose app data was wiped. Such a mount must
   * PULL rather than merge, and must never enrol the files sitting under its
   * root, which belong to a room it has not seen (`MountDesc.neverHeld`). A
   * membership with no text in it at all counts as held: there is no history
   * to duplicate, and the seeded map already covers the files.
   */
  held: boolean
}

/** What a PEER's detach needs beyond the carver's (spike S10 Q1 step 5). */
export interface DetachOptions {
  /**
   * Explicit membership. The peer's live map is already empty under the
   * prefix (the carve's deletions and its mount entry arrived in one
   * transaction), so it passes `M(P)`; the carver passes nothing.
   */
  entries?: readonly (readonly [string, FileEntry])[]
  /** False on a peer: the carver already announced, and re-announcing costs
   * every peer a redundant map op for zero information. Residual keys still
   * present in the live map are hard-deleted either way. */
  writeMap?: boolean
  /**
   * The mount namespace the subtree is moving into. Each doc's CURRENT state
   * is re-flushed there before the doc is destroyed, closing the window
   * between the seed and this step (S10 Q5 row 2).
   */
  targetDir?: StoreDir
}

/** Read-only per-file inspection snapshot (devtools, M6). */
export interface DocInspection {
  path: string
  guid: string
  /** ui.records key for the live record (guid — rename-stable). */
  recordKey: string
  lca: {
    contentHash: string
    headsDigest: string
    eol: string
    bom: boolean
    baseTextLength: number
  } | null
  doc: {
    headsDigest: string
    textLength: number
    /** null when no LCA exists yet. */
    equalsLca: boolean | null
  } | null
  blob: DocBlobStat | null
  journal: { count: number; recent: { at: number; bytes: number }[] }
  providerAttached: boolean
}

/** Read-only per-mount counts + identity (devtools footer, M6). */
export interface MountStats {
  room: string
  mountPath: string
  provenance: MountProvenance
  shared: boolean
  entryCount: number
  docCount: number
  lcaCount: number
  journalCount: number
}

/** Short stable digest of encoded heads for eyeball comparison. */
function shortDigest(bytes: Uint8Array): string {
  return hashBytes(bytes).slice(0, 12)
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
  /**
   * ONE multiplexed relay connection for every doc of this mount (spike S10
   * Q4 §"Connection model"): a socket per doc put a 1,029-note vault on 1,030
   * of them, over the browser's global cap. Built lazily — the first
   * `connectDoc` after a relay exists — and rebuilt when `enableSharing`
   * repoints the mount at a different relay or token.
   */
  private roomSocket: RoomSocket | null = null
  /** The first join's pull group: shared counts + one no-progress watchdog. */
  private pull: ProgressTracker | null = null
  /** Docs the map says this room holds — the denominator for BOTH phases. */
  private pullTotal = 0
  /** Files materialized so far; non-null phase means the write phase is live. */
  private pullWritten = 0
  private pullPhase: PullProgress['phase'] | null = null

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

    this.folderDoc.getMap().observe((origin) => {
      if (this.stopped) return // torn down; nothing here is ours any more
      this.guidPaths = null // any map change can move a guid's path
      // Only a FOREIGN map change can tell us about someone else's carve or
      // unshare; our own carve wrote the entry itself (N1, shaping A2/A3).
      // A local change still refreshes the remembered set, so the next foreign
      // change reports what changed REMOTELY rather than replaying our own.
      const foreign = isForeignOrigin(origin)
      const entries = this.mountEntries()
      const sig = JSON.stringify(entries)
      // A foreign change that lands a key UNDER a mount root is a ghost — a
      // peer that had not adopted yet renaming, importing or deleting inside
      // a subtree whose authority has moved. It changes no mount entry, so
      // the set signature alone would never report it, and the ghost rule
      // would only ever run at adopt time (spike S10 Q5).
      const changed = sig !== this.lastMountEntries || (foreign && this.hasGhosts(entries))
      // SYNCHRONOUS, before any await: the host's derived ignore set must
      // hide a freshly-announced mount root from this instruction on (S10 Q6),
      // and the adopt's membership needs the pre-image of the subtree the
      // carve transaction just deleted — by the time it runs, the snapshot
      // has moved on (S10 Q1 "Membership").
      this.events.onMapChanged?.()
      if (foreign && changed) this.captureMountPreImages(entries)
      this.refreshMapSnapshot()
      this.lastMountEntries = sig
      if (foreign && changed) {
        // Rows first (a host that renders from rows has the mount row before
        // it hears about the mount), then the adopt work — queued AHEAD of
        // scanMap on the same chain so an adopt can never interleave with
        // scanMap adopting the very guids it is about to move (S10 Q1).
        this.refreshFiles()
        this.queueMountEntries(entries)
      }
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

  /**
   * Create a note in `dir` ('' = root); returns its path, or null on failure.
   *
   * With no `name`, the note is auto-named `untitled-N.md` (the tree's "+
   * file" affordance renames afterwards). With a `name`, the note is created
   * AT that path in one operation — which is what wikilink create-on-click and
   * daily notes need: going via createFile + renamePath would double the
   * journal writes, the map transactions and the session restarts.
   *
   * An existing path is returned as-is rather than clobbered or suffixed:
   * "create the note this link points at" must be idempotent.
   */
  async createFile(dir = '', name?: string, text = ''): Promise<string | null> {
    try {
      const base = dir ? `${dir}/` : ''
      const taken = new Set(this.folderDoc.getMap().entries().map(([p]) => p))
      let path: string
      if (name) {
        const clean = name.replace(/^\/+/, '')
        if (clean.split('/').includes('..')) throw new Error(`invalid note name '${name}'`)
        // Notes are markdown. A name carrying some other extension is an
        // attachment reference (`![[diagram.png]]`), and appending `.md` to it
        // would create `diagram.png.md` — a file nobody wants and nothing links to.
        const ext = /\.[A-Za-z0-9]{1,8}$/.exec(clean)?.[0]
        if (ext && ext.toLowerCase() !== '.md') {
          throw new Error(`'${clean}' is not a note — only .md files are created here`)
        }
        path = `${base}${clean.endsWith('.md') ? clean : `${clean}.md`}`
        const existing = this.folderDoc.getMap().get(path)
        if (existing && !existing.deleted) return path
      } else {
        let n = 1
        while (taken.has(`${base}untitled-${n}.md`)) n++
        path = `${base}untitled-${n}.md`
      }
      // A map miss is NOT evidence the path is free: VaultSession's watcher
      // deliberately ignores out-of-map disk files for the whole session, so
      // a note Obsidian/git/Claude Code wrote while we were running is
      // invisible to the check above. NEVER overwrite bytes Editor did not
      // write (golden rule 1) — adopt them instead, which is also what "open
      // the note this link points at" should do.
      const onDisk = await this.adapter.read(path)
      if (onDisk !== null && looksBinary(path, onDisk)) {
        throw new Error(`'${path}' already exists and is not a text file`)
      }
      const decoded = onDisk !== null ? decodeFile(onDisk) : null
      const seedText = decoded ? decoded.text : text
      const bytes = onDisk ?? new TextEncoder().encode(text)
      if (onDisk === null) {
        // Journal before every Editor-initiated write, exactly as importFile
        // does — a pre-image of null still records that we created the path.
        await this.journal.record(path, null)
        await this.adapter.writeAtomic(path, bytes)
      }
      const guid = crypto.randomUUID()
      const doc = this.engine.createDoc(guid)
      this.docs.set(guid, doc) // before the map txn so our own observer won't adopt it
      this.cfg.docStore?.track(guid, doc)
      if (seedText) doc.transact((t) => t.insert(0, seedText), 'seed')
      await this.lcaStore.put({
        guid,
        path,
        baseText: seedText,
        contentHash: hashBytes(bytes),
        heads: this.engine.encodeHeads(this.engine.heads(doc)),
        eol: decoded ? decoded.eol : 'lf',
        bom: decoded ? decoded.bom : false,
      })
      this.folderDoc.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
      this.trackDoc(guid, path)
      // A nested name (`[[Projects/2026/Roadmap]]`) implies directories that
      // must become map entries too, or the tree can render them but rename
      // and delete cannot find them (M3: the map is the full tree authority).
      if (path.includes('/')) await this.syncDirs()
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

  /** Resolve a 'vanished' review: restore from CRDT, or confirm the removal. */
  async resolveVanished(guid: string, action: 'restore' | 'remove'): Promise<void> {
    if (!this.sessionRef) return
    try {
      await this.sessionRef.resolveVanished(guid, action)
      if (action === 'restore') {
        const path = this.pathForGuid(guid)
        if (path) await this.refreshDiskMatch(path, guid)
      }
      this.refreshFiles()
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
   *
   * `entries` (N1, S10 Q1) is EXPLICIT membership. The carver passes nothing
   * and gets the historical behaviour (the live map is the authority); a peer
   * adopting someone else's carve must pass `M(P)`, because the carve's
   * deletions and its mount entry arrive in ONE transaction — by the time the
   * peer's adopt runs, the live map holds nothing under `prefix` at all.
   */
  async seedCarveStores(
    prefix: string,
    targetDir: StoreDir,
    opts?: SeedOptions
  ): Promise<SeedResult> {
    const pre = `${prefix}/`
    // Temp doc under a throwaway name — never `${room}/folder`, which the new
    // mount's own MountSession will create as its instance later.
    const tmp = this.engine.createDoc(`carve-tmp:${crypto.randomUUID()}`)
    const store = new BlobDocStore(this.engine, targetDir, this.clock)
    try {
      /** `[relative key in the mount, workspace path, entry]`. */
      const seeded: [string, string, FileEntry][] = []
      if (opts?.seed !== undefined) {
        // ONE history on every device: apply the announcer's own folder state
        // instead of re-`set`ting the entries ourselves. Two independently
        // seeded folder docs merge as a UNION, so a hard delete on one side —
        // which is how a rename removes its source and how the ghost rule
        // removes a key — has nothing to delete on the other, and the two
        // maps diverge permanently (`fuzz-crashers/0003`).
        this.engine.applyUpdate(tmp, decodeSeed(opts.seed), 'seed')
        for (const [rel, entry] of tmp.getMap().entries()) {
          if (entry.deleted || entry.kind === 'mount') continue
          seeded.push([rel, `${prefix}/${rel}`, entry])
        }
      } else {
        const subtree = (opts?.entries ?? this.folderDoc.getMap().entries()).filter(
          ([p, e]) => !e.deleted && e.kind !== 'mount' && (p === prefix || p.startsWith(pre))
        )
        tmp.transactMap((m) => {
          for (const [path, entry] of subtree) {
            if (path === prefix) continue // the carved dir itself becomes the new vault root
            m.set(path.slice(pre.length), entry)
          }
        }, 'seed')
        for (const [path, entry] of subtree) {
          if (path === prefix) continue
          seeded.push([path.slice(pre.length), path, entry])
        }
      }
      store.track(FOLDER_DOC_KEY, tmp)
      await store.flush(FOLDER_DOC_KEY)

      const lcas = new JsonFileLcaStore(targetDir.io('lca.json'))
      let texts = 0
      let copied = 0
      for (const [rel, , entry] of seeded) {
        if (entry.kind !== 'text') continue
        texts++
        // Blob BEFORE the LCA (Invariant D): a crash between them must leave a
        // doc at least as new as its baseline, never the reverse.
        const doc = this.docs.get(entry.guid)
        if (doc) {
          store.track(entry.guid, doc)
          await store.flush(entry.guid)
          copied++
        }
        const lca = await this.lcaStore.get(entry.guid)
        if (lca) {
          await lcas.put({ ...lca, path: rel })
          if (!doc) copied++
        }
      }
      return {
        members: seeded.map(([, full, entry]) => [full, entry] as const),
        seed: this.engine.encodeUpdateSince(tmp, null),
        held: copied > 0 || (seeded.length > 0 && texts === 0),
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
   *
   * `mount` (N1, device-link-shaping A2) makes the SAME transaction announce
   * where the subtree went: a `kind:'mount'` entry replaces the dir entry at
   * `prefix`, carrying the SEED — the new room's folder state, so every peer
   * builds the identical history rather than its own (S10 Q1, crasher 0003). One transaction, one observer, one ordering — every peer of this
   * room learns about the nested share atomically with the deletion, instead
   * of seeing keys vanish and re-enrolling the files with fresh guids. Pass it
   * whenever this mount is relay-attached; a private vault needs no
   * announcement (and gets exactly the pre-N1 behaviour without one).
   *
   * `opts` serves the PEER's mirror of the same step (S10 Q1 step 5):
   * `entries` because the peer's live map is already empty under `prefix`,
   * `writeMap:false` because the carver already announced (on a peer the map
   * is the owner's; only the stores are ours), and `targetDir` for the
   * re-flush below.
   */
  async detachSubtree(
    prefix: string,
    mount?: { room: string; relay?: string; seed?: Uint8Array },
    opts?: DetachOptions
  ): Promise<void> {
    const pre = `${prefix}/`
    const writeMap = opts?.writeMap ?? true
    /** Keys still in the live map — what the transaction removes. */
    const live = this.folderDoc
      .getMap()
      .entries()
      .filter(([p]) => p === prefix || p.startsWith(pre))
    /** Membership — what is re-flushed into the target namespace. */
    const members = (opts?.entries ?? live).filter(([p]) => p === prefix || p.startsWith(pre))
    /**
     * What gets torn down per doc: the membership PLUS anything else this
     * session still holds under the prefix. The two differ on a peer — a file
     * this device enrolled under `P/` while the carver was elsewhere is in our
     * map and not in their seed. Its key goes with the transaction below
     * either way, so leaving its doc, provider, LCA and blob behind would
     * strand them in a namespace whose map no longer mentions it (M5); the
     * mount's own delta scan picks the file up from disk with a fresh guid,
     * which is the ghost rule's import branch by another route.
     */
    const doomedGuids = new Set<string>()
    for (const [, entry] of [...members, ...live]) {
      if (entry.kind === 'text') doomedGuids.add(entry.guid)
    }

    // Close the seed→detach window (S10 Q1 step 5, Q5 row 2). Between the seed
    // and here this session is still live and, in a shared parent, still
    // connected: a remote update or an editor keystroke landing in that window
    // was copied nowhere — the seed's blob copy already happened, and this
    // session's own blob is about to be deleted. Re-flushing each guid's
    // CURRENT state into the target namespace is the whole fix, and it applies
    // to the carver exactly as much as to the peer (carveFolder pauses
    // nothing — spike S8 Q1's "paused parent session" was never true).
    if (opts?.targetDir) await this.reflushInto(opts.targetDir, prefix, members)

    // A peer must not delete the mount entry at the root: that key is the
    // OWNER's announcement, and this session is only tidying the residue the
    // carve transaction did not reach. Deleting it would erase the boundary
    // every device (this one included, at its next boot) reads the mount from.
    const doomedKeys = live.filter(([p, e]) => p !== prefix || writeMap || e.kind !== 'mount')

    if (writeMap || doomedKeys.length > 0) {
      this.folderDoc.transactMap((m) => {
        for (const [path] of doomedKeys) m.delete(path)
        if (writeMap && mount) {
          // Replaces the dir entry at `prefix`, deleted just above. The guid IS
          // the room; the relay URL is not a secret, the token never travels.
          m.set(prefix, mountEntry(mount.room, mount.relay, mount.seed))
        }
      }, 'local')
    }

    await this.detachDocs([...doomedGuids])

    // Shorten the rollforward window: the map deletion is durable now, not at
    // the next debounce tick (crash between txn and flush is still covered by
    // recoverMounts' store surgery).
    await this.cfg.docStore?.flush(FOLDER_DOC_KEY)
    await this.restartSession()
    this.refreshFiles()
  }

  /**
   * Per-doc teardown: this session stops owning these guids. Providers,
   * debounces, blob, LCA record and the doc instance all go — the whole of
   * what "the subtree's authority moved" means in the stores.
   *
   * Public because the GHOST SWEEP needs exactly this (S10 Q5): a ghost key
   * hard-deleted from the parent map leaves the parent's live doc, provider,
   * LCA record and blob behind for a guid the mount now owns, which is one
   * guid with durable state in two namespaces — invisible to a map-only
   * invariant, and a doc the parent's next boot would resurrect.
   */
  async detachDocs(guids: readonly string[], restart = false): Promise<void> {
    if (guids.length === 0) return
    for (const guid of guids) {
      this.debounces.get(guid)?.()
      this.debounces.delete(guid)
      this.conns.get(guid)?.destroy()
      this.conns.delete(guid)
      this.tracked.delete(guid)
      this.cfg.docStore?.untrack(guid)
      // Blob BEFORE the LCA (Invariant D): the residue of a crash between the
      // two must never be a baseline with no doc behind it.
      await this.cfg.docStore?.remove(guid)
      await this.lcaStore.remove(guid)
      const doc = this.docs.get(guid)
      this.docs.delete(guid)
      doc?.destroy()
    }
    // VaultSession learns its per-path bookkeeping only in start(), and it
    // shares this `docs` map by reference — a caller that is not about to
    // restart anyway must ask for one here.
    if (restart) await this.restartSession()
  }

  /**
   * Re-flush the CURRENT state of every membership doc into the target mount
   * namespace: doc blob first (the content), then the LCA record with its
   * rebased path (the disk baseline the reconciler compares against). Both are
   * the same two writes `seedCarveStores` makes, so re-running is idempotent
   * and the target ends up holding this device's latest state, not the state
   * as of the seed.
   */
  private async reflushInto(
    targetDir: StoreDir,
    prefix: string,
    members: readonly (readonly [string, FileEntry])[]
  ): Promise<void> {
    const pre = `${prefix}/`
    const store = new BlobDocStore(this.engine, targetDir, this.clock)
    try {
      const lcas = new JsonFileLcaStore(targetDir.io('lca.json'))
      for (const [path, entry] of members) {
        if (entry.kind !== 'text' || entry.deleted) continue
        const doc = this.docs.get(entry.guid)
        if (doc) {
          store.track(entry.guid, doc)
          await store.flush(entry.guid)
        }
        const lca = await this.lcaStore.get(entry.guid)
        // `path === prefix` is the mount root's OWN key: subtree-relative that
        // is '', which is what seedCarveStores writes. Keeping the full path
        // here wrote a second, differently-keyed record for the same guid.
        if (lca) await lcas.put({ ...lca, path: path === prefix ? '' : path.slice(pre.length) })
      }
    } finally {
      store.dispose()
    }
  }

  // ---- cross-mount move primitives (spike S8 Q5, slice M5) ----

  /** Raw bytes of a file in this mount (cross-move source read). */
  readFileBytes(rel: string): Promise<Uint8Array | null> {
    return this.adapter.read(rel)
  }

  /**
   * Import a file at an explicit path (cross-move target): journaled write,
   * then enrollment with a FRESH guid — content identity never crosses rooms
   * (spike Q5). Dir entries for new parents sync immediately.
   */
  async importFile(rel: string, bytes: Uint8Array): Promise<void> {
    const existing = this.folderDoc.getMap().get(rel)
    if (existing && !existing.deleted) {
      // Overwriting would orphan the existing entry's guid — a silent loss.
      throw new Error(`'${rel}' already exists in the destination`)
    }
    const pre = await this.adapter.read(rel)
    await this.journal.record(rel, pre)
    await this.adapter.writeAtomic(rel, bytes)
    await this.enrollOne(rel)
    await this.syncDirs()
    await this.restartSession()
    this.refreshFiles()
  }

  /** Re-run the boot delta scan (unmount: newly-local files enroll now). */
  async rescan(): Promise<void> {
    await this.bootScan()
    this.refreshFiles()
  }

  // ---- read-only inspection (devtools, M6) — never mutates ----

  /** Full disk↔CRDT picture for one text file; null for unknown/binary/dir. */
  async inspectPath(path: string): Promise<DocInspection | null> {
    const guid = this.guidFor(path)
    if (!guid) return null
    const doc = this.docs.get(guid) ?? null
    const lca = await this.lcaStore.get(guid)
    const lcaHeads = lca ? this.engine.decodeHeads(lca.heads) : null
    const docHeads = doc ? this.engine.heads(doc) : null
    const entries = await this.journal.entries(path)
    return {
      path,
      guid,
      recordKey: guid,
      lca: lca
        ? {
            contentHash: lca.contentHash === NEVER_ON_DISK ? '(never on disk)' : lca.contentHash,
            headsDigest: shortDigest(lca.heads),
            eol: lca.eol,
            bom: lca.bom,
            baseTextLength: lca.baseText.length,
          }
        : null,
      doc:
        doc && docHeads
          ? {
              headsDigest: shortDigest(this.engine.encodeHeads(docHeads)),
              textLength: doc.getText().length,
              equalsLca: lcaHeads ? this.engine.headsEqual(docHeads, lcaHeads) : null,
            }
          : null,
      blob: this.cfg.docStore ? await this.cfg.docStore.stat(guid) : null,
      journal: {
        count: entries.length,
        recent: entries
          .slice(-10)
          .reverse()
          .map((e) => ({ at: e.at, bytes: e.bytes.length })),
      },
      providerAttached: this.conns.has(guid),
    }
  }

  /** Per-mount counts + identity for the devtools footer. */
  async mountStats(): Promise<MountStats> {
    const entries = this.folderDoc.getMap().entries()
    return {
      room: this.room,
      mountPath: this.cfg.mountPath ?? '',
      provenance: this.cfg.provenance ?? (this.cfg.firstJoin ? 'joined' : 'local'),
      shared: this.isShared(),
      entryCount: entries.filter(([, e]) => !e.deleted).length,
      docCount: this.docs.size,
      lcaCount: (await this.lcaStore.all()).length,
      journalCount: (await this.journal.entries()).length,
    }
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
    if (this.shutdownDone) return
    this.stopped = true
    for (const cancel of this.debounces.values()) cancel()
    this.debounces.clear()
    this.sessionRef?.dispose()
    for (const conn of this.conns.values()) conn.destroy()
    this.conns.clear()
    this.folderConn?.destroy()
    this.folderConn = null
    // The shared socket closes LAST: each doc detaches from it first, so the
    // relay unloads the documents one by one instead of seeing the connection
    // vanish under them.
    this.roomSocket?.destroy()
    this.roomSocket = null
    // Best-effort tail flush: the debounced blob writes run continuously
    // during the session, so this only catches the last debounce window (a
    // page close can't await it either way — bounded loss, spike S8 Q2).
    const ds = this.cfg.docStore
    if (ds) void ds.flushAll().finally(() => ds.dispose())
  }

  private shutdownDone = false
  /**
   * Set the INSTANT teardown begins, and the guard on every queued map-work
   * entry point.
   *
   * `shutdown()` is called from the middle of a map-work chain — the peer's
   * absorb runs inside `onMountEntries`, and `queueMapScan` has already been
   * queued BEHIND it by the same observer callback. Without this, that scan
   * ran on the shut-down session: `docs` had just been cleared, so `adoptEntry`
   * re-created a doc for every entry in the map, wrote a NEVER_ON_DISK LCA
   * over the record the absorb had just copied in, and attached a relay
   * provider to a doc instance nobody would ever read again — while the
   * rebuilt session's instance for the same guid was left off the room.
   *
   * That is `fuzz-crashers/0008`: after an unshare round trip, every later
   * edit was one-sided, with no partition, no crash and no review.
   */
  private stopped = false

  /**
   * Orderly, awaitable teardown (unshare/unmount, spike S8 Q6): flush blobs
   * durably, stop the session and providers, then DESTROY the doc instances —
   * the caller is about to rebuild sessions over the same guids from stores,
   * and stale instances must not linger (their engine.onUpdate routing has no
   * unsubscribe by design; dead instances receive nothing).
   */
  async shutdown(): Promise<void> {
    if (this.shutdownDone) return
    this.stopped = true
    for (const cancel of this.debounces.values()) cancel()
    this.debounces.clear()
    this.sessionRef?.dispose()
    this.sessionRef = null
    for (const conn of this.conns.values()) conn.destroy()
    this.conns.clear()
    this.folderConn?.destroy()
    this.folderConn = null
    this.roomSocket?.destroy() // after the per-doc detaches, never before
    this.roomSocket = null
    const ds = this.cfg.docStore
    if (ds) {
      await ds.flushAll()
      ds.dispose()
    }
    this.shutdownDone = true
    for (const doc of this.docs.values()) doc.destroy()
    this.docs.clear()
    this.folderDoc.destroy()
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

  /**
   * guid → path, rebuilt lazily and invalidated by the map observer.
   *
   * This used to be a linear scan of the whole folder map, and it runs on
   * EVERY doc update — i.e. once per keystroke, per open doc. At vault scale
   * that is a 1k+ entry walk per character typed, and V2's index adds another
   * per-update consumer on top of it.
   */
  private guidPaths: Map<string, string> | null = null

  private pathForGuid(guid: string): string | null {
    if (!this.guidPaths) {
      const map = new Map<string, string>()
      for (const [path, entry] of this.folderDoc.getMap().entries()) {
        if (!entry.deleted) map.set(entry.guid, path)
      }
      this.guidPaths = map
    }
    return this.guidPaths.get(guid) ?? null
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

  // ---- mount entries (N1, device-link-shaping A2) ----

  /** Mount roots declared in this map — the opaque boundaries (N1). */
  private mountRoots(): ReadonlySet<string> {
    return mountRootsFrom([], this.folderDoc.getMap().entries())
  }

  /** Is `path` at or under a mount boundary in this map? */
  private underMount(path: string, roots = this.mountRoots()): boolean {
    for (const root of roots) {
      if (path === root || path.startsWith(`${root}/`)) return true
    }
    return false
  }

  /** The current `kind:'mount'` entries, sorted by path. */
  mountEntries(): MountEntryInfo[] {
    return this.folderDoc
      .getMap()
      .entries()
      .filter(([, e]) => e.kind === 'mount' && !e.deleted)
      .map(
        ([path, e]): MountEntryInfo => ({
          path,
          room: e.guid,
          ...(e.relay ? { relay: e.relay } : {}),
          ...(e.seed ? { seed: e.seed } : {}),
        })
      )
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Signature of the last emitted set; null until the boot emission. */
  private lastMountEntries: string | null = null

  /** Is any key in this map at or under a mount root that is not its own? */
  private hasGhosts(entries: readonly MountEntryInfo[]): boolean {
    if (entries.length === 0) return false
    for (const [path] of this.folderDoc.getMap().entries()) {
      for (const entry of entries) {
        if (path !== entry.path && path.startsWith(`${entry.path}/`)) return true
      }
    }
    return false
  }

  /**
   * The map as it was BEFORE the change now being observed — the mirror of
   * `VaultSession.lastEntries` (session.ts). Maintained only when a host is
   * listening for mount entries: it is the adopt machine's membership source
   * and nothing else needs it (S10 Q1 "Membership").
   */
  private mapSnapshot = new Map<string, FileEntry>()

  /**
   * Pre-image of each newly-announced mount root's subtree, captured
   * synchronously in the observer and consumed by the adopt. `[]` is
   * meaningful: this device never held the subtree, so the mount must PULL
   * (the `firstJoin` rule, S10 Q1 step 6).
   */
  private mountPreImages = new Map<string, [string, FileEntry][]>()

  private get tracksMountEntries(): boolean {
    return this.events.onMountEntries !== undefined
  }

  private refreshMapSnapshot(): void {
    if (!this.tracksMountEntries) return
    this.mapSnapshot = new Map(this.folderDoc.getMap().entries())
  }

  /**
   * For every mount root that was NOT a mount root a moment ago, remember the
   * entries the previous snapshot held at or under it. The carve's deletions
   * and the mount entry arrive in ONE transaction, so the live map is already
   * empty there and no observer can see the pre-image (S10 Q1).
   */
  private captureMountPreImages(entries: readonly MountEntryInfo[]): void {
    if (!this.tracksMountEntries) return
    for (const entry of entries) {
      if (this.mountPreImages.has(entry.path)) continue
      const was = this.mapSnapshot.get(entry.path)
      if (was && was.kind === 'mount' && !was.deleted) continue // not new
      const pre = `${entry.path}/`
      // TOMBSTONES ARE KEPT. They are not membership — `seedCarveStores` drops
      // them — but they are the only record that a note under `P` was deleted:
      // an LCA record outlives a delete, and the adopt's orphan-LCA fallback
      // would otherwise resurrect every such note into the new mount (S10 Q1
      // "Membership"; see `membershipFor`).
      this.mountPreImages.set(
        entry.path,
        [...this.mapSnapshot.entries()].filter(
          ([p, e]) => e.kind !== 'mount' && (p === entry.path || p.startsWith(pre))
        )
      )
    }
  }

  /**
   * The pre-image captured for a mount root, or null when this device never
   * saw the subtree in its map (a boot-time adopt, where the orphan-LCA term
   * is the whole membership).
   */
  mountPreImage(path: string): readonly (readonly [string, FileEntry])[] | null {
    return this.mountPreImages.get(path) ?? null
  }

  /** Forget a consumed pre-image (the adopt settled, or was cancelled). */
  clearMountPreImage(path: string): void {
    this.mountPreImages.delete(path)
  }

  /**
   * This mount's folder-map entries, workspace-agnostic (paths are
   * mount-relative). Non-deleted by default; the ghost sweep asks for
   * tombstones too, because a tombstone under a mount root is itself a ghost.
   */
  mapEntries(includeDeleted = false): (readonly [string, FileEntry])[] {
    return this.folderDoc
      .getMap()
      .entries()
      .filter(([, e]) => includeDeleted || !e.deleted)
  }

  /**
   * This mount's folder doc as one update — the SEED an announcement carries
   * so every other device's copy of this room's map is the same history
   * (S10 Q1). A join announces it after the pull, because only then does this
   * device hold the room's real state.
   */
  folderState(): Uint8Array {
    return this.engine.encodeUpdateSince(this.folderDoc, null)
  }

  /** Path of a guid in this map, or null (rename-stable identity lookup). */
  pathOfGuid(guid: string): string | null {
    return this.pathForGuid(guid)
  }

  /** Every LCA record in this mount's namespace (adopt membership, read-only). */
  lcaRecords(): Promise<LcaRecord[]> {
    return this.lcaStore.all()
  }

  /**
   * Queue the mount-entry announcement on the SAME serialized chain as
   * scanMap, ahead of it. The host's handler may be async (it is the adopt
   * machine): the chain awaits it, so no map scan runs while a mount is
   * being adopted or absorbed.
   */
  private queueMountEntries(entries: MountEntryInfo[]): void {
    const hook = this.events.onMountEntries
    if (!hook || this.stopped) return
    this.mapWork = this.mapWork.then(() => hook(entries)).catch((err) => this.pushError(err))
  }

  /**
   * Announce the current mount-entry set to the host (the adopt machine's
   * hook). `force` emits even when unchanged — the boot emission, which gives
   * a device that was offline during a peer's carve its trigger on reopen.
   */
  private emitMountEntries(force = false): void {
    const entries = this.mountEntries()
    const sig = JSON.stringify(entries)
    if (!force && sig === this.lastMountEntries) return
    this.lastMountEntries = sig
    this.queueMountEntries(entries)
  }

  /**
   * Hard-delete parent-map keys — the ghost-entry rule's write side (S10 Q5).
   * NEVER a tombstone: a tombstone under a mount root reaches a peer that has
   * not yet adopted and makes its session remove the file from disk
   * (session.ts's remote-deletion branch), which is real data loss. A hard
   * delete is invisible to that peer, which then repairs from its own stores.
   * Safe ONLY under a mount root, where the subtree's authority has moved.
   */
  async hardDeletePaths(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return
    this.folderDoc.transactMap((m) => {
      for (const path of paths) m.delete(path)
    }, 'local')
    await this.cfg.docStore?.flush(FOLDER_DOC_KEY)
    this.refreshFiles()
  }

  /**
   * Re-state a mount entry in this map (the decision table's REPAIR row): a
   * concurrent rename or delete raced the announcement and the key at the
   * mount root is gone, while mounts.json still says a mount lives there.
   * mounts.json is the authority on WHETHER a mount exists; the map is the
   * authority on WHERE it is — so the missing half is restated, not inferred
   * away as an unshare.
   */
  async setMountEntry(
    path: string,
    room: string,
    relay?: string,
    seed?: Uint8Array
  ): Promise<void> {
    this.folderDoc.transactMap((m) => {
      m.set(path, mountEntry(room, relay, seed))
    }, 'local')
    await this.cfg.docStore?.flush(FOLDER_DOC_KEY)
    this.refreshFiles()
  }

  /**
   * Cross-boundary move-out (S10 Q5): a parent entry outside the mount root
   * carries a guid the mount owns, because a peer moved the file out. Re-enrol
   * it here with a FRESH guid — content identity never crosses rooms — which
   * replaces the stale key in one transaction.
   *
   * Only meaningful on the device that MADE the move, which is the only one
   * whose disk already holds the destination: `enrollOne` returns silently on
   * a null read, so on a peer this is deliberately a no-op and the mount's
   * guid stays in the parent map (see the skipped
   * `fuzz-crashers/0001-move-out-on-a-peer.spec.ts`).
   */
  async reenrollPath(path: string): Promise<void> {
    await this.enrollOne(path)
    await this.restartSession()
    this.refreshFiles()
  }

  /**
   * Ghost-rule delete replay (S10 Q5 row 9): tombstone these mount-relative
   * paths inside the mount, held behind the existing mass-change breaker when
   * the batch is large — "team/ was deleted on another device" must be a
   * confirmation, not a silent mass delete.
   */
  async replayDeletes(rels: readonly string[]): Promise<void> {
    if (rels.length === 0) return
    const apply = async (): Promise<void> => {
      for (const rel of rels) {
        const entry = this.folderDoc.getMap().get(rel)
        if (!entry || entry.deleted) continue
        await this.deletePath(rel)
      }
    }
    const threshold = this.cfg.thresholds?.massChangePaths ?? DEFAULT_THRESHOLDS.massChangePaths
    if (rels.length > threshold) this.holdBatch('ghost', [...rels], apply)
    else await apply()
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
    const path = this.pathForGuid(guid)
    if (!path) return
    // BEFORE the origin filter: a content-change listener (the index) must see
    // 'disk' ingests — Obsidian, git and Claude Code writing the same files —
    // and 'seed' restores, or it silently drifts from the vault.
    this.emitDocChanged(guid, path, origin)
    if (origin === 'seed' || origin === 'disk') return
    this.recordFor(guid).diskMatchesCrdt = false
    if (this.openPath === path) {
      this.debounceDoc(guid, FLUSH_DEBOUNCE_MS, () => void this.flushOpenDoc(guid, path))
    } else {
      this.debounceDoc(guid, CLOSED_RECONCILE_MS, () => void this.reconcileClosedDoc(guid, path))
    }
  }

  /**
   * Notify the host that a doc's content changed. Never lets a listener's
   * failure reach the sync path — an index is a derived convenience and must
   * not be able to break reconciliation.
   */
  private emitDocChanged(guid: string, path: string, origin: unknown): void {
    if (!this.events.onDocChanged) return
    try {
      this.events.onDocChanged(guid, path, origin)
    } catch (err) {
      this.pushError(err)
    }
  }

  /**
   * Report first-join progress. Derived convenience: a listener that throws
   * must not be able to break the pull (same rule as emitDocChanged).
   */
  private emitPull(phase: PullProgress['phase'], done: number, total: number): void {
    if (!this.events.onPullProgress) return
    try {
      this.events.onPullProgress({ phase, done, total })
    } catch (err) {
      this.pushError(err)
    }
  }

  /**
   * One file written to disk during the first join's materialize. The
   * reconciler already emits exactly one `materialized` action per file, so
   * this is a count, not an estimate.
   */
  private notePullWrite(): void {
    if (this.pullPhase !== 'write') return
    this.pullWritten++
    this.emitPull('write', this.pullWritten, this.pullTotal)
  }

  /**
   * This mount's shared relay connection, opened on first use. Every doc of
   * the room rides it (Hocuspocus routes by document name and still runs
   * `onAuthenticate` per document), so a mount costs ONE socket, not one per
   * note — the browser's global WebSocket cap is ~200-255 (S10 Q4).
   */
  private ensureSocket(): RoomSocket | undefined {
    if (!this.relay) return undefined
    const { url, token } = this.relay
    if (this.roomSocket && (this.roomSocket.relay !== url || this.roomSocket.token !== token)) {
      // Repointed by enableSharing: the old socket carries the old credential
      // and no live doc (attachProvider only ever adds to the current one).
      this.roomSocket.destroy()
      this.roomSocket = null
    }
    this.roomSocket ??= createRoomSocket(url, token, {
      ...(this.cfg.webSocketPolyfill ? { webSocketPolyfill: this.cfg.webSocketPolyfill } : {}),
    })
    return this.roomSocket
  }

  /** Connect a relay provider for one doc. No-op without a relay. */
  private attachProvider(guid: string, path: string): void {
    if (!this.relay || this.conns.has(guid)) return
    const doc = this.docs.get(guid)
    if (!doc) return
    const socket = this.ensureSocket()
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
        ...(socket ? { socket } : {}),
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
    if (this.stopped) return
    const adopted: { guid: string; path: string }[] = []
    // A key at or under a mount boundary belongs to another session on this
    // device (N1). `ignoringAdapter` filters list/listDirs/watch only, so the
    // MAP side needs the guard of its own that `reconcileKnown` already has:
    // adopting a ghost here would give the root a doc, an LCA and a provider
    // for a guid the mount owns, in the wrong room.
    const mountRoots = this.mountRoots()
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (this.underMount(path, mountRoots)) continue
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
    if (this.stopped) return this.mapWork
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
          // An EMPTY doc's file vanishing is a deletion with nothing at
          // stake — accept it silently instead of nagging (M5).
          if (review.reason === 'vanished' && review.mine === '') {
            void this.sessionRef
              ?.resolveVanished(review.guid, 'remove')
              .catch((err) => this.pushError(err))
            return
          }
          // Identical-sides fast path (Invariant D's k=1 crash artifact — a
          // lost LCA write behind a durable blob classifies as diverged with
          // mine === theirs): resolving with either side is safe by
          // construction, so never surface it as a review. Never applies to
          // 'vanished' (theirs is '' there by construction, handled above).
          if (review.reason !== 'vanished' && review.mine === review.theirs) {
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
        onActivity: (guid, action) => {
          const path = this.pathForGuid(guid)
          if (!path) return
          void this.refreshDiskMatch(path, guid)
          // 'materialized' writes disk from the CRDT and emits no doc update,
          // so routeDocUpdate never fires for it. Re-emit here so a listener
          // sees every state change, not just the ones that moved the CRDT.
          if (action === 'materialized') {
            this.emitDocChanged(guid, path, 'materialize')
            this.notePullWrite()
          }
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
  private pendingBatchKind: 'watch' | 'boot' | 'ghost' | null = null
  /** The held ghost-replay batch's work (N1) — see replayDeletes. */
  private pendingGhostBatch: (() => Promise<void>) | null = null

  private holdBatch(kind: 'watch' | 'boot' | 'ghost', paths: string[], apply?: () => Promise<void>): void {
    if (kind === 'ghost') this.pendingGhostBatch = apply ?? null
    if (this.events.onBreaker) {
      this.pendingBatchKind = kind
      this.events.onBreaker(paths)
    } else {
      // No host affordance (headless/tests): keep the historical auto-confirm.
      console.warn('[workspace] mass-change breaker tripped — auto-confirming', paths)
      if (kind === 'watch') void this.sessionRef?.confirmPendingBatch()
      else if (kind === 'boot') void this.confirmBootBatch()
      else void this.confirmGhostBatch()
    }
  }

  /** Apply the held batch (host confirm affordance). */
  async confirmBreaker(): Promise<void> {
    const kind = this.pendingBatchKind
    this.pendingBatchKind = null
    if (kind === 'watch') await this.sessionRef?.confirmPendingBatch()
    else if (kind === 'boot') await this.confirmBootBatch()
    else if (kind === 'ghost') await this.confirmGhostBatch()
  }

  /** Drop the held batch: nothing is enrolled, ingested, or reconciled. */
  dismissBreaker(): void {
    const kind = this.pendingBatchKind
    this.pendingBatchKind = null
    if (kind === 'watch') this.sessionRef?.dismissPendingBatch()
    else if (kind === 'boot') this.dismissBootBatch()
    // Dismissing a ghost batch keeps the mount's files: the parent keys were
    // hard-deleted either way, so the two maps still agree (S10 Q5 row 9).
    else if (kind === 'ghost') this.pendingGhostBatch = null
  }

  private async confirmGhostBatch(): Promise<void> {
    const batch = this.pendingGhostBatch
    this.pendingGhostBatch = null
    if (batch) await batch()
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
    const socket = this.ensureSocket()
    this.folderConn = connectDoc({
      relay: this.relay.url,
      name: `${this.room}/folder`,
      token: this.relay.token,
      doc: this.folderDoc,
      user: this.user,
      record: this.recordFor(FOLDER_RECORD_KEY),
      onAuthFailed: (reason) => this.reportAuthFailure(reason),
      ...(socket ? { socket } : {}),
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
    if (this.cfg.neverHeld) {
      // A mount this device has never held, with no credential yet (S10 Q2 +
      // N3): boot EMPTY, and do NOT touch the durable state. The files under
      // the mount root are the room's, not ours — enrolling them would mint
      // fresh guids that LWW-clobber the owner's entries at the next paste —
      // and the namespace may still hold the seeded map its adopt wrote as
      // the crash rollforward's authority, which `persistBaseline` would
      // overwrite with this session's empty one.
      //
      // "Keep + mark" read exactly (spike S10 Q2): the bytes stay on disk,
      // untouched and unmanaged, and the tree marks the folder as needing a
      // link. Listing them as managed rows would be the dishonest half —
      // they are not this mount's files until the pull says so.
      await this.restartSession()
      this.adoptionEnabled = true
      await this.writeMountDesc()
      this.refreshFiles()
      this.emitMountEntries(true)
      return
    }
    if (await this.tryDurableReopen()) {
      this.refreshFiles()
      // Boot emission (N1): the map may already carry mount entries a peer
      // carved while this device was closed — the adopt machine's trigger
      // must not depend on having been online for the change.
      this.emitMountEntries(true)
      return
    }

    if (this.cfg.firstJoin) {
      const folderProvider = this.connectFolder()
      if (!folderProvider) throw new Error('a first join requires a relay')
      // The pull group: one no-progress watchdog for the whole phase, on THIS
      // session's injected clock (golden rule 5). Its abort rejects the waits
      // below, so a dead relay surfaces through the ordinary boot error path
      // rather than as a minute of silence (spike S10 Q4 §"Timeout").
      const pull = new ProgressTracker({
        clock: this.clock,
        onProgress: ({ synced, total }) => this.emitPull('pull', synced, total),
      })
      this.pull = pull
      this.pullPhase = 'pull'
      try {
        // Folder doc first; "synced" alone is not enough — the seeder may arrive
        // later, so also wait for the map to be non-empty. Auth rejection fails
        // fast with a real message instead of timing out as "connecting…".
        await whenSynced(
          folderProvider.provider,
          () => this.folderDoc.getMap().entries().some(([, e]) => !e.deleted),
          60_000,
          () => this.authFailure,
          { clock: this.clock }
        )
        // The denominator, the instant the map is in hand (< 50 ms measured),
        // and the rows with it: `refreshFiles` otherwise waits for the boot
        // promise, so the host has nothing to render for the whole pull.
        this.pullTotal = this.folderDoc
          .getMap()
          .entries()
          .filter(([, e]) => e.kind === 'text' && !e.deleted).length
        pull.setTotal(this.pullTotal)
        this.refreshFiles()
        this.adoptionEnabled = true
        await this.queueMapScan() // creates per-file docs + providers
        await Promise.all(
          [...this.conns.values()].map((c) =>
            whenSynced(c.provider, undefined, 60_000, () => this.authFailure, {
              clock: this.clock,
              progress: pull,
            })
          )
        )
        // Phase 2 — the one that costs ~92% of the wall clock, counted from
        // the reconciler's own `materialized` actions.
        this.pullPhase = 'write'
        this.emitPull('write', 0, this.pullTotal)
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
      } finally {
        pull.dispose()
        this.pull = null
        this.pullPhase = null
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
    this.emitMountEntries(true)
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

    // Same guard as `reconcileKnown`/`scanMap` (N1): a text key that survived
    // under a mount boundary — a ghost the sweep has not reached yet — must
    // not get a doc, an LCA or a provider in THIS room at boot.
    const mountRoots = this.mountRoots()
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (this.underMount(path, mountRoots)) continue
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

    // Anything at or under a mount boundary belongs to another session on this
    // device. The host's ignore set normally hides it, but a peer sees a
    // carve's mount entry BEFORE it has a desc to derive that set from — so
    // the scan refuses to re-enroll there on its own (N1, shaping A2).
    const mountRoots = this.mountRoots()
    const additions = (await this.adapter.list()).filter(
      (s) => !knownPaths.has(s.path) && !this.underMount(s.path, mountRoots)
    )

    // Pre-pass: which known files changed (or vanished) on disk while closed?
    // Never another session's disk: a text entry under a mount boundary is a
    // ghost, and reading it here would count it toward the mass-change
    // breaker and then reconcile it in the wrong room.
    const changed: string[] = []
    for (const [path, entry] of textEntries) {
      if (this.underMount(path, mountRoots)) continue
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
      // A mount root's own directory and everything under it are the mount
      // session's to manage — never enrolled here, never mkdir'd here (N1).
      const mountRoots = this.mountRoots()
      const onDisk = new Set(await this.adapter.listDirs())
      for (const dir of onDisk) {
        if (!mapPaths.has(dir) && !this.underMount(dir, mountRoots)) {
          this.folderDoc.transactMap(
            (m) => m.set(dir, { guid: crypto.randomUUID(), kind: 'dir' }),
            'local'
          )
        }
      }
      for (const [path, entry] of this.folderDoc.getMap().entries()) {
        if (entry.kind !== 'dir' || entry.deleted) continue
        if (this.underMount(path, mountRoots)) continue
        if (!onDisk.has(path)) await this.adapter.mkdir(path)
      }
    } catch (err) {
      this.pushError(err)
    }
  }

  /** Reconcile every known text doc except the skipped paths. */
  private async reconcileKnown(skip?: Set<string>): Promise<void> {
    const mountRoots = this.mountRoots()
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (skip?.has(path)) continue
      // Never write another session's disk (N1): a text entry that survives
      // under a mount boundary is a race, not ours to materialize.
      if (this.underMount(path, mountRoots)) continue
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
    // Re-derive the boundaries: a mount entry can have arrived while the batch
    // sat waiting for a human, and a held batch must not enrol or reconcile
    // into a subtree whose authority has since moved (N1).
    const mountRoots = this.mountRoots()
    const additions = batch.additions.filter((p) => !this.underMount(p, mountRoots))
    for (const path of additions) await this.enrollOne(path)
    if (additions.length > 0) await this.restartSession()
    for (const path of batch.changed) {
      if (this.underMount(path, mountRoots)) continue
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

  /**
   * Upsert this mount's desc in the vault's mount table (idempotent).
   *
   * MERGES rather than replaces (S10 Q2, "a defect that must be fixed in N1"):
   * a `needs-token` mount reopens with `relay: undefined`, and a blind upsert
   * rewrote its desc as a plain local `active` mount with no relay URL —
   * losing both the room's location and the waiting-for-a-key state at the
   * first reopen, permanently. The session owns `active`; it must never lower
   * a status or forget a relay it simply has no credential for.
   */
  private async writeMountDesc(): Promise<void> {
    // The merge runs INSIDE the mount table's serialized read-modify-write:
    // reading the desc first and upserting after would widen the window a
    // concurrent lifecycle transition writes in.
    await this.cfg.mountsFile?.upsertWith(this.room, (existing) => {
      const provenance: MountProvenance =
        this.cfg.provenance ?? existing?.provenance ?? (this.cfg.firstJoin ? 'joined' : 'local')
      const relay = this.relay ? { url: this.relay.url } : existing?.relay
      // Connected (or connectable) ⇒ active. Otherwise keep a needs-token desc
      // exactly as it was: this session is not the authority on whether a
      // token exists — the host is, and it said no when it built us with no
      // relay.
      const status: MountStatus =
        !this.relay && existing?.status === 'needs-token' ? 'needs-token' : 'active'
      // `neverHeld` survives every reopen until this session has actually
      // PULLED the room — a firstJoin boot is the only thing that clears it,
      // because it is the only thing that puts the room's content here (N3).
      const neverHeld = existing?.neverHeld === true && this.cfg.firstJoin !== true
      return {
        room: this.room,
        path: this.cfg.mountPath ?? '',
        provenance,
        ...(relay ? { relay } : {}),
        status,
        ...(neverHeld ? { neverHeld: true } : {}),
      }
    })
  }

  /**
   * Owner-side unshare, announced (N1, S10 Q1(b)): replace the `kind:'mount'`
   * entry at `path` with a dir entry AND re-set the absorbed subtree's entries
   * (same guids, `path/`-prefixed) in ONE 'local' transaction on the LIVE map,
   * then flush so the blob and the map agree. Peers receive one update in
   * which `P` flips mount → dir with its children back — which is exactly the
   * discriminator their absorb keys off ("the entry became a dir", never "the
   * key is gone", which is a rename race).
   *
   * Adoption is disabled first: setting entries for guids this session has no
   * doc for would otherwise make its own scanMap adopt them, inventing an
   * empty doc plus a NEVER_ON_DISK LCA whose reconcile ingests the file into a
   * second, independent history for the same guid. The caller shuts this
   * session down straight after and rebuilds it from the copied blobs.
   */
  async announceAbsorb(
    path: string,
    entries: readonly (readonly [string, FileEntry])[]
  ): Promise<void> {
    this.adoptionEnabled = false
    this.folderDoc.transactMap((m) => {
      const at = m.get(path)
      if (!at || at.deleted || at.kind !== 'dir') {
        m.set(path, { guid: crypto.randomUUID(), kind: 'dir' })
      }
      for (const [p, e] of entries) {
        if (e.kind === 'mount') continue // depth-1: never re-announce an inner mount
        m.set(`${path}/${p}`, e)
      }
    }, 'local')
    await this.cfg.docStore?.flush(FOLDER_DOC_KEY)
    this.refreshFiles()
  }
}

/**
 * Cap on the announced seed (spike S10 Q1). A folder-doc entry costs roughly
 * 80-100 bytes encoded, so 64 KB is several hundred files: above it the map
 * entry stops being advisory structure and starts being a payload every peer
 * of the parent room carries forever. Over the cap the entry ships WITHOUT a
 * seed, and a peer with a token pulls the room instead (`firstJoin`) while one
 * without waits as `needs-token` over an empty namespace.
 */
export const MAX_SEED_BYTES = 64 * 1024

/** A `kind:'mount'` entry, with the seed when it fits (S10 Q1). */
function mountEntry(room: string, relay?: string, seed?: Uint8Array): FileEntry {
  const encoded = seed && seed.byteLength <= MAX_SEED_BYTES ? encodeSeed(seed) : undefined
  return {
    guid: room,
    kind: 'mount',
    ...(relay ? { relay } : {}),
    ...(encoded ? { seed: encoded } : {}),
  }
}

/** base64 of a Yjs update, without assuming Node's Buffer or a DOM. */
function encodeSeed(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function decodeSeed(seed: string): Uint8Array {
  const binary = atob(seed)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Anything our own code didn't tag is an external change (mirrors
 * VaultSession's rule): real providers apply remote updates with the provider
 * INSTANCE as origin, never the seam's 'remote' string, so "not one of ours"
 * is the correct remote test.
 */
function isForeignOrigin(origin: unknown): boolean {
  return origin !== 'local' && origin !== 'disk' && origin !== 'seed'
}
