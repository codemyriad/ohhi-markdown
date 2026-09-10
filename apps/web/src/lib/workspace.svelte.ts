/**
 * Svelte shim over @editor/workspace: the host-neutral orchestration lives in
 * MountSession (libs/workspace — one mount = one vault subtree bound to a
 * room); this module owns only the reactive view state. It builds the $state
 * ui object, injects stable per-guid record factories, mirrors session events
 * into runes, and preserves the public Workspace surface App.svelte renders.
 *
 * Multi-mount (M4): the workspace boots EVERY mount in mounts.json — the root
 * mount over an ignoringAdapter (a live set of mount roots) plus one
 * MountSession per carved/joined mount over a scopedAdapter — and routes all
 * per-path operations through the registry's longest-prefix resolve.
 * carveFolder() runs the spike S8 Q1 state machine: mint (caller-supplied
 * secret via config), statuses in mounts.json, seed → detach → activate, then
 * mounts the new session live. Tokens live in config only (never in descs).
 *
 * Nested mounts, depth 1 (N1, device-link-shaping A2/A3/A5): the root mount
 * may be relay-attached, so a carve or a join inside it ANNOUNCES itself as a
 * `kind:'mount'` entry in the root map, and this shim runs the peer side of
 * that announcement — `reconcileMountEntries` from libs/workspace, wired to
 * the root's live mount-entry hook and to a boot pass. Two derived things
 * follow: the ignore set is `mounts.json ∪ the root map's mount entries`
 * (recomputed, never accumulated), and `ui.mounts` is a projection of
 * mounts.json, so a mount being adopted, waiting for a key, or folded back
 * says so rather than appearing and disappearing.
 */
import { getLL } from '@editor/i18n'
import type { DivergenceReview, StoreDir, VaultAdapter } from '@editor/vault'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  isRecoverable,
  JsonFileLcaStore,
  lcaGuard,
  MountsFile,
  mountRootsFrom,
  scopedAdapter,
  scopedStoreDir,
  type MountDesc,
  type MountProvenance,
  type MountStatus,
} from '@editor/vault'
import { createYjsEngine, type EngineDoc } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import type { CollabUser } from '@editor/editor'
import {
  activateMount,
  bootFlagsFor,
  carveFolder as runCarve,
  resolveRoomRelay,
  FOLDER_RECORD_KEY,
  joinMount,
  MountRegistry,
  MountSession,
  reconcileMountEntries,
  recoverMounts,
  unmountMount,
  unshareMount,
  type AdoptContext,
  type AdoptNotice,
  type DocInspection,
  type FileRow,
  type MountStats,
  type PullProgress,
  type RelayConfig,
} from '@editor/workspace'
import {
  defaultRelay,
  getVault,
  upsertVault,
  grantsForBundle,
  operatorSecret,
  purgeRooms,
  roomRelay,
  roomToken,
  roomTokenKind,
  setRoomToken,
} from './config.js'
import { colorFor } from './params.js'
import { mintShare } from './relay-admin.js'
import { realClock } from './real-clock.js'
import { createSyncRecord, type SyncRecord } from './sync-record.svelte.js'
import { appendNotice, type Notice, type NoticeInput } from './notices.js'
import { decodeShareLink, encodeDeviceLink, encodeShareLink, type ShareKind } from './share-link.js'
import { isForeignMount } from './share-status.js'

export { resolveRoomRelay }
export { FOLDER_RECORD_KEY, type FileRow, type PullProgress, type RelayConfig }

/**
 * The index's write side, as the workspace needs it. Structurally
 * `IndexWriter` from @editor/index minus `rebuild` — typed here so
 * libs/workspace stays index-agnostic and the app owns the wiring.
 */
export interface IndexSink {
  upsert(doc: { guid: string; path: string; text: string }): void
  remove(guid: string): void
  rename(guid: string, path: string): void
}

export interface WorkspaceConfig {
  adapter: VaultAdapter
  /** The vault's durable store namespace (spike S8 layout; Mem for memory mode). */
  storeDir: StoreDir
  user: string
  /** Root folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /** Bootstrap by pulling the relay room when no durable state exists (see boot.ts). */
  firstJoin?: boolean
  /** Present → connect the ROOT mount to the relay (background, except a firstJoin pull). */
  relay?: RelayConfig
  /** Seed demo notes before enrolling — memory demo / e2e only. */
  seedDemo?: boolean
  /**
   * Kept in step with every text doc in every mount (V2b). Fed from the file
   * list (creates/deletes/renames) and from MountEvents.onDocChanged, which
   * fires for local, remote AND disk-origin edits — so the index sees
   * Obsidian, git and Claude Code writing the same files.
   */
  index?: IndexSink
  /**
   * First-join progress for the ROOT mount, reported BEFORE this promise
   * resolves (device-link N2). `ui.pull` carries the same value, but a linked
   * device spends its whole first minute inside `setupWorkspace` — there is no
   * `ui` to read yet, so the panel is fed through here and told `null` when
   * the boot is done.
   */
  onPull?: (progress: PullProgress | null) => void
}

/** A shared subtree of this workspace, for badges/filter/share management. */
/**
 * UI-facing mount state (device-link N1). 'needs-token' = a mount whose
 * stores exist but this device holds no token: a fully functional LOCAL
 * mount that knows where its room lives — never rendered as "offline"
 * (spike S10 Q2). 'adopting' / 'absorbing' = the peer-side machines running.
 */
export type MountUiStatus = 'active' | 'needs-token' | 'adopting' | 'absorbing'

export interface MountInfo {
  /** Workspace-relative mount root ('' = the whole vault). */
  path: string
  room: string
  provenance: MountProvenance
  link: string | null
  status: MountUiStatus
  /**
   * Someone ELSE's share, mounted here — as opposed to a folder of this vault
   * shared by you (device-link N2, the gap share-status.ts recorded in N1).
   * See `isForeignMount`: a joined mount is always foreign; an adopted one is
   * foreign when its room lives on a relay other than this vault's.
   */
  foreign: boolean
}

/**
 * `resolveRoomRelay` is re-exported, not defined here.
 *
 * The rule — exact token ▸ the vault's DEVICE token for a room on the vault's
 * OWN relay ▸ nothing — lives in `libs/workspace/src/resolve-relay.ts` so the
 * device-link harness can drive the same function instead of paraphrasing it.
 * It had paraphrased it, with raw `===` on the relay URLs, so a trailing
 * slash made two different answers to the one question that decides who gets
 * a credential. Re-exported here because this module is where the shell's
 * tests reach for it, and because the binding below is what a vault actually
 * uses.
 */

/**
 * A relay refusal on an ADOPTED mount is a MISSING KEY, not a broken relay
 * (A1's second half — device-link N3's residual case).
 *
 * `resolveRoomRelay` can still hand the vault's device token to one kind of
 * mount that will be refused: an adopted share that is somebody ELSE'S but
 * happens to live on this vault's own relay — the case `isForeignMount`
 * documents as its honest limit, since only the relay's ancestry edge knows
 * the difference and the client cannot query it. Without this the mount sits
 * in a permanent error at status `active`: "shared, not syncing", forever,
 * with no action offered. Golden rule 4 forbids exactly that. Degrading to
 * `needs-token` is the honest reading — a fully functional LOCAL mount that
 * knows where its room lives and offers "Add link…" — and one paste fixes it.
 *
 * Only `adopted`: a `joined` or `carved` mount was given its exact token by
 * this device, so a refusal there means the share was revoked or deleted, and
 * "the relay said no" is the true story to leave on screen.
 *
 * Matched on `MountSession.reportAuthFailure`'s wording, which is the only
 * signal a session surfaces for an auth outcome today.
 */
export function isAuthRefusalForAdoptedMount(
  desc: { provenance: MountProvenance; status: MountStatus } | undefined,
  err: unknown
): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (!message.includes('relay rejected this token')) return false
  return !!desc && desc.provenance === 'adopted' && desc.status !== 'needs-token'
}

export interface WorkspaceUi {
  phase: 'connecting' | 'ready'
  /** Session notice log, newest first (chrome U5). Replaces the one overwritten error string. */
  notices: Notice[]
  files: FileRow[]
  /** Names online anywhere in this workspace (the union of every room). */
  presence: string[]
  /** Names online per room, so the shell can say WHICH shared folder someone is in (chrome U4). */
  presenceByRoom: Record<string, string[]>
  reviews: DivergenceReview[]
  selectedPath: string | null
  /** Per-doc sync records keyed by doc GUID (+ per-mount folder keys) — guids are rename-stable (M3). */
  records: Record<string, SyncRecord>
  /**
   * True once the ROOT mount has a relay — the whole vault syncs to this
   * person's own devices. It is *device linking*, not sharing (device-link
   * N2, decision 2): the copy reads "Synced to your devices", never "shared",
   * because sharing is what you do with other people, folder by folder
   * (dogfood decision #8 stands). Set by `linkDevice()`, by joining a device
   * link, or by the memory URL contract.
   *
   * Load-bearing beyond the copy: the tree's provenance filter treats
   * everything as relay-backed, and the rollup is fed by every doc.
   */
  linked: boolean
  /**
   * A first join in flight (root mount), else null — the two-phase panel's
   * whole input. Cleared when the boot resolves.
   */
  pull: PullProgress | null
  /** Shared subtrees (carved/joined mounts), excluding the root mount. */
  mounts: MountInfo[]
  /** Held mass-change batch awaiting confirm/dismiss (M3), else null. */
  breaker: { paths: string[] } | null
}

export interface Workspace {
  ui: WorkspaceUi
  user: CollabUser
  room: string
  /** Record a notice for the session (the shell toasts new ones and lists them in Activity). */
  notify(input: NoticeInput): void
  docForPath(path: string): EngineDoc | null
  awarenessForPath(path: string): Awareness | null
  select(path: string | null): void
  /**
   * Create a note inside `dir` ('' = vault root) and select it. With no
   * `name` the note is auto-named `untitled-N.md`; with one it is created at
   * that path (wikilink create-on-click, daily notes). An existing note at
   * that path is opened, not overwritten.
   */
  createFile(dir?: string, name?: string, text?: string): Promise<void>
  createDir(path: string): Promise<void>
  /** Rename or move a file/folder WITHIN one mount (same shared scope). */
  renamePath(from: string, to: string): Promise<void>
  /**
   * Move across mounts (spike S8 Q5): copy bytes into the target mount with
   * a FRESH guid, then tombstone the source (peers of the source room see a
   * delete). The confirm affordance is the caller's job.
   */
  movePath(from: string, to: string): Promise<void>
  /** Do `from` and `to` live in different mounts (needs the move confirm)? */
  isCrossMount(from: string, to: string): boolean
  deletePath(path: string): Promise<void>
  resolveReview(guid: string, mergedText: string): Promise<void>
  /** Resolve a 'vanished' review: restore from CRDT or confirm the removal. */
  resolveVanished(guid: string, action: 'restore' | 'remove'): Promise<void>
  /** Join a share link as a mount at `destPath` (empty/new folder). */
  addShareMount(link: string, destPath: string): Promise<void>
  /**
   * Paste a share link for an existing `needs-token` mount at `path` (spike
   * S10 Q2): stores the token and activates the mount in place — no re-seed.
   * The link's room must equal the mount's room; otherwise refused with the
   * reason.
   */
  addMountLink(path: string, link: string): Promise<void>
  /** Fold a shared mount back into the vault (files stay, sharing ends). */
  unshare(path: string): Promise<void>
  /** Drop a joined mount; its files stay and become local notes. */
  unmount(path: string): Promise<void>
  /**
   * Link a device (device-link-shaping A1, slice N2): mint a `kind:'device'`
   * token for the ROOT room, attach the root to the relay if it is not
   * already, and return the copyable link — the root token plus the grants
   * this device holds for its mounts (A4-B), so shared folders arrive already
   * connected on the other device.
   *
   * The ONE place the root is promoted. It is not "share this vault": a
   * device link is a full-access credential for one person's own devices, and
   * the copy beside it says so (R5).
   */
  linkDevice(label: string): Promise<string>
  /**
   * Carve `path` (a folder of the root mount) into its own shared mount:
   * mints a token (operator secret from Settings), runs the spike S8 Q1
   * machine, mounts the new session. Returns the copyable share link.
   */
  carveFolder(path: string): Promise<string>
  confirmBreaker(): Promise<void>
  dismissBreaker(): void
  /** Read-only devtools inspection of one file (M6); null for unknown/binary/dir. */
  inspect(path: string): Promise<WorkspaceInspection | null>
  /** Read-only per-mount devtools counts (root mount included). */
  mountStats(): Promise<MountStats[]>
  /**
   * Read a file from Editor's own `.editor/` directory in the vault (custom
   * themes today). Deliberately narrow: the vault adapters IGNORE `.editor/`,
   * so it is invisible to enrollment, the tree and sync — but it is still
   * inside the vault, so it travels with the folder. Returns null when absent.
   */
  readAppFile(path: string): Promise<string | null>
  dispose(): void
}

/** DocInspection plus which mount owns the path (workspace-level view). */
export interface WorkspaceInspection extends DocInspection {
  mount: { path: string; room: string }
}

function seedDemoFiles(adapter: VaultAdapter): Promise<void[]> {
  const enc = new TextEncoder()
  const welcome = [
    '# Welcome to Editor',
    '',
    'This is the V1 tracer-bullet vault. Everything you type here lands in a',
    'CRDT and syncs through the relay to anyone else in the room.',
    '',
    'Kill the relay and keep typing — the pill goes offline honestly and the',
    'edits exchange on reconnect.',
    '',
  ].join('\n')
  const ideas = [
    '# Ideas',
    '',
    '- wikilinks land in V2',
    '- live preview later, plain markdown first',
    '- the pill never lies',
    '',
  ].join('\n')
  // Fake PNG: magic bytes plus a null byte so looksBinary() flags it even
  // without the extension check.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x42, 0x17, 0x99])
  return Promise.all([
    adapter.writeAtomic('notes/welcome.md', enc.encode(welcome)),
    adapter.writeAtomic('notes/ideas.md', enc.encode(ideas)),
    adapter.writeAtomic('notes/img.png', png),
  ])
}

export async function setupWorkspace(cfg: WorkspaceConfig): Promise<Workspace> {
  const ui = $state<WorkspaceUi>({
    phase: 'connecting',
    notices: [],
    files: [],
    presence: [],
    presenceByRoom: {},
    reviews: [],
    selectedPath: null,
    records: {},
    linked: false,
    pull: null,
    mounts: [],
    breaker: null,
  })

  const notify = (input: NoticeInput): void => {
    ui.notices = appendNotice(ui.notices, input, Date.now())
  }

  const user: CollabUser = { name: cfg.user, color: colorFor(cfg.user) }
  const engine = createYjsEngine()

  if (cfg.seedDemo) await seedDemoFiles(cfg.adapter)

  /** Stable per-key $state record — providers/session mutate it in place. */
  const recordFor = (key: string): SyncRecord => {
    let rec = ui.records[key]
    if (!rec) {
      rec = createSyncRecord()
      ui.records[key] = rec
    }
    return rec
  }

  const registry = new MountRegistry()
  /**
   * The root mount. Declared here, before anything derived from it: the ignore
   * set reads the root's map on every refresh, and the FIRST refresh happens
   * during boot, before the session exists.
   */
  let rootSession: MountSession | null = null
  /** Sessions currently booting before their registry.add (pruning guard). */
  let mountsBooting = 0
  /**
   * Live mount roots the root adapter must ignore. Derived, never accumulated:
   * `mounts.json ∪ the root map's kind:'mount' entries` (spike S10 Q6). Both
   * terms are load-bearing and in opposite directions — the map term covers
   * the window between a peer's carve landing and this device writing a desc
   * (which is exactly when a boot delta scan would re-enrol the subtree), the
   * desc term covers the mirror-image window in an absorb. MUTATED IN PLACE,
   * never reassigned: ignoringAdapter closes over this object and consults it
   * on every call, including inside the watch callback.
   */
  const ignoreSet = new Set<string>()
  /** Copyable link per room, kept across mount-list rebuilds. */
  const linkByRoom = new Map<string, string>()
  /** Which session owns a review's doc (resolveReview routing). */
  const reviewOwner = new Map<string, MountSession>()
  /** Which session raised the held breaker batch. */
  let breakerOwner: MountSession | null = null
  /** Per-room presence, unioned into ui.presence. */
  const presenceByRoom = new Map<string, string[]>()

  /**
   * The ROOT mount's relay. Mutable because `linkDevice()` attaches one to a
   * vault that booted without: `rebuildRoot` (unshare/absorb surgery) reads
   * this, and a root that quietly lost its relay would stop announcing carves
   * and stop hearing peers — sync state lying by omission (N1's rule, N2's
   * new way of reaching it).
   */
  let rootRelay: RelayConfig | undefined = cfg.relay

  const mountsFile = new MountsFile(cfg.storeDir.io('mounts.json'))
  await recoverMounts(cfg.storeDir, mountsFile, engine)

  /** mounts.json as this shim last read it (the ignore set's first term). */
  let descs: MountDesc[] = await mountsFile.load()

  /** A desc's lifecycle status, as the tree and rail say it (N1). */
  const uiStatus = (status: MountStatus): MountUiStatus => {
    if (status === 'needs-token') return 'needs-token'
    if (status === 'active') return 'active'
    if (status === 'absorbing' || status.startsWith('unsharing:')) return 'absorbing'
    return 'adopting' // carving:* / joining / adopting:* — a mount being made
  }

  const refreshIgnore = (): void => {
    const next = mountRootsFrom(descs, rootSession?.mapEntries() ?? [])
    ignoreSet.clear()
    for (const p of next) ignoreSet.add(p)
  }

  /**
   * This vault's own relay — the one its rooms are minted on. A mount whose
   * room lives somewhere else is somebody else's share (see isForeignMount).
   */
  const rootRelayUrl = (): string => rootRelay?.url || roomRelay(cfg.room) || defaultRelay()

  /** ui.mounts is a projection of mounts.json — statuses included. */
  const refreshMounts = (): void => {
    const rootRelay = rootRelayUrl()
    ui.mounts = descs
      .filter((d) => d.path !== '')
      .map((d) => ({
        path: d.path,
        room: d.room,
        provenance: d.provenance,
        link: linkByRoom.get(d.room) ?? null,
        status: uiStatus(d.status),
        foreign: isForeignMount(
          { provenance: d.provenance, relay: d.relay?.url || roomRelay(d.room) },
          rootRelay
        ),
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Re-read the mount table after any lifecycle write, then re-derive. */
  const reloadMounts = async (): Promise<void> => {
    descs = await mountsFile.load()
    refreshIgnore()
    refreshMounts()
  }

  /** guid → path, as the index last saw it. Drives the create/delete/rename diff. */
  const indexed = new Map<string, string>()

  /**
   * Reconcile the index's document set with the tree.
   *
   * Text is read from the doc (in-memory Y.Text), never from disk: every
   * enrolled text file has a live doc for the whole session, so this costs no
   * I/O. Directories and binaries have no doc and are deliberately absent.
   */
  const syncIndexRows = (rows: FileRow[]): void => {
    const sink = cfg.index
    if (!sink) return
    const live = new Map<string, string>()
    for (const row of rows) {
      if (row.kind !== 'text') continue
      live.set(row.guid, row.path)
      const was = indexed.get(row.guid)
      if (was === row.path) continue
      if (was === undefined) {
        const doc = resolveDoc(row.path)
        // A row can appear before its doc instance exists — a carve or an
        // unshare destroys and rebuilds every doc in a mount, and refreshTree
        // can run in between. Skip it rather than indexing empty text and
        // recording it as done: the next refresh (or the doc's first change)
        // picks it up with real content.
        if (!doc) continue
        sink.upsert({ guid: row.guid, path: row.path, text: doc.getText() })
      } else {
        // Same guid, new path: a rename. Keep the derived text, move the path
        // — re-deriving would drop nothing but cost a full re-tokenize.
        sink.rename(row.guid, row.path)
      }
      indexed.set(row.guid, row.path)
    }
    for (const guid of [...indexed.keys()]) {
      if (live.has(guid)) continue
      sink.remove(guid)
      indexed.delete(guid)
    }
  }

  const resolveDoc = (path: string): EngineDoc | null => {
    const r = registry.resolve(path)
    return r ? r.session.docForPath(r.rel) : null
  }

  const refreshTree = (): void => {
    const rows = registry.files()
    // A mount root with no children is invisible in the merged rows (its own
    // map is subtree-relative) — synthesize its dir row so the tree always
    // shows the shared folder.
    for (const info of ui.mounts) {
      if (!rows.some((r) => r.path === info.path)) {
        // 'mount', not 'dir' (N1): inside a relay-attached root this row comes
        // from the parent map as a mount entry, and a mount root should not
        // change kind depending on whether the vault happens to be shared.
        rows.push({ path: info.path, guid: `mount:${info.room}`, kind: 'mount' })
      }
    }
    rows.sort((a, b) => a.path.localeCompare(b.path))
    ui.files = rows
    syncIndexRows(rows)
    // Records exist for every text row before the tree renders pills for them.
    for (const row of rows) if (row.kind === 'text') recordFor(row.guid)
    // Prune records for guids that no longer exist (deletes) so the global
    // rollup never aggregates a dead file's stale status. NEVER while any
    // session boots outside the registry (initial boot, a carve's new mount):
    // pruning then orphans record objects its providers already captured.
    if (ui.phase === 'ready' && mountsBooting === 0) {
      const live = new Set(rows.map((r) => r.guid))
      // Folder records live per room; prune the ones for dead rooms too (an
      // unshared mount's stale offline record would pin the global pill).
      const liveRooms = new Set([cfg.room, ...ui.mounts.map((m) => m.room)])
      for (const key of Object.keys(ui.records)) {
        if (key.startsWith('//folder')) {
          const room = key.slice('//folder:'.length)
          if (key !== FOLDER_RECORD_KEY && !liveRooms.has(room)) delete ui.records[key]
        } else if (!live.has(key)) {
          delete ui.records[key]
        }
      }
    }
  }

  const refreshPresence = (): void => {
    const names = new Set<string>()
    for (const list of presenceByRoom.values()) for (const n of list) names.add(n)
    ui.presence = [...names].sort()
    ui.presenceByRoom = Object.fromEntries(
      [...presenceByRoom.entries()].map(([room, list]) => [room, [...list].sort()])
    )
  }

  interface MountOpts {
    room: string
    path: string
    provenance: MountProvenance
    relay?: RelayConfig
    firstJoin?: boolean
    /**
     * Boot with an empty map and no delta scan: a mount this device has never
     * held and has no key for. Its files stay on disk, untouched and
     * unmanaged, until a paste turns it into a firstJoin (spike S10 Q2 + N3).
     */
    neverHeld?: boolean
    /** Progress for a pull a person is waiting on (the paste). */
    onPullProgress?: (progress: PullProgress) => void
    onShared?: (link: string) => void
  }

  const buildMount = async (opts: MountOpts): Promise<MountSession> => {
    mountsBooting++
    try {
      return await buildMountInner(opts)
    } finally {
      mountsBooting--
    }
  }

  const buildMountInner = (opts: MountOpts): Promise<MountSession> => {
    const mountDir = scopedStoreDir(cfg.storeDir, `${opts.room}/`)
    const docStore = new BlobDocStore(engine, mountDir, realClock)
    const lcaStore = lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json')))
    const journal = new FileJournal(mountDir, { now: () => realClock.now() })
    const adapter =
      opts.path === ''
        ? ignoringAdapter(cfg.adapter, ignoreSet)
        : scopedAdapter(cfg.adapter, opts.path)
    const prefixMoves = (moves: { from: string; to: string }[]) =>
      opts.path === '' ? moves : moves.map((m) => ({ from: `${opts.path}/${m.from}`, to: `${opts.path}/${m.to}` }))
    return MountSession.create({
      engine,
      adapter,
      user,
      room: opts.room,
      firstJoin: opts.firstJoin,
      neverHeld: opts.neverHeld,
      relay: opts.relay,
      clock: realClock,
      lcaStore,
      journal,
      docStore,
      mountsFile,
      mountPath: opts.path,
      provenance: opts.provenance,
      // Folder records are per mount; every other key is a globally unique guid.
      recordFor: (key) => recordFor(key === FOLDER_RECORD_KEY ? `//folder:${opts.room}` : key),
      makeShareLink: (relay, room) => encodeShareLink({ relay: relay.url, room, token: relay.token }),
      events: {
        onFiles: () => refreshTree(),
        onDocChanged: (guid, path) => {
          if (!cfg.index) return
          const full = opts.path === '' ? path : `${opts.path}/${path}`
          const doc = resolveDoc(full)
          if (!doc) return
          cfg.index.upsert({ guid, path: full, text: doc.getText() })
          indexed.set(guid, full)
        },
        onPathsRenamed: (moves) => {
          for (const { from, to } of prefixMoves(moves)) {
            if (ui.selectedPath === from) ui.selectedPath = to
          }
        },
        onBreaker: (paths) => {
          breakerOwner = sessionOf(opts.room)
          ui.breaker = {
            paths: opts.path === '' ? paths : paths.map((p) => `${opts.path}/${p}`),
          }
        },
        onPresence: (names) => {
          presenceByRoom.set(opts.room, names)
          refreshPresence()
        },
        onReview: (review) => {
          const owner = sessionOf(opts.room)
          if (owner) reviewOwner.set(review.guid, owner)
          ui.reviews = [...ui.reviews.filter((r) => r.guid !== review.guid), review]
        },
        onReviewCleared: (guid) => {
          reviewOwner.delete(guid)
          ui.reviews = ui.reviews.filter((r) => r.guid !== guid)
        },
        onShared: (link) => opts.onShared?.(link),
        // A nested mount's own pull, when someone is waiting on it (the paste
        // — `activateMount`). The root's own line below wins for the root.
        ...(opts.onPullProgress ? { onPullProgress: opts.onPullProgress } : {}),
        ...(opts.path === ''
          ? {
              // The two-phase first-join line (N2). Root only: this is the
              // whole-vault pull the joiner stares at, and it is reported
              // BEFORE setupWorkspace resolves — hence the config callback
              // alongside the ui field. A nested mount's own pull gets its own
              // line later (spike S10 Q4, acceptance note on Q1 step 6).
              onPullProgress: (progress) => {
                ui.pull = progress
                cfg.onPull?.(progress)
              },
              // Synchronous, inside the observer: the derived ignore set must
              // hide a mount root the instant a peer announces it, not at the
              // end of the adopt (spike S10 Q6).
              onMapChanged: () => refreshIgnore(),
              // The adopt machine's LIVE entry point. The session queues this
              // on its map-work chain AHEAD of its own map scan, and awaits
              // the promise — so no scan adopts the guids an adopt is moving.
              onMountEntries: () => (adoptReady ? runReconcile() : undefined),
            }
          : {}),
        onError: (err) => {
          console.error('[workspace]', err)
          notify({
            level: 'error',
            text: err instanceof Error ? err.message : String(err),
            path: opts.path || undefined,
          })
          // A relay refusal on an adopted mount is a missing key: degrade the
          // mount honestly instead of leaving it 'active' and permanently
          // broken (A1's second half — see degradeOnAuthRefusal).
          degradeOnAuthRefusal(opts.room, err)
        },
      },
    })
  }

  const sessionOf = (room: string): MountSession | null =>
    registry.all().find((h) => h.session.room === room)?.session ??
    (rootSession?.room === room ? rootSession : null)

  // ---- the peer-side adopt / absorb machine (N1) ----

  /** False until the first boot finishes: the machine needs a live root. */
  let adoptReady = false

  const adoptNotice = (n: AdoptNotice): void => {
    const t = getLL().web.workspace
    switch (n.kind) {
      case 'needs-token':
        notify({ level: 'warn', text: t.no_token({ path: n.path }), path: n.path })
        return
      case 'depth-limit':
        notify({ level: 'warn', text: getLL().web.mounts.reason.depth_limit({ path: n.path }), path: n.path })
        return
      case 'mount-moved':
        notify({ level: 'info', text: getLL().web.mounts.reason.mount_moved({ path: n.path }), path: n.path })
        return
      case 'room-repointed':
        notify({
          level: 'warn',
          text: getLL().web.mounts.reason.room_repointed({ path: n.path }),
          path: n.path,
        })
        return
      default:
        return // adopted / absorbed / adopt-cancelled: the tree says it
    }
  }

  const adoptContext = (): AdoptContext => ({
    vaultDir: cfg.storeDir,
    mountsFile,
    engine,
    root: () => rootSession!,
    rootRoom: cfg.room,
    mounts: () =>
      new Map(
        registry
          .all()
          .filter((h) => h.mountPath !== '')
          .map((h) => [h.mountPath, h.session])
      ),
    relayFor: relayForRoom,
    buildSession: (o) =>
      buildMount({
        room: o.room,
        path: o.path,
        provenance: o.provenance,
        ...(o.relay ? { relay: o.relay } : {}),
        ...(o.firstJoin ? { firstJoin: true } : {}),
        ...(o.neverHeld ? { neverHeld: true } : {}),
        ...(o.onPullProgress ? { onPullProgress: o.onPullProgress } : {}),
        onShared: (link) => {
          linkByRoom.set(o.room, link)
          refreshMounts()
        },
      }),
    attachMount: (path, session) => {
      registry.add(path, session)
      refreshTree()
    },
    detachMount: (path) => {
      const resolved = registry.resolve(path)
      const session = resolved?.mountPath === path ? resolved.session : null
      registry.remove(path)
      return session
    },
    withRootDown: async (fn) => {
      registry.remove('')
      await rootSession!.shutdown()
      await fn()
      await rebuildRoot()
    },
    refreshIgnore: reloadMounts,
    notify: adoptNotice,
  })

  /** One pass at a time: the live hook and the boot pass share this chain. */
  let adoptWork: Promise<void> = Promise.resolve()
  const runReconcile = (): Promise<void> => {
    adoptWork = adoptWork
      .then(() => reconcileMountEntries(adoptContext()))
      .then(() => reloadMounts())
      .then(() => refreshTree())
      .catch((err) => {
        console.error('[workspace] mount reconcile', err)
        notify({ level: 'error', text: err instanceof Error ? err.message : String(err) })
      })
    return adoptWork
  }

  // ---- boot every mount from mounts.json ----

  /** `resolveRoomRelay` bound to this vault's config (see the rule above it). */
  const relayForRoom = (m: {
    room: string
    relay?: string
    provenance: MountProvenance
  }): RelayConfig | null =>
    resolveRoomRelay({
      url: m.relay || roomRelay(m.room) || defaultRelay(),
      provenance: m.provenance,
      exactToken: roomToken(m.room),
      rootToken: roomToken(cfg.room),
      rootTokenKind: roomTokenKind(cfg.room),
      rootRelayUrl: rootRelayUrl(),
    })

  /** `isAuthRefusalForAdoptedMount` + the status write it implies (A1). */
  const degradeOnAuthRefusal = (room: string, err: unknown): void => {
    if (!isAuthRefusalForAdoptedMount(descs.find((d) => d.room === room), err)) return
    void mountsFile
      .setStatus(room, 'needs-token')
      .then(() => reloadMounts())
      .then(() => refreshTree())
      .catch((e) => console.error('[workspace]', e))
  }

  refreshIgnore()
  rootSession = await buildMount({
    room: cfg.room,
    path: '',
    provenance: 'local',
    relay: rootRelay,
    firstJoin: cfg.firstJoin,
    onShared: () => (ui.linked = true),
  })
  registry.add('', rootSession)
  refreshIgnore()

  for (const desc of descs) {
    // Settled mounts only: an interrupted one was already rolled back or
    // forward by recoverMounts, and a duplicate path is a re-point that
    // crashed mid-swap — the map names the winner, so leave the other alone
    // (the boot pass below resolves it).
    if (desc.path === '' || isRecoverable(desc.status)) continue
    if (registry.resolve(desc.path)?.mountPath === desc.path) continue
    const relay = desc.relay
      ? relayForRoom({ room: desc.room, relay: desc.relay.url, provenance: desc.provenance })
      : null
    if (!relay && desc.provenance !== 'local') {
      // No credential — because none is held, or because nothing anywhere
      // says where the room lives. Both are the same state to a person and
      // the same action fixes them: paste the link, which carries the relay
      // URL as well as the token.
      //
      // Statusing only the `desc.relay && !relay` half left the other one
      // sitting at `active` with no relay: the tree drew it as a shared
      // folder and `mountHasRelay` counted it into the sync rollup, which
      // then reported the whole vault offline because a mount that can never
      // connect never does. Sync state that lies (golden rule 4).
      if (desc.status !== 'needs-token') await mountsFile.setStatus(desc.room, 'needs-token')
      notify({
        level: 'warn',
        text: getLL().web.workspace.no_token({ path: desc.path }),
        path: desc.path,
      })
    }
    const session = await buildMount({
      room: desc.room,
      path: desc.path,
      provenance: desc.provenance,
      ...(relay ? { relay } : {}),
      // Never held: PULL with a credential, wait empty without one — derived
      // together, because the third combination (neither flag) drops an
      // adopted mount into the fresh-vault enrol and mints new guids for the
      // room's own files (N3's empty-adopt finding).
      ...bootFlagsFor(desc, relay),
      onShared: (link) => {
        linkByRoom.set(desc.room, link)
        refreshMounts()
      },
    })
    registry.add(desc.path, session)
  }
  await reloadMounts()

  // The adopt machine's BOOT pass (spike S10 Q1, entry point 2): after
  // recoverMounts and after the root has restored its folder blob, join the
  // root map's mount entries against mounts.json. This is what gives a device
  // that was closed during a peer's carve its trigger on reopen — and what
  // turns an `adopting:seeding` rollback into a retry rather than a subtree
  // stranded in the wrong namespace.
  adoptReady = true
  await runReconcile()

  ui.phase = 'ready'
  ui.pull = null
  cfg.onPull?.(null)
  refreshTree()

  /** The session (if any) currently holding an open path. */
  let openIn: MountSession | null = null

  const select = (path: string | null): void => {
    if (ui.selectedPath === path) return
    ui.selectedPath = path // before flush routing so prev counts as closed
    const resolved = path ? registry.resolve(path) : null
    if (openIn && openIn !== resolved?.session) openIn.setOpenPath(null)
    if (resolved) {
      resolved.session.setOpenPath(resolved.rel)
      openIn = resolved.session
    } else {
      openIn = null
    }
  }

  const doCarve = async (path: string): Promise<string> => {
    const t = getLL().web.workspace
    const row = ui.files.find((f) => f.path === path)
    // A mount root is already its own share — sharing it again would be a
    // mount inside a mount, which depth 1 forbids.
    if (row?.kind === 'mount') throw new Error(t.overlaps())
    if (!row || row.kind !== 'dir') throw new Error(t.only_folders())
    const resolved = registry.resolve(path)
    if (!resolved || resolved.mountPath !== '') {
      throw new Error(t.inside_shared())
    }
    for (const m of ui.mounts) {
      if (m.path === path || m.path.startsWith(`${path}/`) || path.startsWith(`${m.path}/`)) {
        throw new Error(t.overlaps())
      }
    }
    // ui.mounts is what THIS device runs; the root map is what everyone
    // agreed. A folder another peer carved seconds ago is a mount entry here
    // before it is a desc, and carving into it would make a mount inside a
    // mount on every device (spike S10 Q5 row 11's prevention-at-the-source).
    for (const entry of rootSession!.mountEntries()) {
      if (
        entry.path === path ||
        entry.path.startsWith(`${path}/`) ||
        path.startsWith(`${entry.path}/`)
      ) {
        throw new Error(t.overlaps())
      }
    }
    const secret = operatorSecret()
    if (!secret) {
      throw new Error(t.needs_secret())
    }
    const relayUrl = defaultRelay()
    const room = crypto.randomUUID()
    const vaultName = getVault(cfg.room)?.name ?? 'vault'
    // Mint FIRST: a mint failure aborts with nothing persisted anywhere.
    const minted = await mintShare(relayUrl, secret, {
      folderGuid: room,
      label: `${vaultName}/${path}`,
      // Ancestry, ALWAYS — not only when this vault is relay-attached
      // (spike S10 Q3). The edge is advisory structure, not a credential, and
      // recording it now is what lets a device linked LATER connect to a
      // folder carved EARLIER without a paste.
      parent: cfg.room,
    })
    setRoomToken(room, minted.token, relayUrl, 'folder')

    // The carve destroys the root's doc instances for the subtree — release
    // any editor holding one, and re-select through the new mount after.
    const reselect =
      ui.selectedPath && (ui.selectedPath === path || ui.selectedPath.startsWith(`${path}/`))
        ? ui.selectedPath
        : null
    if (reselect) select(null)

    await runCarve({
      root: rootSession!,
      vaultDir: cfg.storeDir,
      mountsFile,
      mountPath: path,
      room,
      relayUrl,
      addIgnore: (prefix) => ignoreSet.add(prefix),
    })

    await reloadMounts()
    const session = await buildMount({
      room,
      path,
      provenance: 'carved',
      relay: { url: relayUrl, token: minted.token },
      onShared: (link) => {
        linkByRoom.set(room, link)
        refreshMounts()
      },
    })
    registry.add(path, session)
    await reloadMounts()
    refreshTree()
    if (reselect) select(reselect)
    return session.shareLink() ?? encodeShareLink({ relay: relayUrl, room, token: minted.token })
  }

  /**
   * Above this many held tokens the bundle stops being a link and starts
   * being a payload (spike S10 Q7 §Size): emit the device link WITHOUT
   * grants and say so — the ancestry grant (A4-A) covers this vault's own
   * carves anyway, and a foreign share costs one paste.
   */
  const MAX_BUNDLED_GRANTS = 50

  /**
   * Link a device (A1 + A4-B). Mint a DEVICE token for the root room, promote
   * the root to relay-attached if it is not already — the one place that
   * happens — remember the credential, and hand back the link with the grants
   * this device holds. R5 lives in the copy beside the link, not here.
   */
  const doLinkDevice = async (label: string): Promise<string> => {
    const t = getLL().web.workspace
    const secret = operatorSecret()
    if (!secret) throw new Error(t.needs_secret())
    const relayUrl = rootRelayUrl()
    const vaultName = getVault(cfg.room)?.name ?? 'vault'
    // Mint FIRST: a failure leaves nothing promoted and nothing persisted.
    const minted = await mintShare(relayUrl, secret, {
      folderGuid: cfg.room,
      kind: 'device',
      label: label.trim() || vaultName,
    })
    setRoomToken(cfg.room, minted.token, relayUrl, 'device')
    const relay: RelayConfig = { url: relayUrl, token: minted.token }
    rootRelay = relay
    if (!rootSession!.isShared()) {
      rootSession!.enableSharing(relay)
      ui.linked = true
    }
    // The next boot reads the root's relay off the VAULT ENTRY (boot.ts), not
    // off mounts.json — without this the link works for one session and the
    // vault reopens unlinked.
    const entry = getVault(cfg.room)
    if (entry) upsertVault({ ...entry, relay })
    refreshMounts()
    // The codec drops a grant for the link's own room, so the root token is
    // never doubled; a device that holds too many is told, never truncated.
    const held = grantsForBundle().filter((g) => g.room !== cfg.room)
    const tooMany = held.length > MAX_BUNDLED_GRANTS
    if (tooMany) {
      notify({ level: 'warn', text: getLL().web.device_link.too_many_grants({ count: held.length }) })
    }
    return encodeDeviceLink({
      relay: relayUrl,
      room: cfg.room,
      token: minted.token,
      grants: tooMany ? [] : held,
    })
  }

  // ---- M5: join-as-mount, unshare/unmount, cross-mount moves ----

  /**
   * "Add a shared folder here…": join someone's FOLDER share as a subtree.
   *
   * Two refusals before anything is persisted:
   *
   *  - a DEVICE link is not a folder share (A2, R5). It is a full-access key
   *    to a whole vault; joining it here would mount a vault inside a vault
   *    and store a device-kind credential for a non-root room. It has its own
   *    route — "Link this device…" in the vault manager — and the dictionary
   *    says so in those words.
   *  - a destination at or under a `kind:'mount'` entry in the ROOT MAP (M10),
   *    the guard `doCarve` has had since N1. `ui.mounts` is what THIS device
   *    runs; the map is what every peer of the root agreed, and a folder
   *    another of this person's devices carved seconds ago is a mount entry
   *    here before it is a desc. Joining into it would make a mount inside a
   *    mount on every device (spike S10 Q5 row 11).
   *
   * Grants are NOT merged here, and that is deliberate: a folder link carries
   * none (the codec refuses them, R5), so `mergeGrants` on this path could
   * only ever act on a device link — the very thing the first refusal now
   * rejects. Grants belong to the device-link join.
   */
  const doJoinMount = async (link: string, destPath: string): Promise<void> => {
    const target = decodeShareLink(link)
    const dest = destPath.trim().replace(/^\/+|\/+$/g, '')
    if (target.kind !== 'folder') {
      throw new Error(getLL().web.mounts.dialog.device_link_refused())
    }
    if (target.room === cfg.room || ui.mounts.some((m) => m.room === target.room)) {
      throw new Error(getLL().web.workspace.already_joined())
    }
    const mapEntries = rootSession!.mountEntries()
    for (const entry of mapEntries) {
      if (
        dest === entry.path ||
        dest.startsWith(`${entry.path}/`) ||
        entry.path.startsWith(`${dest}/`)
      ) {
        throw new Error(getLL().web.workspace.overlaps())
      }
    }
    try {
      const session = await joinMount({
        vaultDir: cfg.storeDir,
        mountsFile,
        root: rootSession!,
        baseAdapter: cfg.adapter,
        existingMountPaths: ui.mounts.map((m) => m.path),
        mapEntries,
        mountPath: dest,
        room: target.room,
        // The FOREIGN relay: inside a shared root the destination detach
        // announces this mount to the root's peers, and they must be told
        // where it actually lives (spike S10 Q7).
        relayUrl: target.relay,
        addIgnore: (p) => ignoreSet.add(p),
        removeIgnore: (p) => ignoreSet.delete(p),
        buildSession: async () => {
          // Visible (with its badge row) while the pull runs: the 'joining'
          // desc renders as a mount being made.
          await reloadMounts()
          return buildMount({
            room: target.room,
            path: dest,
            provenance: 'joined',
            relay: { url: target.relay, token: target.token },
            firstJoin: true,
            onShared: (l) => {
              linkByRoom.set(target.room, l)
              refreshMounts()
            },
          })
        },
      })
      setRoomToken(target.room, target.token, target.relay, 'folder')
      registry.add(dest, session)
      await reloadMounts()
      refreshTree()
    } catch (err) {
      await reloadMounts()
      refreshTree()
      throw err
    }
  }

  /**
   * Rebuild the root session from its (surgically updated) durable stores.
   * The relay goes back on (N1): a rebuilt root that quietly lost it would
   * stop announcing carves and stop hearing peers — sync state that lies by
   * omission, and the mechanism the whole nested-mount machine rides on.
   */
  const rebuildRoot = async (): Promise<void> => {
    rootSession = await buildMount({
      room: cfg.room,
      path: '',
      provenance: 'local',
      ...(rootRelay ? { relay: rootRelay } : {}),
      onShared: () => (ui.linked = true),
    })
    registry.add('', rootSession)
    refreshIgnore()
  }

  const mountAt = (path: string): MountInfo => {
    const info = ui.mounts.find((m) => m.path === path)
    if (!info) throw new Error(getLL().web.workspace.not_shared({ path }))
    return info
  }

  const dropSelectionUnder = (path: string): void => {
    if (ui.selectedPath && (ui.selectedPath === path || ui.selectedPath.startsWith(`${path}/`))) {
      select(null)
    }
  }

  /**
   * Stop sharing a folder this vault owns: the room is DISSOLVED and its
   * content folds back into the root.
   *
   * The credential goes with it (A4). `tokensByRoom`/`relayByRoom` used to
   * keep the room's bearer token forever, which is a live key to a room this
   * vault no longer has any relationship with — it would ride out in the next
   * device link's `grants` bundle, and a mount entry that re-named the room
   * would find an "exact token" waiting and reconnect without a paste.
   * `purgeRooms` drops the token, the relay URL and the remembered link.
   */
  const doUnshare = async (path: string): Promise<void> => {
    const info = mountAt(path)
    dropSelectionUnder(path)
    const mount = registry.resolve(path)!.session
    // Both sessions leave the registry before the stop-the-world surgery.
    registry.remove(path)
    registry.remove('')
    await unshareMount({
      vaultDir: cfg.storeDir,
      mountsFile,
      engine,
      rootRoom: cfg.room,
      desc: { room: info.room, path },
      mount,
      root: rootSession!,
      removeIgnore: (p) => ignoreSet.delete(p),
    })
    purgeRooms([info.room])
    linkByRoom.delete(info.room)
    await rebuildRoot()
    await reloadMounts()
    refreshTree()
  }

  /**
   * Drop someone else's share from THIS device (the room lives on without
   * us). Same credential rule as unshare (A4): this device gave the share up,
   * so it keeps no key for it — otherwise the token outlives the mount in
   * config, travels in the next device link's grants, and silently
   * reconnects the room the moment an entry for it reappears. Re-joining is
   * one paste of the link the sharer still holds.
   */
  const doUnmount = async (path: string): Promise<void> => {
    const info = mountAt(path)
    dropSelectionUnder(path)
    const mount = registry.resolve(path)!.session
    registry.remove(path)
    await unmountMount({
      vaultDir: cfg.storeDir,
      mountsFile,
      engine,
      rootRoom: cfg.room,
      desc: { room: info.room, path },
      mount,
      removeIgnore: (p) => ignoreSet.delete(p),
    })
    purgeRooms([info.room])
    linkByRoom.delete(info.room)
    await reloadMounts()
    // The files are on disk and newly visible to the root — enroll them now
    // (a big folder legitimately trips the breaker dialog here).
    await rootSession!.rescan()
    refreshTree()
  }

  /**
   * Paste the link for a mount this device holds but has no key for (spike
   * S10 Q2, A4-C).
   *
   * The RULE — merge in place through `enableSharing`, or rebuild as a
   * `firstJoin` and pull — is `activateMount` in libs/workspace, not this
   * shim: it is a lifecycle machine with a durable status and a rollback, and
   * the N3 device-link harness drives the same one, so the two cannot drift.
   * It also picks the branch on `MountDesc.neverHeld` rather than on "does
   * this session list any files", which was wrong in the direction that loses
   * data — see the header of `activate.ts`.
   *
   * What stays here is the shell's half: decoding the link, refusing the wrong
   * kind of link, storing the token, the registry, and the progress line.
   *
   * A DEVICE link is refused (R5, the same rule `doJoinMount` applies): a
   * device token is a credential for a whole vault that the relay also honours
   * in rooms carved out of it, and storing one against a single folder's room
   * would file vault-wide access under a folder — where `relayForRoom`'s
   * exact-match rule would then hand it to that room, and the next device
   * link's `grants` bundle would carry it onward. Grants are not merged here
   * for the same reason: a folder link carries none (the codec refuses them),
   * so merging could only ever act on the link this refusal rejects.
   */
  const doAddMountLink = async (path: string, link: string): Promise<void> => {
    const t = getLL().web.workspace
    const info = ui.mounts.find((m) => m.path === path)
    if (!info) throw new Error(t.not_shared({ path }))
    const target = decodeShareLink(link)
    if (target.kind !== 'folder') {
      throw new Error(getLL().web.mounts.dialog.device_link_refused())
    }
    if (target.room !== info.room) {
      throw new Error(getLL().web.mounts.dialog.wrong_room({ path }))
    }
    const resolved = registry.resolve(path)
    const session = resolved?.mountPath === path ? resolved.session : null
    const desc = descs.find((d) => d.room === info.room && d.path === path)
    if (!session || !desc) throw new Error(t.not_shared({ path }))

    setRoomToken(target.room, target.token, target.relay, target.kind)

    try {
      await activateMount({
        vaultDir: cfg.storeDir,
        mountsFile,
        desc,
        session,
        relay: { url: target.relay, token: target.token },
        buildSession: (o) =>
          buildMount({
            room: o.room,
            path: o.path,
            provenance: o.provenance,
            ...(o.relay ? { relay: o.relay } : {}),
            ...(o.firstJoin ? { firstJoin: true } : {}),
            ...(o.neverHeld ? { neverHeld: true } : {}),
            ...(o.onPullProgress ? { onPullProgress: o.onPullProgress } : {}),
            onShared: (l) => {
              linkByRoom.set(info.room, l)
              refreshMounts()
            },
          }),
        detachMount: (p) => registry.remove(p),
        attachMount: (p, next) => registry.add(p, next),
        // The pull is awaited and can take a while on a real vault (spike S10
        // Q4), so it gets the same two-phase line a whole-vault link gets.
        onPullProgress: (progress) => {
          ui.pull = progress
          cfg.onPull?.(progress)
        },
      })
    } finally {
      ui.pull = null
      await reloadMounts()
      refreshTree()
    }
  }

  const isCrossMount = (from: string, to: string): boolean => {
    const a = registry.resolve(from)
    const b = registry.resolve(to)
    return !!a && !!b && a.session !== b.session
  }

  const doMovePath = async (from: string, to: string): Promise<void> => {
    const src = registry.resolve(from)
    const dst = registry.resolve(to)
    if (!src || !dst) return
    if (src.session === dst.session) {
      await src.session.renamePath(src.rel, dst.rel)
      return
    }
    dropSelectionUnder(from)
    const row = ui.files.find((f) => f.path === from)
    if (!row) return
    if (row.kind === 'mount') {
      throw new Error(getLL().web.mounts.reason.mount_root_move({ path: from }))
    }
    // Import into the target FIRST, tombstone the source after — a crash in
    // between leaves a visible duplicate (both journaled), never a loss.
    if (row.kind === 'dir') {
      const childPrefix = `${from}/`
      const children = ui.files.filter((f) => f.path.startsWith(childPrefix))
      const rebase = (p: string): string => `${dst.rel}${p.slice(from.length)}`
      await dst.session.createDir(dst.rel)
      for (const child of children.filter((c) => c.kind === 'dir')) {
        await dst.session.createDir(rebase(child.path))
      }
      for (const child of children.filter((c) => c.kind !== 'dir')) {
        const bytes = await src.session.readFileBytes(child.path.slice(src.mountPath ? src.mountPath.length + 1 : 0))
        if (bytes) await dst.session.importFile(rebase(child.path), bytes)
      }
    } else {
      const bytes = await src.session.readFileBytes(src.rel)
      if (bytes === null) throw new Error(getLL().web.workspace.cannot_read({ path: from }))
      await dst.session.importFile(dst.rel, bytes)
    }
    await src.session.deletePath(src.rel)
    refreshTree()
  }

  return {
    ui,
    notify,
    user,
    room: cfg.room,
    docForPath: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.docForPath(r.rel) : null
    },
    awarenessForPath: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.awarenessForPath(r.rel) : null
    },
    select,
    createFile: async (dir = '', name, text) => {
      // Route on the FULL TARGET PATH, never on `dir` alone. A prefixed name
      // (`[[team/plan]]` → name='team/plan.md', dir='') targets a path that a
      // carved mount may own; routing by `dir` sent it to the root session,
      // whose adapter is pass-through, so the bytes landed inside the mount's
      // directory while the map entry went into the root room — two rooms,
      // two guids, two LCAs over one file on disk.
      const target = name ? (dir ? `${dir}/${name}` : name) : dir
      const r = target ? registry.resolve(target) : null
      const owner = r?.session ?? rootSession!
      const mountPath = r?.mountPath ?? ''
      // The owner speaks mount-relative paths: split the resolved target back
      // into (dir, name) in its own space.
      let relDir = ''
      let relName = name
      if (name) {
        const rel = r ? r.rel : target
        const cut = rel.lastIndexOf('/')
        relDir = cut === -1 ? '' : rel.slice(0, cut)
        relName = cut === -1 ? rel : rel.slice(cut + 1)
      } else {
        relDir = r ? r.rel : dir
      }
      const path = await owner.createFile(relDir, relName, text)
      if (path) select(mountPath ? `${mountPath}/${path}` : path)
    },
    createDir: async (path) => {
      const r = registry.resolve(path)
      if (r) await r.session.createDir(r.rel)
    },
    renamePath: async (from, to) => {
      if (ui.files.find((f) => f.path === from)?.kind === 'mount') {
        throw new Error(getLL().web.mounts.reason.mount_root_rename({ path: from }))
      }
      const r = registry.resolve(from)
      const rTo = registry.resolve(to)
      if (!r || !rTo) return
      if (r.session !== rTo.session) {
        // Cross-mount: the caller must route through movePath (confirm first).
        notify({ level: 'error', text: getLL().web.workspace.cross_mount_move(), path: from })
        return
      }
      await r.session.renamePath(r.rel, rTo.rel)
    },
    movePath: doMovePath,
    isCrossMount,
    deletePath: async (path) => {
      if (ui.files.find((f) => f.path === path)?.kind === 'mount') {
        throw new Error(getLL().web.mounts.reason.mount_root_delete({ path }))
      }
      const r = registry.resolve(path)
      if (r) await r.session.deletePath(r.rel)
    },
    resolveReview: (guid, mergedText) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveReview(guid, mergedText),
    resolveVanished: (guid, action) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveVanished(guid, action),
    addShareMount: doJoinMount,
    addMountLink: doAddMountLink,
    unshare: doUnshare,
    unmount: doUnmount,
    carveFolder: doCarve,
    linkDevice: doLinkDevice,
    confirmBreaker: async () => {
      ui.breaker = null
      await (breakerOwner ?? rootSession!).confirmBreaker()
      breakerOwner = null
    },
    dismissBreaker: () => {
      ui.breaker = null
      ;(breakerOwner ?? rootSession!).dismissBreaker()
      breakerOwner = null
    },
    inspect: async (path) => {
      const r = registry.resolve(path)
      if (!r) return null
      const insp = await r.session.inspectPath(r.rel)
      // Report the workspace-level path, not the mount-relative one.
      return insp ? { ...insp, path, mount: { path: r.mountPath, room: r.session.room } } : null
    },
    mountStats: () => Promise.all(registry.all().map((h) => h.session.mountStats())),
    readAppFile: async (path) => {
      const rel = path.replace(/^\/+/, '')
      if (!rel.startsWith('.editor/')) throw new Error('readAppFile is for .editor/ only')
      const bytes = await cfg.adapter.read(rel)
      return bytes ? new TextDecoder().decode(bytes) : null
    },
    dispose: () => registry.dispose(),
  }
}
