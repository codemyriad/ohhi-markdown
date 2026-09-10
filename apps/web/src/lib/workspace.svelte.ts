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
 */
import type { DivergenceReview, StoreDir, VaultAdapter } from '@editor/vault'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  JsonFileLcaStore,
  lcaGuard,
  MountsFile,
  scopedAdapter,
  scopedStoreDir,
  type MountProvenance,
} from '@editor/vault'
import { createYjsEngine, type EngineDoc } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import type { CollabUser } from '@editor/editor'
import {
  carveFolder as runCarve,
  FOLDER_RECORD_KEY,
  joinMount,
  MountRegistry,
  MountSession,
  recoverMounts,
  unmountMount,
  unshareMount,
  type DocInspection,
  type FileRow,
  type MountStats,
  type RelayConfig,
} from '@editor/workspace'
import { defaultRelay, getVault, operatorSecret, roomToken, setRoomToken } from './config.js'
import { colorFor } from './params.js'
import { mintShare } from './relay-admin.js'
import { realClock } from './real-clock.js'
import { createSyncRecord, type SyncRecord } from './sync-record.svelte.js'
import { appendNotice, type Notice, type NoticeInput } from './notices.js'
import { decodeShareLink, encodeShareLink } from './share-link.js'

export { FOLDER_RECORD_KEY, type FileRow, type RelayConfig }

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
}

/** A shared subtree of this workspace, for badges/filter/share management. */
export interface MountInfo {
  /** Workspace-relative mount root ('' = the whole vault). */
  path: string
  room: string
  provenance: MountProvenance
  link: string | null
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
   * True once the ROOT mount has a relay — i.e. the whole vault is shared.
   * Reachable only by joining a whole-vault link or by the memory URL
   * contract: the app stopped offering root promotion on 2026-09-07 (folder
   * shares are the route, and a root share blocks them — spike S8's V1
   * no-nested-shares guard). Still load-bearing: the header says "shared", the
   * tree's provenance filter treats everything as shared, and the context
   * menu explains why Share… is refused on a folder.
   */
  shared: boolean
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
  /** Fold a shared mount back into the vault (files stay, sharing ends). */
  unshare(path: string): Promise<void>
  /** Drop a joined mount; its files stay and become local notes. */
  unmount(path: string): Promise<void>
  // NOTE: no root-promotion method. `MountSession.enableSharing` still exists
  // in libs/workspace (it is how a relay-attached root announces its link, and
  // libs/workspace's carve/join tests drive it), but the app no longer exposes
  // a way to promote the whole vault — see WorkspaceUi.shared.
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
    shared: false,
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
  /** Sessions currently booting before their registry.add (pruning guard). */
  let mountsBooting = 0
  /** Live mount roots the root adapter must ignore (read on every call). */
  const ignoreSet = new Set<string>()
  /** Which session owns a review's doc (resolveReview routing). */
  const reviewOwner = new Map<string, MountSession>()
  /** Which session raised the held breaker batch. */
  let breakerOwner: MountSession | null = null
  /** Per-room presence, unioned into ui.presence. */
  const presenceByRoom = new Map<string, string[]>()

  const mountsFile = new MountsFile(cfg.storeDir.io('mounts.json'))
  await recoverMounts(cfg.storeDir, mountsFile, engine)

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
        rows.push({ path: info.path, guid: `mount:${info.room}`, kind: 'dir' })
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
        onError: (err) => {
          console.error('[workspace]', err)
          notify({
            level: 'error',
            text: err instanceof Error ? err.message : String(err),
            path: opts.path || undefined,
          })
        },
      },
    })
  }

  const sessionOf = (room: string): MountSession | null =>
    registry.all().find((h) => h.session.room === room)?.session ??
    (rootSession?.room === room ? rootSession : null)

  // ---- boot every mount from mounts.json ----

  const descs = await mountsFile.load()
  for (const desc of descs) {
    if (desc.path !== '' && desc.status === 'active') ignoreSet.add(desc.path)
  }

  let rootSession: MountSession | null = null
  rootSession = await buildMount({
    room: cfg.room,
    path: '',
    provenance: 'local',
    relay: cfg.relay,
    firstJoin: cfg.firstJoin,
    onShared: () => (ui.shared = true),
  })
  registry.add('', rootSession)

  for (const desc of descs) {
    if (desc.path === '' || desc.status !== 'active') continue
    const token = roomToken(desc.room)
    if (desc.relay && !token) {
      notify({
        level: 'error',
        text: `no token stored for shared folder '${desc.path}' — rejoin it via its share link`,
        path: desc.path,
      })
    }
    const relay = desc.relay && token ? { url: desc.relay.url, token } : undefined
    const info: MountInfo = { path: desc.path, room: desc.room, provenance: desc.provenance, link: null }
    ui.mounts = [...ui.mounts, info]
    const session = await buildMount({
      room: desc.room,
      path: desc.path,
      provenance: desc.provenance,
      relay,
      onShared: (link) => {
        info.link = link
        ui.mounts = ui.mounts.map((m) => (m.room === desc.room ? { ...m, link } : m))
      },
    })
    registry.add(desc.path, session)
  }

  ui.phase = 'ready'
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
    const row = ui.files.find((f) => f.path === path)
    if (!row || row.kind !== 'dir') throw new Error('only folders can be shared')
    const resolved = registry.resolve(path)
    if (!resolved || resolved.mountPath !== '') {
      throw new Error('this folder is already inside a shared folder')
    }
    for (const m of ui.mounts) {
      if (m.path === path || m.path.startsWith(`${path}/`) || path.startsWith(`${m.path}/`)) {
        throw new Error('this folder overlaps an existing shared folder')
      }
    }
    const secret = operatorSecret()
    if (!secret) {
      throw new Error('set the relay operator secret in Settings to create shares in-app')
    }
    const relayUrl = defaultRelay()
    const room = crypto.randomUUID()
    const vaultName = getVault(cfg.room)?.name ?? 'vault'
    // Mint FIRST: a mint failure aborts with nothing persisted anywhere.
    const minted = await mintShare(relayUrl, secret, {
      folderGuid: room,
      label: `${vaultName}/${path}`,
    })
    setRoomToken(room, minted.token)

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

    const info: MountInfo = { path, room, provenance: 'carved', link: null }
    ui.mounts = [...ui.mounts, info]
    const session = await buildMount({
      room,
      path,
      provenance: 'carved',
      relay: { url: relayUrl, token: minted.token },
      onShared: (link) => {
        info.link = link
        ui.mounts = ui.mounts.map((m) => (m.room === room ? { ...m, link } : m))
      },
    })
    registry.add(path, session)
    refreshTree()
    if (reselect) select(reselect)
    return session.shareLink() ?? encodeShareLink({ relay: relayUrl, room, token: minted.token })
  }

  // ---- M5: join-as-mount, unshare/unmount, cross-mount moves ----

  const doJoinMount = async (link: string, destPath: string): Promise<void> => {
    const target = decodeShareLink(link)
    const dest = destPath.trim().replace(/^\/+|\/+$/g, '')
    if (target.room === cfg.room || ui.mounts.some((m) => m.room === target.room)) {
      throw new Error('this share is already part of this vault')
    }
    const info: MountInfo = { path: dest, room: target.room, provenance: 'joined', link: null }
    let added = false
    try {
      const session = await joinMount({
        vaultDir: cfg.storeDir,
        mountsFile,
        root: rootSession!,
        baseAdapter: cfg.adapter,
        existingMountPaths: ui.mounts.map((m) => m.path),
        mountPath: dest,
        room: target.room,
        addIgnore: (p) => ignoreSet.add(p),
        removeIgnore: (p) => ignoreSet.delete(p),
        buildSession: () => {
          // Visible (with its badge row) while the pull runs.
          ui.mounts = [...ui.mounts, info]
          added = true
          return buildMount({
            room: target.room,
            path: dest,
            provenance: 'joined',
            relay: { url: target.relay, token: target.token },
            firstJoin: true,
            onShared: (l) => {
              info.link = l
              ui.mounts = ui.mounts.map((m) => (m.room === target.room ? { ...m, link: l } : m))
            },
          })
        },
      })
      setRoomToken(target.room, target.token)
      registry.add(dest, session)
      refreshTree()
    } catch (err) {
      if (added) ui.mounts = ui.mounts.filter((m) => m.room !== target.room)
      refreshTree()
      throw err
    }
  }

  /** Rebuild the root session from its (surgically updated) durable stores. */
  const rebuildRoot = async (): Promise<void> => {
    rootSession = await buildMount({
      room: cfg.room,
      path: '',
      provenance: 'local',
      onShared: () => (ui.shared = true),
    })
    registry.add('', rootSession)
  }

  const mountAt = (path: string): MountInfo => {
    const info = ui.mounts.find((m) => m.path === path)
    if (!info) throw new Error(`'${path}' is not a shared folder`)
    return info
  }

  const dropSelectionUnder = (path: string): void => {
    if (ui.selectedPath && (ui.selectedPath === path || ui.selectedPath.startsWith(`${path}/`))) {
      select(null)
    }
  }

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
    ui.mounts = ui.mounts.filter((m) => m.room !== info.room)
    await rebuildRoot()
    refreshTree()
  }

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
    ui.mounts = ui.mounts.filter((m) => m.room !== info.room)
    // The files are on disk and newly visible to the root — enroll them now
    // (a big folder legitimately trips the breaker dialog here).
    await rootSession!.rescan()
    refreshTree()
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
      if (bytes === null) throw new Error(`cannot read ${from}`)
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
      const r = registry.resolve(from)
      const rTo = registry.resolve(to)
      if (!r || !rTo) return
      if (r.session !== rTo.session) {
        // Cross-mount: the caller must route through movePath (confirm first).
        notify({ level: 'error', text: 'moving across shared-folder boundaries needs the move confirmation', path: from })
        return
      }
      await r.session.renamePath(r.rel, rTo.rel)
    },
    movePath: doMovePath,
    isCrossMount,
    deletePath: async (path) => {
      const r = registry.resolve(path)
      if (r) await r.session.deletePath(r.rel)
    },
    resolveReview: (guid, mergedText) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveReview(guid, mergedText),
    resolveVanished: (guid, action) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveVanished(guid, action),
    addShareMount: doJoinMount,
    unshare: doUnshare,
    unmount: doUnmount,
    carveFolder: doCarve,
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
