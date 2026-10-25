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
  StoreIo,
  VaultAdapter,
} from '@ohhi/vault'
import { DOC_CHANGE_WINDOW_MS, RelayRefusedError, type Actor, type AppEvent, type EventInput, type EventScope } from './events.js'
import { RoomEventLog } from './event-store.js'
import { numberedName, splitName } from './attachments.js'
import { attributeUpdate, relayHost } from './attribution.js'
import { AgentRuns, isAgentOrigin, type AgentOrigin } from './agent-origin.js'
import { AgentThrottle } from './agent-throttle.js'
import { DEFAULT_AGENT_STYLE, DocAgentPresence, type AgentPresenceStyle } from './agent-presence.js'
import { decodeRange, encodeRange, ytextOf, type AnchorPair } from './anchors.js'
import {
  memoryRecordMap,
  SuggestionConflictError,
  SuggestionStore,
  yRecordMap,
  type StoredRecord,
  type SuggestionRecord,
  type SuggestionSpan,
} from './suggestions.js'
import {
  BlobDocStore,
  decodeFile,
  DEFAULT_THRESHOLDS,
  enrollFolder,
  FOLDER_DOC_KEY,
  hashBytes,
  IGNORED_DIRS,
  isScratchName,
  joinFolder,
  JsonFileLcaStore,
  looksBinary,
  mountRootsFrom,
  NEVER_ON_DISK,
  VaultSession,
  WriteConflictError,
  type StoreDir,
} from '@ohhi/vault'
import type { EngineDoc, FileEntry, SyncEngine } from '@ohhi/sync'
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
  type DocPeer,
  type FileRow,
  type MountEntryInfo,
  type MountEvents,
  type PullProgress,
  type RelayConfig,
  type SyncRecordFields,
} from './types.js'

/** What `createFile` will create by name: a note, or a collection's `.base` file. */
const CREATED_TEXT_EXTENSIONS = new Set(['.md', '.base'])
const FLUSH_DEBOUNCE_MS = 800
const CLOSED_RECONCILE_MS = 200
/**
 * A room's relay has been unreachable this long → `relay.state offline`
 * (after `reconnecting`, or from boot when it never connected). Edge-only
 * history; the pill stays the live truth (golden rule 4).
 */
export const RELAY_OFFLINE_MS = 30_000
/**
 * After OUR folder connection comes (back) up, peer joins/leaves are not
 * believed for this long: the peers' awareness arrives after the connect, so
 * diffing at once would log every present peer as left and then joined. The
 * diff runs once the window closes, against the set from before the drop.
 */
export const PEER_SETTLE_MS = 3_000

/** An agent's edit to one note (mount-relative path). The seam's one home: `@ohhi/harness` re-exports it. */
export interface ProposeEditInput {
  path: string
  from: number
  to: number
  baseText: string
  proposedText: string
  origin: AgentOrigin
}

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
   * The room is a share someone else made, joined here — set by the host for
   * a ROOT opened from a folder share (its provenance stays 'local': it is
   * this device's vault, whose room happens to be a share). A joined mount
   * says so through `provenance` already. Only the words of a relay refusal
   * read it (`relay.state` → `joined`).
   */
  joinedShare?: boolean
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
  /**
   * `<room>/events.json` in the vault's StoreDir: this room's persisted event
   * log (sharing E3, `event-store.ts`). Absent → the log is in memory only.
   */
  eventsIo?: StoreIo
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

/**
 * One journaled pre-image of a file, without its bytes (W3, the History rail
 * section). The bytes stay in the journal until a restore actually asks for
 * them: a list is metadata, and a note's twenty retained versions are not
 * something a sidebar should be holding.
 */
export interface PreImageInfo {
  /** Journal-stable id; what `restorePreImage` names. */
  seq: number
  at: number
  size: number
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

/**
 * One row of a mount-wide inspection (devtools-shaping D5): the same facts
 * `inspectPath` reports for one file, without the journal timeline, for
 * every non-deleted entry of the map. Mount entries are boundaries, not
 * files, so they are left out — the nested mount reports its own rows.
 */
export interface PathInspection {
  /** Mount-relative; the facade prefixes it back into workspace space. */
  path: string
  guid: string
  kind: 'text' | 'binary' | 'dir'
  /** Text entries only: null = no LCA record yet (never reconciled). */
  lca: { headsDigest: string; contentHash: string } | null
  /** Text entries only: null = no Y.Doc in memory for this guid. */
  doc: { headsDigest: string; equalsLca: boolean | null } | null
  providerAttached: boolean
  /** Pre-images retained for this path (0..retention). */
  journalCount: number
  /** A live editor view holds this path open (materialization deferred). */
  open: boolean
}

/** A whole mount at once: identity, counts, every row, and what the map does not name. */
export interface MountInspection {
  stats: MountStats
  relay: string | null
  rows: PathInspection[]
  /** LCA records whose guid no non-deleted map entry names — a rebuild-only leftover. */
  lcaOrphans: { guid: string; path: string }[]
}

/**
 * The three texts behind one file (devtools-shaping D3, the peek): what is
 * on disk, what disk and doc last agreed on, and what the doc holds now. The
 * inspector diffs them pairwise — the hashes only ever say *whether* two of
 * them differ; this is *how*. Read on demand for ONE selected file, never
 * per row.
 */
export interface PathPeek {
  /** Decoded as the CRDT would hold it (BOM off, CRLF → LF); null when absent on disk. */
  disk: { text: string; hash: string } | null
  /** The LCA's base text; null with no LCA record. */
  lca: { text: string; hash: string } | null
  /** The live doc's text; null when no doc is in memory. */
  doc: { text: string } | null
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
  /** writeAttachment runs one at a time, so two pastes never pick the same free name. */
  private attachmentWork: Promise<unknown> = Promise.resolve()
  /**
   * Paths a live EDITOR VIEW currently holds open (spike S9 Q1). A set, not
   * one path: N panes can hold N notes, and the same note can be open in two
   * of them. The refcount itself is the host's (the web facade derives it
   * from the pane tree); this session owns the POLICY the set drives.
   */
  private readonly openPaths = new Set<string>()
  /**
   * Guids the CURRENT VaultSession has been told are open (Minor 4). A path
   * can enter `openPaths` before its doc exists — a view opens a note the
   * instant it is created, and the map entry lands a turn later — and
   * `markOpen` has nothing to name until it does. This is what lets the mark
   * be retried from every place a guid can appear without marking twice; it
   * is cleared with the session it describes.
   */
  private markedOpen = new Set<string>()
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

  // ---- the room's event log (sharing E3, spike S22) ----
  /** This room's persisted, droppable event log. One writer: `logEvent`. */
  private readonly roomLog: RoomEventLog
  /**
   * The folder map as `{path, kind}` by guid, for the `file.*` diff. Kept on
   * every map change; diffed only for FOREIGN changes once boot is over (a
   * first join's pull is not "a peer created 1,000 files").
   */
  private fileView = new Map<string, { path: string; kind: FileEntry['kind'] }>()
  private fileViewReady = false
  /** A foreign map diff waiting for its update bytes (Yjs emits `update` after observers). */
  private pendingFileEvents: EventInput[] | null = null
  /** The room's relay edge, as last logged. */
  private relayState: 'connected' | 'reconnecting' | 'offline' | 'refused' | null = null
  private relayRefusedReason: string | null = null
  private cancelOffline: (() => void) | null = null
  /** Our folder connection is up: peer joins/leaves are only believed while it is. */
  private folderConnected = false
  /** Pending end of the post-connect settle window (`PEER_SETTLE_MS`); null when settled. */
  private cancelPeerSettle: (() => void) | null = null
  /** Peers present in the folder awareness (name → color), ourselves excluded. */
  private presentPeers = new Map<string, string | undefined>()

  // ---- the in-app agent's writes (writing-harness B3/B7, spike S14) ----
  /** Canonical origin + per-run undo managers for every agent run that wrote here. */
  private readonly agentRuns = new AgentRuns()
  /** One suggestion store per doc guid, rebuilt when the guid's doc instance is. */
  private readonly suggestionStores = new Map<string, { doc: EngineDoc; store: SuggestionStore }>()
  private suggestionSeq = 0
  /**
   * The agent's write budget for this mount (B10): every agent transaction —
   * a proposal pinned, a suggestion applied in direct mode — waits for a
   * token (`agent-throttle.ts`, ~10 per 100 ms on the injected clock).
   */
  private readonly agentThrottle: AgentThrottle
  /** The agent's second awareness state, per relay-connected doc (`agent-presence.ts`). */
  private readonly agentPresences = new Map<string, DocAgentPresence>()
  /**
   * Docs whose `content` Y.Text changed in the transaction now being routed:
   * set by a text observer (Yjs runs observers before it emits `update`),
   * consumed by `routeDocUpdate`. A doc absent here changed only its side
   * maps — comments, suggestions — and is not a text change.
   */
  private readonly textTouched = new Set<string>()

  static async create(cfg: MountSessionConfig): Promise<MountSession> {
    const session = new MountSession(cfg)
    // The stored history first, so a boot's own events land after it.
    await session.roomLog.load()
    await session.boot()
    session.fileView = session.currentFileView()
    session.fileViewReady = true
    return session
  }

  private constructor(cfg: MountSessionConfig) {
    this.cfg = cfg
    this.room = cfg.room
    this.user = cfg.user
    this.engine = cfg.engine
    this.adapter = cfg.adapter
    this.clock = cfg.clock
    this.agentThrottle = new AgentThrottle(cfg.clock)
    this.lcaStore = cfg.lcaStore
    this.journal = cfg.journal
    this.events = cfg.events ?? {}
    this.relay = cfg.relay ?? null
    this.folderDoc = cfg.engine.createDoc(`${cfg.room}/folder`)
    this.roomLog = new RoomEventLog({
      clock: cfg.clock,
      room: cfg.room,
      ...(cfg.eventsIo ? { io: cfg.eventsIo } : {}),
    })
    // AFTER the map observer below has run for a transaction: the bytes that
    // attribute a foreign map diff (`noteMapChange`).
    this.engine.onUpdate(this.folderDoc, (update) => this.flushFileEvents(update))

    this.folderDoc.getMap().observe((origin) => {
      if (this.stopped) return // torn down; nothing here is ours any more
      this.noteMapChange(origin)
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

  /**
   * This room's event log, newest first: the stored history (loaded at
   * create) plus everything since. What `MountEvents.onEvent` reports one at
   * a time, as a snapshot — the host's merge point on mount open.
   */
  roomEvents(): AppEvent[] {
    return this.roomLog.events()
  }

  /** Drop this room's history (golden rule 8's rebuild: an empty log, written at once). */
  clearRoomEvents(): Promise<void> {
    return this.roomLog.rebuild()
  }

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

  // ---- suggestions and agent writes (writing-harness B7, spike S14) ----

  /**
   * Pin an agent's proposed edit to `path` (mount-relative) as a pending
   * suggestion (`suggestions.ts`), once the agent's throttle grants a token.
   * Rejects with `SuggestionConflictError` when the text at `[from, to)` is
   * not `baseText` — the agent read a stale copy — and with a plain Error
   * when the path has no live doc.
   */
  proposeEdit(input: ProposeEditInput): Promise<SuggestionRecord> {
    // Through the agent's bucket (B10): the record is a Y transaction on a
    // shared doc, and an agent can propose far faster than peers can watch.
    return this.throttledEdit(input, 1, (at) => this.proposeNow({ ...input, ...at }))
  }

  /**
   * Direct mode (Fork 4-B's opt-in): propose and apply at once — the same
   * record, accepted in the same throttle slot (two transactions, two
   * tokens), so the edit is attributed, undoable per run and rate-limited
   * like any proposal. Rejects as `proposeEdit` does.
   */
  applyAgentEdit(input: ProposeEditInput): Promise<SuggestionRecord> {
    return this.throttledEdit(input, 2, (at) => {
      const record = this.proposeNow({ ...input, ...at })
      return this.acceptSuggestion(input.path, record.id) ?? record
    })
  }

  /**
   * Run an agent edit through the bucket WITHOUT letting its offsets go
   * stale while it waits: the text is checked and the range pinned
   * (`encodeRange`) at the call, and the pinned range is resolved again when
   * the token is granted — so whatever a peer typed in between moves the
   * edit with it, exactly as it moves a pending suggestion.
   */
  private throttledEdit(
    input: ProposeEditInput,
    cost: number,
    fn: (at: { from: number; to: number }) => SuggestionRecord
  ): Promise<SuggestionRecord> {
    let pinned: AnchorPair
    try {
      const doc = this.docForPath(input.path)
      if (!doc) throw new Error(`no live doc for ${input.path}`)
      const ytext = ytextOf(doc)
      checkBase(ytext.toString(), input)
      pinned = encodeRange(ytext, input.from, input.to)
    } catch (err) {
      return Promise.reject(err)
    }
    return this.agentThrottle.run(() => {
      const doc = this.docForPath(input.path)
      const at = doc ? decodeRange(doc, pinned) : null
      if (!doc || !at) throw new Error(`no live doc for ${input.path}`)
      return fn(at)
    }, cost)
  }

  private proposeNow(input: ProposeEditInput): SuggestionRecord {
    const store = this.suggestionStore(input.path)
    if (!store) throw new Error(`no live doc for ${input.path}`)
    const record = store.propose({
      id: `${input.origin.runId}:${++this.suggestionSeq}`,
      at: this.clock.now(),
      from: input.from,
      to: input.to,
      baseText: input.baseText,
      proposedText: input.proposedText,
      origin: input.origin,
    })
    return withPath(record, input.path)
  }

  /**
   * The agent's presence on `path` (B10): a second awareness state on the
   * doc's awareness, coalesced and renewed on the injected clock. Null when
   * the note has no relay connection — a never-shared note has no peers to
   * show the agent to. `style` names and colours the agent (the shell's
   * i18n label and presence colour); the newest caller's wins.
   */
  agentPresence(path: string, style?: AgentPresenceStyle): DocAgentPresence | null {
    const guid = this.guidFor(path)
    const conn = guid ? this.conns.get(guid) : undefined
    const doc = guid ? this.docs.get(guid) : undefined
    if (!guid || !conn || !doc) return null
    let held = this.agentPresences.get(guid)
    if (held && held.awareness !== conn.awareness) {
      held.dispose()
      held = undefined
    }
    if (!held) {
      held = new DocAgentPresence(conn.awareness, doc, this.clock, style ?? DEFAULT_AGENT_STYLE)
      this.agentPresences.set(guid, held)
    } else if (style) {
      held.style = style
    }
    return held
  }

  private dropAgentPresence(guid: string): void {
    this.agentPresences.get(guid)?.dispose()
    this.agentPresences.delete(guid)
  }

  /**
   * Apply a pending suggestion: one transaction with the run's agent origin,
   * logged as the agent's `doc.changed` and undoable by `undoAgent`. The
   * record as it now stands (`accepted`, or `stale` when the text moved),
   * or null when there is none.
   */
  acceptSuggestion(path: string, id: string): SuggestionRecord | null {
    const record = this.suggestionStore(path)?.accept(id) ?? null
    return record ? withPath(record, path) : null
  }

  /** Drop a suggestion; the text is never touched. */
  rejectSuggestion(path: string, id: string): boolean {
    return this.suggestionStore(path)?.reject(id) ?? false
  }

  /** Every suggestion record on `path`, newest first. */
  suggestionsFor(path: string): SuggestionRecord[] {
    return (this.suggestionStore(path)?.list() ?? []).map((r) => withPath(r, path))
  }

  /** The pending and stale suggestions on `path`, resolved to offsets in the text now. */
  suggestionSpans(path: string): SuggestionSpan[] {
    return this.suggestionStore(path)?.spans() ?? []
  }

  /** Called after any change to `path`'s text or suggestions. */
  subscribeSuggestions(path: string, cb: () => void): () => void {
    return this.suggestionStore(path)?.subscribe(cb) ?? (() => {})
  }

  /**
   * Undo everything agent run `runId` wrote in this mount (the newest run
   * with something to undo when absent). Only the agent's items go — a
   * human's typing inside them stays (spike S14 Q2). False when nothing did.
   */
  undoAgent(runId?: string): boolean {
    const id = runId ?? this.agentRuns.lastRun()
    return id ? this.agentRuns.undo(id) : false
  }

  /** The newest agent run in this mount with something left to undo, or null. */
  lastAgentRun(): string | null {
    return this.agentRuns.lastRun()
  }

  /**
   * Editor lifecycle: every path in `rels` is owned by a live view, so the
   * reconciler must not materialize over it (`reconciler.ts` noops for any
   * path in `ctx.openPaths`; the flush is what writes those bytes out).
   *
   * The caller passes the WHOLE set every time and this diffs it — a path
   * that entered is marked open, a path that LEFT has its pending flush
   * debounce cancelled and is reconciled closed. Two views over one note
   * collapse to one member, so the last view to leave is the one that closes
   * the doc, and nothing is suppressed while another view still holds it
   * (spike S9 Q2).
   */
  setOpenPaths(rels: ReadonlySet<string>): void {
    const opened: string[] = []
    const closed: string[] = []
    for (const rel of rels) if (!this.openPaths.has(rel)) opened.push(rel)
    for (const rel of this.openPaths) if (!rels.has(rel)) closed.push(rel)
    if (opened.length === 0 && closed.length === 0) return
    // Mutate BEFORE the routing below, so a path that just left counts as
    // closed for anything routeDocUpdate sees in between.
    this.openPaths.clear()
    for (const rel of rels) this.openPaths.add(rel)
    for (const rel of closed) {
      const guid = this.guidFor(rel)
      if (!guid) continue
      this.markedOpen.delete(guid)
      this.debounces.get(guid)?.()
      this.debounces.delete(guid)
      void this.reconcileClosedDoc(guid, rel)
    }
    this.markOpenPaths()
  }

  /**
   * Tell the session about every held path whose doc EXISTS and has not been
   * marked yet (Minor 4).
   *
   * Re-run from `refreshFiles` — i.e. wherever a map change can have minted
   * the guid — because a path that entered `openPaths` before its entry did
   * used to be skipped silently and never retried, leaving a live buffer the
   * reconciler was free to materialize over (golden rule 1).
   */
  private markOpenPaths(): void {
    this.syncHere()
    if (!this.sessionRef) return
    for (const rel of this.openPaths) {
      const guid = this.guidFor(rel)
      if (!guid || this.markedOpen.has(guid)) continue
      this.markedOpen.add(guid)
      this.sessionRef.markOpen(guid)
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
    let writing: string | null = null
    try {
      const base = dir ? `${dir}/` : ''
      const taken = new Set(this.folderDoc.getMap().entries().map(([p]) => p))
      let path: string
      if (name) {
        const clean = name.replace(/^\/+/, '')
        if (clean.split('/').includes('..')) throw new Error(`invalid note name '${name}'`)
        // Notes are markdown, and a collection is a `.base` file this app
        // creates (bases-shaping A2). A name carrying any other extension is
        // an attachment reference (`![[diagram.png]]`), and appending `.md`
        // to it would create `diagram.png.md` — a file nobody wants and
        // nothing links to.
        const ext = /\.[A-Za-z0-9]{1,8}$/.exec(clean)?.[0]
        if (ext && !CREATED_TEXT_EXTENSIONS.has(ext.toLowerCase())) {
          throw new Error(`'${clean}' is not a note — only .md and .base files are created here`)
        }
        path = `${base}${ext ? clean : `${clean}.md`}`
        const existing = this.folderDoc.getMap().get(path)
        if (existing && !existing.deleted) return path
      } else {
        let n = 1
        while (taken.has(`${base}untitled-${n}.md`)) n++
        path = `${base}untitled-${n}.md`
      }
      // Ours from the moment the name is picked, before any await: a live
      // enrol committing the path during the read below would otherwise be
      // overwritten by this create's entry, its guid orphaned.
      writing = path
      this.appWrites.add(path)
      // A map miss is NOT evidence the path is free: a note another writer
      // (Obsidian, git, an agent) put on disk moments ago may not be enrolled
      // yet — live enrol-on-create runs behind the watcher, and a dismissed
      // batch leaves its files out until the next boot scan. NEVER overwrite
      // bytes Editor did not write (golden rule 1) — adopt them instead,
      // which is also what "open the note this link points at" should do.
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
      // The map, re-read right before the commit: an entry that landed during
      // the awaits above (a peer's note at the same name) is adopted, never
      // overwritten — overwriting would strand its guid with a doc, a
      // provider and an index entry but no map key.
      const claimed = this.folderDoc.getMap().get(path)
      if (claimed && !claimed.deleted) {
        await this.discardDoc(guid, doc)
        this.refreshFiles()
        return path
      }
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
    } finally {
      if (writing !== null) this.appWrites.delete(writing)
    }
  }

  /**
   * Write a pasted or dropped attachment (editor-usability E5) at `path`, or
   * beside it as `name 1.ext`, `name 2.ext`… when that name is taken — on disk
   * OR in the map. Returns the path written (mount-relative), or null with the
   * reason pushed as an error.
   *
   * Never an overwrite: a name the map does not know can still be a file
   * Obsidian or an agent wrote while we ran (live enrol-on-create runs behind
   * the watcher, after a quiesce, and skips scratch names and a held or
   * dismissed batch), so the disk is asked too, and a taken name moves aside
   * rather than replacing bytes Editor did not write (golden rule 1). The create is
   * journaled (a pre-image of null) and goes through the atomic write as a
   * compare-and-swap that must find NO file there (`expectHash: ''`): a file
   * that appears between the check and the rename refuses the write, and the
   * attachment moves aside to the next free name instead. Writes are
   * serialised per session, so two pastes in the same second (the same
   * clock-made name) both land, the second beside the first.
   *
   * The entry is `{kind:'binary'}`, exactly what enrolment would have made of
   * the file: binaries are not synced (D2f), so peers see the name in the tree
   * and a placeholder where the picture is — never the bytes, and nothing here
   * claims otherwise.
   */
  writeAttachment(path: string, bytes: Uint8Array): Promise<string | null> {
    const run = this.attachmentWork.then(() => this.writeAttachmentNow(path, bytes))
    this.attachmentWork = run.catch(() => undefined)
    return run
  }

  private async writeAttachmentNow(path: string, bytes: Uint8Array): Promise<string | null> {
    try {
      const clean = path.replace(/^\/+/, '')
      const segs = clean.split('/')
      if (!clean || clean.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')) {
        throw new Error(`'${path}' is not a path inside this folder`)
      }
      if (segs.some((s) => IGNORED_DIRS.has(s))) {
        throw new Error(`'${path}' is inside an app folder — attachments go in the vault`)
      }
      if (this.underMount(clean, this.mountRoots())) {
        throw new Error(`'${path}' belongs to another shared folder`)
      }
      if (!looksBinary(clean, bytes)) {
        // A text file would need a doc and an LCA; this path makes none.
        throw new Error(`'${path}' is not an attachment type`)
      }
      const map = this.folderDoc.getMap()
      const cut = clean.lastIndexOf('/')
      const dir = cut === -1 ? '' : clean.slice(0, cut)
      const [stem, ext] = splitName(clean.slice(cut + 1))
      const taken = async (p: string): Promise<boolean> => {
        const entry = map.get(p)
        if (entry && !entry.deleted) return true
        return (await this.adapter.read(p)) !== null
      }
      const nameFor = (n: number): string => `${dir ? `${dir}/` : ''}${numberedName(stem, ext, n)}`
      let target = ''
      for (let n = 0; ; n++) {
        const candidate = nameFor(n)
        if (await taken(candidate)) continue
        await this.journal.record(candidate, null)
        this.appWrites.add(candidate)
        try {
          // Must-not-exist: the adapter re-checks as late as it can (just
          // before the rename), closing the window `taken` leaves open.
          await this.adapter.writeAtomic(candidate, bytes, { expectHash: '' })
        } catch (err) {
          this.appWrites.delete(candidate)
          if (err instanceof WriteConflictError) continue
          throw err
        }
        target = candidate
        break
      }
      this.folderDoc.transactMap(
        (m) => m.set(target, { guid: crypto.randomUUID(), kind: 'binary' }),
        'local'
      )
      this.appWrites.delete(target)
      // A new folder (`Attachments/`) must be a map entry too, or the tree can
      // draw it while rename and delete cannot find it (M3).
      if (target.includes('/')) await this.syncDirs()
      this.refreshFiles()
      return target
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
      // Views on the doomed subtree let go first: the delete journals and
      // removes the bytes, and a still-"open" path would keep the reconciler
      // off a file that no longer exists.
      const doomed = (rel: string): boolean =>
        rel === path || (entry.kind === 'dir' && rel.startsWith(`${path}/`))
      if ([...this.openPaths].some(doomed)) {
        this.setOpenPaths(new Set([...this.openPaths].filter((rel) => !doomed(rel))))
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
      const decoded = opts?.seed === undefined ? null : decodeSeed(opts.seed)
      if (decoded !== null) {
        // ONE history on every device: apply the announcer's own folder state
        // instead of re-`set`ting the entries ourselves. Two independently
        // seeded folder docs merge as a UNION, so a hard delete on one side —
        // which is how a rename removes its source and how the ghost rule
        // removes a key — has nothing to delete on the other, and the two
        // maps diverge permanently (`fuzz-crashers/0003`).
        this.engine.applyUpdate(tmp, decoded, 'seed')
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
      if (this.conns.has(guid)) {
        this.dropAgentPresence(guid)
        this.conns.get(guid)?.destroy()
        this.conns.delete(guid)
        this.events.onDocPresence?.(guid, [])
      }
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
    // Ours before the first await: a live enrol must not commit the path
    // between this check and the enrolment below.
    this.appWrites.add(rel)
    try {
      const pre = await this.adapter.read(rel)
      await this.journal.record(rel, pre)
      await this.adapter.writeAtomic(rel, bytes)
      // enrollOne re-checks the map before it commits, and adopts an entry
      // that landed meanwhile rather than overwrite it.
      await this.enrollOne(rel)
    } finally {
      this.appWrites.delete(rel)
    }
    await this.syncDirs()
    await this.restartSession()
    this.refreshFiles()
  }

  // ---- pre-image history (W3) — the journal that already exists, read back ----

  /**
   * Pre-images recorded for `rel`, newest first. Bounded by the journal's own
   * per-path retention (20), so this is a small read, not a scan.
   */
  async fileHistory(rel: string): Promise<PreImageInfo[]> {
    // `list`, never `entries`: this runs on every flush while the rail is
    // open, and reading the bytes back to measure them would read the whole
    // retention window of a note to print a column of sizes (M11).
    const entries = await this.journal.list(rel)
    return entries.map((e) => ({ seq: e.seq, at: e.at, size: e.size })).reverse()
  }

  /**
   * Put one pre-image back. The write goes through VaultSession, never through
   * this adapter: the pre-image journal and the atomic rename are the vault
   * layer's job (golden rule 1), and going around them would strand the CRDT.
   *
   * REJECTS on failure (Minor 18). It used to swallow into `pushError` and
   * resolve, so the confirm dialog closed and the rail re-listed as though the
   * note had gone back — a restore that silently did nothing is the one
   * outcome this affordance must never present as success. The notice is still
   * logged, because a rail that shows the error is not the only place a person
   * looks for it.
   */
  async restorePreImage(rel: string, seq: number): Promise<void> {
    if (!this.sessionRef) throw new Error(`cannot restore '${rel}': this folder is not open`)
    try {
      const entry = (await this.journal.entries(rel)).find((e) => e.seq === seq)
      // A pre-image can age out of retention between the listing and the click.
      if (!entry) throw new Error(`no journaled version ${seq} of '${rel}' remains`)
      await this.sessionRef.restoreFile(rel, entry.bytes)
      const guid = this.guidFor(rel)
      if (guid) await this.refreshDiskMatch(rel, guid)
      this.refreshFiles()
    } catch (err) {
      this.pushError(err)
      throw err
    }
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
    const entries = await this.journal.list(path)
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
          .map((e) => ({ at: e.at, bytes: e.size })),
      },
      providerAttached: this.conns.has(guid),
    }
  }

  /** The three texts of one text file (see `PathPeek`); null for unknown/binary/dir. */
  async peekPath(path: string): Promise<PathPeek | null> {
    const guid = this.guidFor(path)
    if (!guid) return null
    const [bytes, lca] = await Promise.all([this.adapter.read(path), this.lcaStore.get(guid)])
    const doc = this.docs.get(guid) ?? null
    return {
      disk: bytes ? { text: decodeFile(bytes).text, hash: hashBytes(bytes) } : null,
      lca: lca ? { text: lca.baseText, hash: lca.contentHash } : null,
      doc: doc ? { text: doc.getText().toString() } : null,
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
      journalCount: (await this.journal.list()).length,
    }
  }

  /**
   * Every row of this mount in one read (devtools-shaping D5). Three store
   * reads regardless of size — the map, `lcaStore.all()`, `journal.list()` —
   * never one per path: the inspector refreshes this on demand over a
   * thousand-note vault, and `inspectPath` per row would be a thousand
   * journal listings.
   */
  async inspectMount(): Promise<MountInspection> {
    const stats = await this.mountStats()
    const lcaByGuid = new Map((await this.lcaStore.all()).map((r) => [r.guid, r] as const))
    const journalCounts = new Map<string, number>()
    for (const e of await this.journal.list()) {
      journalCounts.set(e.path, (journalCounts.get(e.path) ?? 0) + 1)
    }
    const rows: PathInspection[] = []
    const named = new Set<string>()
    for (const [path, entry] of this.mapEntries()) {
      if (entry.kind === 'mount') continue
      named.add(entry.guid)
      const isText = entry.kind === 'text'
      const lca = isText ? (lcaByGuid.get(entry.guid) ?? null) : null
      const doc = isText ? (this.docs.get(entry.guid) ?? null) : null
      const lcaHeads = lca ? this.engine.decodeHeads(lca.heads) : null
      const docHeads = doc ? this.engine.heads(doc) : null
      rows.push({
        path,
        guid: entry.guid,
        kind: entry.kind,
        lca: lca
          ? {
              headsDigest: shortDigest(lca.heads),
              contentHash: lca.contentHash === NEVER_ON_DISK ? '(never on disk)' : lca.contentHash,
            }
          : null,
        doc:
          doc && docHeads
            ? {
                headsDigest: shortDigest(this.engine.encodeHeads(docHeads)),
                equalsLca: lcaHeads ? this.engine.headsEqual(docHeads, lcaHeads) : null,
              }
            : null,
        providerAttached: this.conns.has(entry.guid),
        journalCount: journalCounts.get(path) ?? 0,
        open: this.openPaths.has(path),
      })
    }
    rows.sort((a, b) => a.path.localeCompare(b.path))
    const lcaOrphans = [...lcaByGuid.values()]
      .filter((r) => !named.has(r.guid))
      .map((r) => ({ guid: r.guid, path: r.path }))
      .sort((a, b) => a.path.localeCompare(b.path))
    return { stats, relay: this.relay?.url ?? null, rows, lcaOrphans }
  }

  /** Promote a local mount to a shared one; returns the copyable link. */
  enableSharing(newRelay: RelayConfig): { link: string } {
    // RE-KEY when a relay is already attached. `connectFolder` returns early
    // on an existing `folderConn` and `attachProvider` skips a guid that
    // already has one, so a session that had been refused — a mount degraded
    // to `needs-token` after the relay rejected its token — kept its dead
    // connections and quietly ignored the new credential the paste just
    // supplied, while its desc read `active`. "Shared, not syncing", forever
    // (golden rule 4). Tearing the old ones down first is what makes a paste
    // mean something.
    if (this.relay) {
      this.destroyConns()
      this.folderConn?.destroy()
      this.folderConn = null
      this.roomSocket?.destroy() // after the per-doc detaches, never before
      this.roomSocket = null
      this.authFailure = null
      // A new credential starts a new relay story: the refusal no longer holds.
      this.cancelOffline?.()
      this.cancelOffline = null
      this.relayState = null
      this.relayRefusedReason = null
      this.folderConnected = false
      this.cancelPeerSettle?.()
      this.cancelPeerSettle = null
      // Every record goes back to "not connected" until the NEW provider says
      // otherwise: the pill must never carry a previous credential's verdict.
      const folder = this.recordFor(FOLDER_RECORD_KEY)
      folder.connected = false
      folder.synced = false
      for (const guid of this.docs.keys()) {
        const rec = this.recordFor(guid)
        rec.connected = false
        rec.synced = false
      }
    }
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
    this.cancelOffline?.()
    this.cancelOffline = null
    this.cancelPeerSettle?.()
    this.cancelPeerSettle = null
    for (const { store } of this.suggestionStores.values()) store.destroy()
    this.suggestionStores.clear()
    this.agentRuns.destroy()
    this.agentThrottle.dispose()
    // Best-effort, like the blob tail below: the log is droppable (rule 8).
    void this.roomLog.flush().finally(() => this.roomLog.dispose())
    this.sessionRef?.dispose()
    this.destroyConns()
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

  /**
   * This boot built the namespace from DISK for a mount whose content belongs
   * to a room (`adopted`/`joined`, provider-less). The guids are ours, not the
   * room's, so the desc must say `neverHeld` — the paste has to pull.
   */
  private enrolledForRoom = false

  /**
   * This boot actually PULLED the room (the `firstJoin` branch ran to
   * completion). Only that clears `neverHeld` from the desc: being *told* to
   * pull is not the same as having pulled, and a session that was handed
   * `firstJoin` but came up some other way must not claim the room's content.
   */
  private pulledRoom = false

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
    this.cancelOffline?.()
    this.cancelOffline = null
    this.cancelPeerSettle?.()
    this.cancelPeerSettle = null
    // The debounced tail of the event log, durably (sharing E3).
    await this.roomLog.flush()
    this.roomLog.dispose()
    this.sessionRef?.dispose()
    this.sessionRef = null
    this.destroyConns()
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

  // ---- the room's event log (sharing E3) ----

  /**
   * The one writer into this room's log. Never lets the log or a listener
   * break the path that reported it: the log is a derived convenience
   * (golden rule 8), the sync path is not.
   */
  private logEvent(input: EventInput): void {
    if (this.stopped) return
    let event: AppEvent
    try {
      event = this.roomLog.append(input)
    } catch (err) {
      this.pushError(err)
      return
    }
    if (!this.events.onEvent) return
    try {
      this.events.onEvent(event)
    } catch (err) {
      this.pushError(err)
    }
  }

  /** `{room, mount, path}` with the path WORKSPACE-relative (the tree opens it as is). */
  private scopeFor(path?: string): EventScope {
    const mount = this.cfg.mountPath ?? ''
    const scope: EventScope = { room: this.room, mount }
    if (path !== undefined) scope.path = mount && path ? `${mount}/${path}` : path || mount
    else if (mount) scope.path = mount
    return scope
  }

  /**
   * `doc.changed` for an edit that arrived: a peer's (attributed through the
   * doc's awareness at arrival — `attribution.ts`), a disk ingest
   * (Obsidian, git, an outside agent: `disk`), or the IN-APP agent's own
   * transaction (an `AgentOrigin`, `agent-origin.ts` → `agent`, named). Only
   * those three: an update logs only when its origin is that doc's PROVIDER
   * (or the seam's `'remote'`), a disk ingest or an agent origin. Every
   * other origin is a local transaction — `'local'`, the
   * editor binding's, the undo manager's — and is never logged: a local
   * delete-only edit carries no inserted client ids, so attribution would
   * fall through to "via the relay" and badge the drawer with our own
   * Backspace.
   */
  private noteDocChange(guid: string, path: string, update: Uint8Array, origin: unknown): void {
    const provider = this.conns.get(guid)?.provider
    const remote = origin === 'remote' || (provider !== undefined && origin === provider)
    const agent = isAgentOrigin(origin)
    if (origin !== 'disk' && !remote && !agent) return
    // A first join's pull is the room arriving, not a thousand edits.
    if (this.pullPhase !== null) return
    try {
      let actor: Actor
      if (agent) {
        // The in-app agent (writing-harness B3/B7): the app made this
        // transaction itself, so the name is known, not inferred.
        actor = { kind: 'agent', name: origin.name }
      } else if (origin === 'disk') {
        actor = { kind: 'disk' }
      } else {
        const doc = this.docs.get(guid)
        actor = attributeUpdate({
          clientIds: this.engine.clientIdsOf(update),
          self: doc ? this.engine.clientIdOf(doc) : null,
          states: this.conns.get(guid)?.awareness.getStates() ?? null,
          relayHost: relayHost(this.relay?.url),
          recent: this.recentActor(guid),
        })
        if (actor.kind === 'me') return // an echo of our own ops
      }
      const { added, removed } = this.engine.charDeltaOf(update)
      if (added === 0 && removed === 0) return
      this.logEvent({
        kind: 'doc.changed',
        level: 'info',
        scope: this.scopeFor(path),
        actor,
        payload: { guid, added, removed },
      })
    } catch (err) {
      this.pushError(err)
    }
  }

  /**
   * Who this note's newest `doc.changed` within the fold window was
   * attributed to — the tie-break for a delete-only update when several
   * people have the note open (`attribution.ts` rule 3).
   */
  private recentActor(guid: string): Actor | null {
    const floor = this.clock.now() - DOC_CHANGE_WINDOW_MS
    for (const e of this.roomLog.events()) {
      if (e.at < floor) return null
      if (e.kind === 'doc.changed' && (e.payload as { guid?: string }).guid === guid) return e.actor
    }
    return null
  }

  /** The map's files/dirs by guid, mount boundaries and tombstones excluded. */
  private currentFileView(): Map<string, { path: string; kind: FileEntry['kind'] }> {
    const view = new Map<string, { path: string; kind: FileEntry['kind'] }>()
    const roots = this.mountRoots()
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.deleted || entry.kind === 'mount' || this.underMount(path, roots)) continue
      view.set(entry.guid, { path, kind: entry.kind })
    }
    return view
  }

  /**
   * Called first thing in the map observer: refresh the file view, and for a
   * FOREIGN change diff it into `file.created` / `file.deleted` /
   * `file.moved`. Children of a created, deleted or moved directory fold into
   * the directory's one line. The events wait in `pendingFileEvents` for the
   * transaction's update bytes (`flushFileEvents`), which is what names the
   * peer — Yjs emits `update` after the observers have run.
   */
  private noteMapChange(origin: unknown): void {
    try {
      // A diff whose update never came (not expected) still gets logged.
      if (this.pendingFileEvents) this.flushFileEvents(null)
      const next = this.currentFileView()
      const prev = this.fileView
      this.fileView = next
      if (!this.fileViewReady || !isForeignOrigin(origin)) return
      const created: { path: string; kind: FileEntry['kind'] }[] = []
      const deleted: { path: string; kind: FileEntry['kind'] }[] = []
      const moved: { from: string; to: string; kind: FileEntry['kind'] }[] = []
      for (const [guid, now] of next) {
        const was = prev.get(guid)
        if (!was) created.push(now)
        else if (was.path !== now.path) moved.push({ from: was.path, to: now.path, kind: now.kind })
      }
      for (const [guid, was] of prev) if (!next.has(guid)) deleted.push(was)
      const under = (p: string, dirs: string[]): boolean => dirs.some((d) => p.startsWith(`${d}/`))
      const newDirs = created.filter((c) => c.kind === 'dir').map((c) => c.path)
      const goneDirs = deleted.filter((d) => d.kind === 'dir').map((d) => d.path)
      const dirMoves = moved.filter((m) => m.kind === 'dir')
      const inMovedDir = (m: { from: string; to: string }): boolean =>
        dirMoves.some((d) => m.from.startsWith(`${d.from}/`) && m.to === `${d.to}${m.from.slice(d.from.length)}`)
      const out: EventInput[] = []
      for (const c of created) {
        if (under(c.path, newDirs)) continue
        out.push({ kind: 'file.created', level: 'info', scope: this.scopeFor(c.path), payload: {} })
      }
      for (const d of deleted) {
        if (under(d.path, goneDirs)) continue
        out.push({ kind: 'file.deleted', level: 'info', scope: this.scopeFor(d.path), payload: {} })
      }
      for (const m of moved) {
        if (inMovedDir(m)) continue
        out.push({
          kind: 'file.moved',
          level: 'info',
          scope: this.scopeFor(m.to),
          payload: { from: this.scopeFor(m.from).path ?? m.from },
        })
      }
      if (out.length > 0) this.pendingFileEvents = out
    } catch (err) {
      this.pushError(err)
    }
  }

  /** Log the pending foreign map diff, attributed by the transaction's update. */
  private flushFileEvents(update: Uint8Array | null): void {
    const pending = this.pendingFileEvents
    if (!pending) return
    this.pendingFileEvents = null
    try {
      const actor =
        update === null
          ? this.relayActor()
          : attributeUpdate({
              clientIds: this.engine.clientIdsOf(update),
              self: this.engine.clientIdOf(this.folderDoc),
              states: this.folderConn?.awareness.getStates() ?? null,
              relayHost: relayHost(this.relay?.url),
            })
      if (actor.kind === 'me') return
      for (const input of pending) this.logEvent({ ...input, actor })
    } catch (err) {
      this.pushError(err)
    }
  }

  /**
   * Peer joins / leaves from the folder awareness, by announced name (the
   * same names `onPresence` reports). Frozen while our own folder connection
   * is down: awareness ages everyone out when WE drop, and "B left" would be
   * a lie about B. And frozen for `PEER_SETTLE_MS` after it comes back up:
   * the peers' states arrive after the connect, so an immediate diff would
   * log everyone as left, then joined.
   */
  private notePeers(peers: Map<string, string | undefined>): void {
    if (!this.folderConnected || this.cancelPeerSettle) return
    for (const [name, color] of peers) {
      if (this.presentPeers.has(name)) continue
      this.logEvent({
        kind: 'peer.joined',
        level: 'info',
        scope: this.scopeFor(),
        actor: { kind: 'peer', name, ...(color ? { color } : {}) },
        payload: {},
      })
    }
    for (const [name, color] of this.presentPeers) {
      if (peers.has(name)) continue
      this.logEvent({
        kind: 'peer.left',
        level: 'info',
        scope: this.scopeFor(),
        actor: { kind: 'peer', name, ...(color ? { color } : {}) },
        payload: {},
      })
    }
    this.presentPeers = peers
  }

  private relayActor(): Actor {
    const name = relayHost(this.relay?.url)
    return { kind: 'relay', ...(name ? { name } : {}) }
  }

  /** The folder provider's socket status → the room's relay edge. */
  private noteRelayStatus(status: string): void {
    if (this.stopped) return
    if (status === 'connected') {
      if (this.folderConnected) return
      this.folderConnected = true
      this.cancelOffline?.()
      this.cancelOffline = null
      this.setRelayState('connected')
      // Presence was frozen while we were down: diff it once the peers'
      // awareness has had time to arrive, never at the connect itself.
      this.cancelPeerSettle?.()
      this.cancelPeerSettle = this.clock.schedule(() => {
        this.cancelPeerSettle = null
        if (!this.stopped) this.updatePresence()
      }, PEER_SETTLE_MS)
      return
    }
    this.folderConnected = false
    this.cancelPeerSettle?.()
    this.cancelPeerSettle = null
    if (this.relayState === 'refused') return // retrying will not change a refusal
    if (this.relayState === 'connected') this.setRelayState('reconnecting')
    this.armOffline()
  }

  /** `offline` after `RELAY_OFFLINE_MS` without a connection, on the injected clock. */
  private armOffline(): void {
    if (this.cancelOffline || this.relayState === 'offline' || this.relayState === 'refused') return
    this.cancelOffline = this.clock.schedule(() => {
      this.cancelOffline = null
      if (this.stopped || this.relayState === 'connected' || this.relayState === 'refused') return
      this.setRelayState('offline')
    }, RELAY_OFFLINE_MS)
  }

  private setRelayState(to: 'connected' | 'reconnecting' | 'offline' | 'refused', reason?: string): void {
    if (to === this.relayState && (to !== 'refused' || reason === this.relayRefusedReason)) return
    this.relayState = to
    this.relayRefusedReason = to === 'refused' ? (reason ?? null) : null
    if (to === 'refused') {
      this.cancelOffline?.()
      this.cancelOffline = null
    }
    this.logEvent({
      kind: 'relay.state',
      level: to === 'refused' ? 'error' : 'info',
      scope: this.scopeFor(),
      actor: this.relayActor(),
      payload: {
        to,
        ...(to === 'refused' && reason !== undefined ? { reason } : {}),
        ...(to === 'refused' ? { joined: this.isJoinedShare() } : {}),
      },
    })
  }

  /** Is this room a share someone else made, joined on this device? */
  private isJoinedShare(): boolean {
    if (this.cfg.joinedShare === true) return true
    return (this.cfg.provenance ?? (this.cfg.firstJoin ? 'joined' : 'local')) === 'joined'
  }

  // ---- internals ----

  private pushError(err: unknown): void {
    this.events.onError?.(err)
  }

  private recordFor(key: string): SyncRecordFields {
    return this.cfg.recordFor(key)
  }

  /**
   * `path`'s suggestion store, minted on first ask and rebuilt when the
   * guid's doc instance changes (a carve or an unshare rebuilds docs). On a
   * relay-attached mount the records live in the doc (`yRecordMap`: peers
   * see the proposal); otherwise in memory for this session.
   */
  private suggestionStore(path: string): SuggestionStore | null {
    const guid = this.guidFor(path)
    const doc = guid ? this.docs.get(guid) : undefined
    if (!guid || !doc) return null
    const held = this.suggestionStores.get(guid)
    if (held && held.doc === doc) return held.store
    held?.store.destroy()
    const store = new SuggestionStore({
      doc,
      records: this.relay ? yRecordMap(doc) : memoryRecordMap(),
      runs: this.agentRuns,
    })
    this.suggestionStores.set(guid, { doc, store })
    return store
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
    // A guid that has just appeared may be one a view is already holding open
    // (Minor 4) — this is the retry, on the one path every map change takes.
    this.markOpenPaths()
    this.events.onFiles?.(rows)
  }

  // ---- mount entries (N1, device-link-shaping A2) ----

  /** Mount roots declared in this map — the opaque boundaries (N1). */
  private mountRoots(): ReadonlySet<string> {
    // The MAP term alone: this is THIS room's declared boundaries, which is
    // what every pass over this map must skip. The mounts.json term belongs
    // to the host's ignore set (`mountRootsFrom(descs, rootMapEntries)`),
    // which covers the mirror-image window — a mount this device still runs
    // after its entry left the map. A session reading its own map wants the
    // map's answer (spike S10 Q6).
    return mountRootsFrom([], this.folderDoc.getMap().entries())
  }

  /** Is `path` at or under a mount boundary in this map? */
  private underMount(path: string, roots = this.mountRoots()): boolean {
    for (const root of roots) {
      if (path === root || path.startsWith(`${root}/`)) return true
    }
    return false
  }

  /**
   * Is `path` another session's, as of now? Under a mount boundary in this
   * map, or hidden by the adapter's live ignore set (`VaultAdapter.hides`) —
   * the only boundary a private vault's carve leaves, since it writes no
   * mount entry. Enrolment re-checks this at commit time.
   */
  private outOfReach(path: string, roots = this.mountRoots()): boolean {
    return this.underMount(path, roots) || this.adapter.hides?.(path) === true
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

  /**
   * The last seed this map was seen to carry for each mount root, kept after
   * the key itself is gone.
   *
   * The repair row exists because a concurrent rename or delete can remove a
   * mount entry; re-stating it has to put back the SAME announcement, and by
   * then the map no longer holds it. Without this the repair either published
   * a seed of its own — on a device that holds none of the room's content,
   * an empty folder doc overwriting the owner's real one — or none at all,
   * sending every fresh peer to a pull it did not need.
   */
  private seedMemory = new Map<string, string>()

  /** The seed last announced at `path`, as it travelled (base64), or undefined. */
  rememberedSeed(path: string): string | undefined {
    return this.seedMemory.get(path)
  }

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
    for (const [path, entry] of this.folderDoc.getMap().entries()) {
      if (entry.kind === 'mount' && !entry.deleted && entry.seed) {
        this.seedMemory.set(path, entry.seed)
      }
    }
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
    seed?: Uint8Array | string
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
    await this.enrollOne(path, { replace: true })
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
    // `markClosed` takes the path out of the session's open set. If a view
    // still holds it — the adopt and ghost passes close docs the shell knows
    // nothing about — the retry pass has to be free to put it back (Minor 4).
    this.markedOpen.delete(guid)
    try {
      await this.sessionRef.markClosed(guid)
      await this.refreshDiskMatch(path, guid)
    } catch (err) {
      this.pushError(err)
    }
  }

  private routeDocUpdate(guid: string, update: Uint8Array, origin: unknown): void {
    const touched = this.textTouched.delete(guid)
    const path = this.pathForGuid(guid)
    if (!path) return
    // Only a change to the note's TEXT is a text change. A comment or a
    // suggestion record (the doc's `comments` / `suggestions` maps — ours or
    // a peer's) leaves the bytes on disk as they are: re-indexing, marking
    // the note unwritten, flushing identical bytes or logging `doc.changed`
    // for it would all be lies.
    if (!touched && origin !== 'seed' && origin !== 'disk') return
    // BEFORE the origin filter: a content-change listener (the index) must see
    // 'disk' ingests — Obsidian, git and Claude Code writing the same files —
    // and 'seed' restores, or it silently drifts from the vault.
    this.emitDocChanged(guid, path, origin)
    // Attribution happens HERE, at arrival: awareness is ephemeral (E3).
    this.noteDocChange(guid, path, update, origin)
    if (origin === 'seed' || origin === 'disk') return
    this.recordFor(guid).diskMatchesCrdt = false
    if (this.openPaths.has(path)) {
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
    const conn = this.conns.get(guid)!
    conn.awareness.on('change', () => this.reportDocPresence(guid))
    this.syncHere()
    this.reportDocPresence(guid)
  }

  // ---- per-doc presence (sharing E1) ----

  /**
   * Announce `here: true` on the awareness of every doc a view holds, and
   * `false` on the rest. Every connected doc announces `user` (the provider
   * does, always-on CRDT), so `user` alone says nothing about where someone
   * IS; this flag does. Derived from `openPaths`, so it follows the same
   * refcount that closes a doc: the last view to leave clears it.
   */
  private syncHere(): void {
    if (this.conns.size === 0) return
    const held = new Set<string>()
    for (const rel of this.openPaths) {
      const guid = this.guidFor(rel)
      if (guid) held.add(guid)
    }
    for (const [guid, conn] of this.conns) {
      const here = held.has(guid)
      const local = conn.awareness.getLocalState() as { here?: boolean } | null
      if (local && (local.here === true) !== here) conn.awareness.setLocalStateField('here', here)
    }
  }

  /** Who is in one doc, ourselves excluded — `onDocPresence`. */
  private reportDocPresence(guid: string): void {
    const conn = this.conns.get(guid)
    if (!conn) {
      this.events.onDocPresence?.(guid, [])
      return
    }
    const self = conn.awareness.clientID
    const peers: DocPeer[] = []
    for (const [clientId, state] of conn.awareness.getStates()) {
      if (clientId === self) continue
      const s = state as { here?: unknown; user?: { name?: unknown }; cursor?: DocPeer['cursor'] }
      if (s.here !== true || typeof s.user?.name !== 'string' || !s.user.name) continue
      peers.push({ clientId, name: s.user.name, cursor: s.cursor ?? null })
    }
    this.events.onDocPresence?.(guid, peers)
  }

  /** Destroy every doc connection, telling the host nobody is in them any more. */
  private destroyConns(): void {
    for (const [guid, conn] of this.conns) {
      this.dropAgentPresence(guid)
      conn.destroy()
      this.events.onDocPresence?.(guid, [])
    }
    this.conns.clear()
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
      // Observers run before `update` is emitted, in the same transaction's
      // cleanup — so the flag is set by the time routeDocUpdate reads it.
      ytextOf(doc).observe(() => this.textTouched.add(guid))
      this.engine.onUpdate(doc, (update, origin) => this.routeDocUpdate(guid, update, origin))
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
      enroller: {
        candidates: (paths) => this.liveCandidates(paths),
        enrol: async (paths) => {
          await this.enrolNew(paths)
        },
        // The app's own create, attachment and import writes reach the
        // watcher before their map entry: no listing for those. Nor for a
        // file of a held or dismissed boot batch, which waits for its dialog.
        ignores: (path) => this.appWrites.has(path) || this.bootHeld(path),
      },
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
          // Level info: the review has its own demanding surface; the log is
          // its history (spike S22 Q1 "WARNINGS … each with its own surface").
          this.logEvent({
            kind: 'review.opened',
            level: 'info',
            scope: this.scopeFor(review.path),
            actor: { kind: 'app' },
            payload: { guid: review.guid, reason: review.reason },
          })
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
          // Rekey in place: a renamed file is the SAME doc still held by the
          // same view, so ownership must follow the path rather than lapse
          // (which would let the reconciler materialize over the buffer).
          for (const { from, to } of moves) {
            if (this.openPaths.delete(from)) this.openPaths.add(to)
          }
          this.events.onPathsRenamed?.(moves)
        },
        onBreaker: (paths) => this.holdBatch('watch', paths),
        onError: (err) => this.pushError(err),
      },
    })
  }

  // ---- mass-change breaker (M3): one held batch, watch- or boot-shaped ----

  /**
   * Which machinery holds what is behind the dialog (empty = nothing held).
   * More than one when a batch arrived while another was held: it joins the
   * held one rather than raising a second dialog over it, and the one confirm
   * or dismiss covers every kind here.
   */
  private heldKinds = new Set<'watch' | 'boot' | 'ghost'>()
  /** The held ghost-replay batch's work (N1) — see replayDeletes. */
  private pendingGhostBatch: (() => Promise<void>) | null = null
  /** How many paths are held, every joined batch included — what a dismissal logs. */
  private pendingBatchCount = 0

  private holdBatch(kind: 'watch' | 'boot' | 'ghost', paths: string[], apply?: () => Promise<void>): void {
    if (kind === 'ghost') {
      const before = this.pendingGhostBatch
      const next = apply ?? null
      this.pendingGhostBatch =
        before && next
          ? async () => {
              await before()
              await next()
            }
          : (next ?? before)
    }
    // Held behind BreakerDialog (its own surface), so info, like reviews.
    this.logEvent({
      kind: 'breaker.held',
      level: 'info',
      scope: this.scopeFor(),
      actor: { kind: kind === 'ghost' ? 'app' : 'disk' },
      payload: { count: paths.length },
    })
    if (this.events.onBreaker) {
      const raised = this.heldKinds.size > 0
      this.heldKinds.add(kind)
      this.pendingBatchCount += paths.length
      // One dialog at a time: a second batch is never raised over the first
      // (which would also strand the first's kind, and its confirm with it).
      if (!raised) this.events.onBreaker(paths)
    } else {
      // No host affordance (headless/tests): keep the historical auto-confirm.
      console.warn('[workspace] mass-change breaker tripped — auto-confirming', paths)
      if (kind === 'watch') void this.sessionRef?.confirmPendingBatch()
      else if (kind === 'boot') void this.confirmBootBatch()
      else void this.confirmGhostBatch()
    }
  }

  /** Apply everything held (host confirm affordance). */
  async confirmBreaker(): Promise<void> {
    const kinds = new Set(this.heldKinds)
    this.heldKinds.clear()
    this.pendingBatchCount = 0
    // The watch queue first: confirming a boot batch restarts the session.
    if (kinds.has('watch')) await this.sessionRef?.confirmPendingBatch()
    if (kinds.has('ghost')) await this.confirmGhostBatch()
    if (kinds.has('boot')) await this.confirmBootBatch()
  }

  /** Drop everything held: nothing is enrolled, ingested, or reconciled. */
  dismissBreaker(): void {
    const kinds = new Set(this.heldKinds)
    this.heldKinds.clear()
    // The log keeps what the dialog's "Not now" let go of (info, like the
    // hold: the dialog was its surface).
    if (kinds.size > 0) {
      this.logEvent({
        kind: 'breaker.dismissed',
        level: 'info',
        scope: this.scopeFor(),
        actor: { kind: kinds.size === 1 && kinds.has('ghost') ? 'app' : 'disk' },
        payload: { count: this.pendingBatchCount },
      })
    }
    this.pendingBatchCount = 0
    if (kinds.has('watch')) this.sessionRef?.dismissPendingBatch()
    if (kinds.has('boot')) this.dismissBootBatch()
    // Dismissing a ghost batch keeps the mount's files: the parent keys were
    // hard-deleted either way, so the two maps still agree (S10 Q5 row 9).
    if (kinds.has('ghost')) this.pendingGhostBatch = null
  }

  private async confirmGhostBatch(): Promise<void> {
    const batch = this.pendingGhostBatch
    this.pendingGhostBatch = null
    if (batch) await batch()
  }

  private async restartSession(): Promise<void> {
    // A watch batch still listing or enrolling on the current session runs to
    // the end first: disposed under it, its new files would be dropped (the
    // batch bails) or land in the map untracked (the new session's start()
    // predates the entry). The chain holds only listings and enrolments,
    // never a clock wait, so this is bounded; the quiesce runs off it.
    let waited = false
    for (let cur = this.sessionRef; cur?.watchBusy(); cur = this.sessionRef) {
      waited = true
      await cur.watchSettled()
    }
    if (waited && this.stopped) return
    const old = this.sessionRef
    old?.dispose()
    this.sessionRef = this.makeSession()
    // A watch batch held behind the dialog belongs to the vault, not to one
    // session instance: the new session holds it, so the dialog's confirm or
    // dismiss still reaches it.
    old?.handOverHeld(this.sessionRef)
    await this.sessionRef.start()
    // The new VaultSession starts with an empty ctx.openPaths — re-mark every
    // path a view still holds, or the first foreign update materializes over
    // a live buffer. The marks belong to the session that was just disposed,
    // so they go with it.
    this.markedOpen.clear()
    this.markOpenPaths()
  }

  // ---- relay / presence (only when a relay is attached) ----

  private reportAuthFailure(reason: string): void {
    // The message is a developer-facing diagnostic (it also rejects a join's
    // `whenSynced`); what a person reads comes from the host's i18n, keyed on
    // the error's type and `reason` (spike S22: a `relay.state` refused event).
    this.authFailure = `relay rejected this token (${reason}) — check that the share exists on the relay (share CLI / SEED_SHARE) and that the room/token match it`
    this.setRelayState('refused', reason)
    this.pushError(new RelayRefusedError(reason, this.authFailure))
  }

  private updatePresence(): void {
    if (!this.folderConn) {
      this.events.onPresence?.([])
      return
    }
    const names = new Set<string>()
    const peers = new Map<string, string | undefined>()
    const self = this.folderConn.awareness.clientID
    for (const [id, state] of this.folderConn.awareness.getStates()) {
      const user = (state as { user?: { name?: string; color?: string } }).user
      const name = user?.name
      if (!name) continue
      names.add(name)
      if (id !== self && !peers.has(name)) peers.set(name, typeof user.color === 'string' ? user.color : undefined)
    }
    this.notePeers(peers)
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
      onStatus: (status) => this.noteRelayStatus(status),
      ...(socket ? { socket } : {}),
    })
    // A shared socket that is already open never re-announces its status.
    if (this.recordFor(FOLDER_RECORD_KEY).connected) this.noteRelayStatus('connected')
    else this.armOffline()
    this.folderConn.awareness.on('change', () => this.updatePresence())
    this.folderConn.awareness.on('update', () => this.updatePresence())
    this.updatePresence()
    this.sharedLink = this.cfg.makeShareLink(this.relay, this.room)
    this.events.onShared?.(this.sharedLink)
    return this.folderConn
  }

  // ---- boot (the spike S8 Q3 machine — see header) ----

  private async boot(): Promise<void> {
    // An explicit `firstJoin` on a MOUNT outranks durable state.
    //
    // `firstJoin` normally means "there is nothing here, so pull instead of
    // enrolling", and for the ROOT that is still exactly what it means — a
    // vault reopens from its own stores, always. But a mount is handed
    // `firstJoin` by `bootFlagsFor` precisely when its desc says `neverHeld`:
    // whatever is in that namespace is not the room's content, and an
    // interrupted adopt can leave the seeded MAP there with nothing behind
    // it. `tryDurableReopen` would accept that map and the awaited pull would
    // never run — a mount showing the room's file list with none of its
    // content and nothing scheduled to fetch it.
    const pullFirst = this.cfg.firstJoin === true && (this.cfg.mountPath ?? '') !== ''
    if (!pullFirst && (await this.tryDurableReopen())) {
      this.refreshFiles()
      // Boot emission (N1): the map may already carry mount entries a peer
      // carved while this device was closed — the adopt machine's trigger
      // must not depend on having been online for the change.
      this.emitMountEntries(true)
      return
    }

    if (this.cfg.neverHeld) {
      // A mount this device has never held, with no credential yet (S10 Q2 +
      // N3), and nothing durable to reopen: boot EMPTY. The files under the
      // mount root are the room's, not ours, and minting guids for them here
      // would put this device's copies into the room at the next paste.
      //
      // Reached only when `tryDurableReopen` found nothing — a namespace that
      // DOES exist is this mount's own work from an earlier boot and is used,
      // which is what keeps "keep + mark" true across reopens (S10 Q2).
      await this.restartSession()
      this.adoptionEnabled = true
      await this.writeMountDesc()
      this.refreshFiles()
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
        this.pulledRoom = true // the room's own content is here now
      } finally {
        pull.dispose()
        this.pull = null
        this.pullPhase = null
      }
    } else if (this.relay && (this.cfg.provenance === 'adopted' || this.cfg.provenance === 'joined')) {
      // A mount whose content belongs to a ROOM, with a live credential and
      // an empty namespace, must PULL — never enrol. Reaching this branch
      // means `firstJoin` was not derived while the namespace was empty, and
      // enrolling here mints a fresh guid per file on disk and the connected
      // provider pushes them straight into the room, LWW-clobbering the
      // owner's entries. Silent, permanent, and only visible from the other
      // device.
      //
      // This is the last line of that defence, not the first: `bootFlagsFor`
      // derives `firstJoin`/`neverHeld` together everywhere a session is
      // built. It is here because the failure is invisible from this side,
      // and a rule that is only documented is a rule that holds once.
      //
      // A PROVIDER-LESS mount of the same shape is a different question and
      // gets the opposite answer — see the enrol branch below.
      this.pushError(
        new Error(
          `mount ${this.room} has no durable state and no way to fetch it — not enrolling ` +
            `the files under its root, which belong to that room (add its link to fetch them)`
        )
      )
      await this.restartSession()
      this.adoptionEnabled = true
    } else {
      // Fresh vault: enroll disk (one-time seeding). Any attached relay (the
      // memory contract's seed role) is connected but NOT awaited.
      this.connectFolder()
      // A provider-less mount for a ROOM enrols what is on disk, and says so.
      // Spike S10 Q2's "keep + mark" is a promise that the files stay visible
      // and openable while the folder waits for its key, and a folder that
      // vanishes because a token is missing is the dishonesty golden rule 4
      // forbids. But the guids minted here are this device's, not the room's,
      // so the desc is marked `neverHeld`: when the key arrives the mount
      // PULLS rather than merging, and these entries are dropped instead of
      // being pushed into the room on top of the owner's.
      this.enrolledForRoom = this.cfg.provenance === 'adopted' || this.cfg.provenance === 'joined'
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

    const threshold = this.cfg.thresholds?.massChangePaths ?? DEFAULT_THRESHOLDS.massChangePaths
    const touched = [...additions.map((s) => s.path), ...changed]
    const held = touched.length > threshold

    // Directory delta (M3): mkdirs and dir map-adds never count toward the
    // breaker. But a HELD batch's new folders are part of the batch: enrolled
    // now, they would sync to every peer empty, and a dismissed batch would
    // leave them behind. So while a batch is held, a folder that holds (or
    // sits under one that holds) a held addition waits for the confirm; a new
    // folder with no held file in it enrols at once, as before.
    this.heldDirs = held ? this.dirsOf(additions.map((s) => s.path)) : null
    await this.syncDirs()

    if (held) {
      this.pendingBootBatch = { additions: additions.map((s) => s.path), changed }
      this.pendingBootAdditions = new Set(this.pendingBootBatch.additions)
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
        if (this.dirHeld(dir, mapPaths)) continue
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

  /**
   * Paths this session is writing to disk ahead of their map entry (a new
   * note, an attachment, an import). Its own watcher reports them as unknown;
   * live enrol-on-create must leave them to the write that made them.
   */
  private readonly appWrites = new Set<string>()

  /** Held boot batch, if the mass-change breaker tripped during bootScan. */
  private pendingBootBatch: { additions: string[]; changed: string[] } | null = null
  /** The held boot batch's additions, for the live-enrol check. */
  private pendingBootAdditions: ReadonlySet<string> = new Set()
  /**
   * Additions of a boot batch dismissed this session ("Not now"): they wait
   * for the next launch's scan, so live enrolment leaves them alone too.
   */
  private readonly bootDismissed = new Set<string>()

  /** Does `path` belong to a held boot batch, or to one dismissed this session? */
  private bootHeld(path: string): boolean {
    return this.pendingBootAdditions.has(path) || this.bootDismissed.has(path)
  }

  /**
   * The new folders of a held (or dismissed) boot batch: `syncDirs` leaves
   * them out of the map until the batch is confirmed. Kept after a dismiss —
   * the batch's files wait for the next boot scan, and so do their folders.
   */
  private heldDirs: Set<string> | null = null

  /** Every ancestor folder of the given file paths. */
  private dirsOf(paths: string[]): Set<string> {
    const dirs = new Set<string>()
    for (const p of paths) {
      for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) dirs.add(p.slice(0, i))
    }
    return dirs
  }

  /**
   * Whether `dir` waits for a held boot batch: it, or a folder above it,
   * holds a held addition — unless something enrolled since lives under it
   * (a note the person made there through the app), which needs its folder.
   */
  private dirHeld(dir: string, mapPaths: Set<string>): boolean {
    const held = this.heldDirs
    if (!held || held.size === 0) return false
    let covered = held.has(dir)
    for (let i = dir.indexOf('/'); !covered && i !== -1; i = dir.indexOf('/', i + 1)) {
      covered = held.has(dir.slice(0, i))
    }
    if (!covered) return false
    const prefix = `${dir}/`
    for (const p of mapPaths) if (p.startsWith(prefix)) return false
    return true
  }

  /** Process a held boot batch: enroll additions, reconcile changed files. */
  async confirmBootBatch(): Promise<void> {
    const batch = this.pendingBootBatch
    if (!batch) return
    this.pendingBootBatch = null
    this.pendingBootAdditions = new Set()
    // Re-derive the boundaries: a mount entry can have arrived while the batch
    // sat waiting for a human, and a held batch must not enrol or reconcile
    // into a subtree whose authority has since moved (N1).
    const mountRoots = this.mountRoots()
    this.heldDirs = null
    const enrolled = await this.enrolNew(batch.additions, { batch: true })
    if (enrolled.length > 0) await this.restartSession()
    for (const path of batch.changed) {
      if (this.underMount(path, mountRoots)) continue
      const guid = this.guidFor(path)
      if (guid) await this.reconcileClosedDoc(guid, path)
    }
    this.refreshFiles()
  }

  /**
   * The files the boot scan would enrol for these watch paths (live
   * enrol-on-create, `LiveEnroller.candidates`): the same listing — so the
   * adapter's ignore set and temp-name rule apply — minus anything the map
   * already holds, other tools' scratch files (`isScratchName`, a rule the
   * boot scan does not apply) and anything under a mount boundary. A directory path
   * yields every file under it: inotify reports a populated folder moved in
   * as one event.
   */
  private async liveCandidates(paths: readonly string[]): Promise<string[]> {
    const listed = await this.adapter.list()
    // The map AFTER the listing: an app rename or create that wrote disk just
    // before its map transaction has landed it by now.
    const live = new Set(
      this.folderDoc.getMap().entries().filter(([, e]) => !e.deleted).map(([p]) => p)
    )
    const asked = new Set(paths)
    const under = paths.map((p) => `${p}/`)
    const mountRoots = this.mountRoots()
    return listed
      .map((s) => s.path)
      .filter(
        (p) =>
          !live.has(p) &&
          !this.appWrites.has(p) &&
          !this.bootHeld(p) &&
          !isScratchName(p) &&
          !this.outOfReach(p, mountRoots) &&
          (asked.has(p) || under.some((d) => p.startsWith(d)))
      )
  }

  /**
   * Enrol on-disk files that are not in the map — a confirmed boot batch, or
   * files that appeared while running (`LiveEnroller.enrol`). Their folders
   * first, so no file lands in a folder the map does not know; a path the map
   * gained meanwhile, or one under a mount boundary that arrived meanwhile,
   * is skipped (a held batch can sit for a long time). Returns what enrolled.
   * The caller makes the VaultSession track them.
   */
  private async enrolNew(paths: readonly string[], opts: { batch?: boolean } = {}): Promise<string[]> {
    if (this.stopped) return []
    const mountRoots = this.mountRoots()
    const map = this.folderDoc.getMap()
    const todo = paths.filter((p) => {
      const e = map.get(p)
      return (
        (!e || e.deleted) &&
        !this.outOfReach(p, mountRoots) &&
        !this.appWrites.has(p) &&
        // A held or dismissed boot batch's file waits for its own confirm (or
        // the next launch); only that confirm enrols it.
        (opts.batch === true || !this.bootHeld(p))
      )
    })
    if (todo.length === 0) return []
    // These files' own folders are no longer a held batch's to keep out —
    // none of them is a held file, so no held batch's folder is released
    // on a live enrol's account unless something new really lives in it.
    if (this.heldDirs) for (const d of this.dirsOf(todo)) this.heldDirs.delete(d)
    await this.syncDirs()
    const enrolled: string[] = []
    for (const path of todo) {
      if (this.appWrites.has(path)) continue
      await this.enrollOne(path, { live: true })
      const entry = map.get(path)
      if (!entry || entry.deleted) continue
      enrolled.push(path)
      // The session running NOW tracks it — which may not be the one whose
      // watcher saw the file, if a restart landed meanwhile (idempotent).
      this.sessionRef?.track(path)
      // A content listener (the index) learns the note as it would from a
      // boot: the seed transaction ran before the doc was tracked.
      if (entry.kind === 'text') this.emitDocChanged(entry.guid, path, 'seed')
    }
    this.refreshFiles()
    return enrolled
  }

  /**
   * Drop a held boot batch: nothing is enrolled or reconciled, and its new
   * files stay out until the next launch's scan, live enrolment included.
   */
  dismissBootBatch(): void {
    for (const p of this.pendingBootBatch?.additions ?? []) this.bootDismissed.add(p)
    this.pendingBootBatch = null
    this.pendingBootAdditions = new Set()
  }

  /** Enroll one on-disk file that is not in the folder map (boot delta scan). */
  private async enrollOne(path: string, opts: { live?: boolean; replace?: boolean } = {}): Promise<void> {
    // Enrolment runs beside the app's own writes and a peer's map changes: a
    // path the map has claimed by the time a step lands is not ours to
    // overwrite (adopt it) — unless replacing that entry is the point
    // (`replace`: a move-out re-enrols over a key that names the mount's
    // guid) — and a live enrol also leaves an app write in flight to the
    // write that made it.
    const claimed = (): boolean => {
      const e = this.folderDoc.getMap().get(path)
      if (e !== undefined && !e.deleted && opts.replace !== true) return true
      // Another session's now: a carve that started after this enrol listed
      // the path (a private vault's carve writes no mount entry, so the
      // adapter's live ignore set is the only boundary there).
      if (this.outOfReach(path)) return true
      return opts.live === true && this.appWrites.has(path)
    }
    try {
      const bytes = await this.adapter.read(path)
      if (bytes === null || claimed()) return
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
      if (claimed()) {
        // Lost the race to the map: undo this attempt, leave theirs alone.
        await this.discardDoc(guid, doc)
        return
      }
      this.folderDoc.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
      this.trackDoc(guid, path)
    } catch (err) {
      this.pushError(err)
    }
  }

  /** Undo a doc minted for a path that someone else's entry claimed first. */
  private async discardDoc(guid: string, doc: EngineDoc): Promise<void> {
    this.docs.delete(guid)
    this.cfg.docStore?.untrack(guid)
    await this.cfg.docStore?.remove(guid)
    await this.lcaStore.remove(guid)
    doc.destroy()
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
    // The status transition this write makes, if any — logged after it lands.
    let transition: { from?: MountStatus; to: MountStatus } | null = null
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
      const neverHeld = (existing?.neverHeld === true || this.enrolledForRoom) && !this.pulledRoom
      // A desc's first write is the mount's birth, which the host already
      // words (adopt notices, the share flow); only a CHANGE is a transition.
      if (existing && existing.status !== status) transition = { from: existing.status, to: status }
      return {
        room: this.room,
        path: this.cfg.mountPath ?? '',
        provenance,
        ...(relay ? { relay } : {}),
        status,
        ...(neverHeld ? { neverHeld: true } : {}),
      }
    })
    const t = transition as { from?: MountStatus; to: MountStatus } | null
    if (t) {
      this.logEvent({
        kind: 'mount.changed',
        level: 'info',
        scope: this.scopeFor(),
        actor: { kind: 'app' },
        payload: { what: 'status', ...(t.from ? { from: t.from } : {}), to: t.to },
      })
    }
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
 * Cap on the announced seed (spike S10 Q1), measured on the BASE64 — the form
 * that actually travels. A folder-doc entry costs roughly 80-100 bytes
 * encoded, so 64 KB is several hundred files: above it the map entry stops
 * being advisory structure and starts being a payload every peer of the parent
 * room carries forever. Over the cap the entry ships WITHOUT a seed, and a
 * peer with a token pulls the room instead (`firstJoin`) while one without
 * waits as `needs-token` over an empty namespace.
 *
 * Capping the raw update instead let 64 KB of Yjs through as 87 KB of map —
 * a third more than the budget on every peer, forever.
 */
export const MAX_SEED_BYTES = 64 * 1024

/** A `kind:'mount'` entry, with the seed when it fits (S10 Q1). */
function mountEntry(room: string, relay?: string, seed?: Uint8Array | string): FileEntry {
  const candidate = seed === undefined ? undefined : typeof seed === 'string' ? seed : encodeSeed(seed)
  const encoded = candidate !== undefined && candidate.length <= MAX_SEED_BYTES ? candidate : undefined
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

/**
 * Decode an announced seed, or null when it is not one.
 *
 * The seed arrives in a folder map any peer of the room can write, so it is
 * untrusted input: truncated base64, a stray string, a future encoding. A
 * throw here would land inside the adopt, whose caller retries it from the
 * boot pass on every open — a permanent failure loop over one bad map entry,
 * with the subtree stranded meanwhile. Null instead means "no seed", and the
 * seedless path is already a complete, safe answer: pull the room with a
 * token, wait as `needs-token` without one.
 */
function decodeSeed(seed: string): Uint8Array | null {
  try {
    const binary = atob(seed)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** A stored suggestion with the path it is read under (records are stored without one). */
/** The agent's edit must start from the text it read (`SuggestionStore.propose` re-checks when it runs). */
function checkBase(text: string, input: ProposeEditInput): void {
  if (input.from < 0 || input.to < input.from || input.to > text.length || text.slice(input.from, input.to) !== input.baseText) {
    throw new SuggestionConflictError(`the text at ${input.from}–${input.to} is not the text the agent read`)
  }
}

function withPath(record: StoredRecord, path: string): SuggestionRecord {
  return { ...record, path }
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
