/**
 * Svelte shim over @editor/workspace: the host-neutral orchestration lives in
 * MountSession (libs/workspace — one mount = one vault subtree bound to a
 * room); this module owns only the reactive view state. It builds the $state
 * ui object, injects a stable per-path record factory (MountSession and its
 * providers mutate those $state records in place), mirrors session events
 * into runes, and preserves the public Workspace surface App.svelte renders.
 *
 * V1 shape: a MountRegistry booted with exactly ONE root mount (''), so
 * behavior matches the single-vault shell; carve/join flows (dogfood-shaping
 * M4/M5) add more mounts later. Multi-mount notes for that work:
 *   - record keys and ui.files rows are mount-relative today (root '' makes
 *     them workspace paths); prefix per-mount when a second mount lands.
 *   - resolveReview routes to the root session; reviews will need a
 *     guid→mount route once N mounts exist.
 */
import type { DivergenceReview, StoreDir, VaultAdapter } from '@editor/vault'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  MountsFile,
  scopedStoreDir,
} from '@editor/vault'
import { createYjsEngine, type EngineDoc } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import type { CollabUser } from '@editor/editor'
import {
  FOLDER_RECORD_KEY,
  MountRegistry,
  MountSession,
  recoverMounts,
  type FileRow,
  type RelayConfig,
} from '@editor/workspace'
import { colorFor } from './params.js'
import { realClock } from './real-clock.js'
import { createSyncRecord, type SyncRecord } from './sync-record.svelte.js'
import { encodeShareLink } from './share-link.js'

export { FOLDER_RECORD_KEY, type FileRow, type RelayConfig }

export interface WorkspaceConfig {
  adapter: VaultAdapter
  /** The vault's durable store namespace (spike S8 layout; Mem for memory mode). */
  storeDir: StoreDir
  user: string
  /** Folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /** Bootstrap by pulling the relay room when no durable state exists (see boot.ts). */
  firstJoin?: boolean
  /** Present → connect to the relay (background, except a firstJoin pull). */
  relay?: RelayConfig
  /** Seed demo notes before enrolling — memory demo / e2e only. */
  seedDemo?: boolean
}

export interface WorkspaceUi {
  phase: 'connecting' | 'ready'
  error: string
  files: FileRow[]
  presence: string[]
  reviews: DivergenceReview[]
  selectedPath: string | null
  /** Per-doc sync records keyed by doc GUID (+ FOLDER_RECORD_KEY) — guids are rename-stable (M3). */
  records: Record<string, SyncRecord>
  /** True once a relay is attached (via join or enableSharing). */
  shared: boolean
  /** The copyable share link, once this folder is shared. */
  shareLink: string | null
  /** Held mass-change batch awaiting confirm/dismiss (M3), else null. */
  breaker: { paths: string[] } | null
}

export interface Workspace {
  ui: WorkspaceUi
  user: CollabUser
  room: string
  docForPath(path: string): EngineDoc | null
  awarenessForPath(path: string): Awareness | null
  select(path: string | null): void
  /** Create an untitled note inside `dir` ('' = vault root) and select it. */
  createFile(dir?: string): Promise<void>
  createDir(path: string): Promise<void>
  /** Rename or move a file/folder (move = rename to another parent). */
  renamePath(from: string, to: string): Promise<void>
  deletePath(path: string): Promise<void>
  resolveReview(guid: string, mergedText: string): Promise<void>
  /** Promote a local vault to a shared one; returns the copyable link. */
  enableSharing(relay: RelayConfig): { link: string }
  confirmBreaker(): Promise<void>
  dismissBreaker(): void
  dispose(): void
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
    error: '',
    files: [],
    presence: [],
    reviews: [],
    selectedPath: null,
    records: {},
    shared: false,
    shareLink: null,
    breaker: null,
  })

  const user: CollabUser = { name: cfg.user, color: colorFor(cfg.user) }
  const engine = createYjsEngine()

  if (cfg.seedDemo) await seedDemoFiles(cfg.adapter)

  /** Stable per-path $state record — providers/session mutate it in place. */
  const recordFor = (path: string): SyncRecord => {
    let rec = ui.records[path]
    if (!rec) {
      rec = createSyncRecord()
      ui.records[path] = rec
    }
    return rec
  }

  // Durable stores (spike S8 layout): the vault dir holds mounts.json plus a
  // `<room>/` namespace per mount. Invariant D is enforced once, here, by
  // wrapping the LCA store — session, reconciler, and enrollment inherit it.
  const mountsFile = new MountsFile(cfg.storeDir.io('mounts.json'))
  await recoverMounts(cfg.storeDir, mountsFile)
  const mountDir = scopedStoreDir(cfg.storeDir, `${cfg.room}/`)
  const docStore = new BlobDocStore(engine, mountDir, realClock)
  const lcaStore = lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json')))
  const journal = new FileJournal(mountDir, { now: () => realClock.now() })

  const session = await MountSession.create({
    engine,
    adapter: cfg.adapter,
    user,
    room: cfg.room,
    firstJoin: cfg.firstJoin,
    relay: cfg.relay,
    clock: realClock,
    lcaStore,
    journal,
    docStore,
    mountsFile,
    recordFor,
    makeShareLink: (relay, room) => encodeShareLink({ relay: relay.url, room, token: relay.token }),
    events: {
      onFiles: (rows) => {
        ui.files = rows
        // Prune records for guids that no longer exist (deletes) so the
        // global rollup never aggregates a dead file's stale status. Records
        // are keyed by GUID (rename-stable), so renames never re-key.
        const live = new Set(rows.map((r) => r.guid))
        for (const key of Object.keys(ui.records)) {
          if (key !== FOLDER_RECORD_KEY && !live.has(key)) delete ui.records[key]
        }
      },
      onPathsRenamed: (moves) => {
        for (const { from, to } of moves) {
          if (ui.selectedPath === from) ui.selectedPath = to
        }
      },
      onBreaker: (paths) => {
        ui.breaker = { paths }
      },
      onPresence: (names) => {
        ui.presence = names
      },
      onReview: (review) => {
        ui.reviews = [...ui.reviews.filter((r) => r.guid !== review.guid), review]
      },
      onReviewCleared: (guid) => {
        ui.reviews = ui.reviews.filter((r) => r.guid !== guid)
      },
      onShared: (link) => {
        ui.shared = true
        ui.shareLink = link
      },
      onError: (err) => {
        console.error('[workspace]', err)
        ui.error = err instanceof Error ? err.message : String(err)
      },
    },
  })

  const registry = new MountRegistry()
  registry.add('', session)

  ui.phase = 'ready'

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

  return {
    ui,
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
    createFile: async (dir = '') => {
      // '' = vault root → the root mount; otherwise the dir's owning mount.
      const r = dir ? registry.resolve(dir) : null
      const path = r ? await r.session.createFile(r.rel) : await session.createFile(dir)
      if (path) select(r && path ? (r.mountPath ? `${r.mountPath}/${path}` : path) : path)
    },
    createDir: async (path) => {
      const r = registry.resolve(path)
      if (r) await r.session.createDir(r.rel)
    },
    renamePath: async (from, to) => {
      const r = registry.resolve(from)
      const rTo = registry.resolve(to)
      if (!r || !rTo || r.session !== rTo.session) {
        // Cross-mount moves are spike S8 Q5 territory (slice M5).
        ui.error = 'cannot move across shared-folder boundaries yet'
        return
      }
      await r.session.renamePath(r.rel, rTo.rel)
    },
    deletePath: async (path) => {
      const r = registry.resolve(path)
      if (r) await r.session.deletePath(r.rel)
    },
    resolveReview: (guid, mergedText) => session.resolveReview(guid, mergedText),
    enableSharing: (relay) => session.enableSharing(relay),
    confirmBreaker: async () => {
      ui.breaker = null
      await session.confirmBreaker()
    },
    dismissBreaker: () => {
      ui.breaker = null
      session.dismissBreaker()
    },
    dispose: () => registry.dispose(),
  }
}
