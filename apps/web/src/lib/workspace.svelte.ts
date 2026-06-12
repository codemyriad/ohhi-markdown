/**
 * Workspace wiring for the V1 dev shell: in-memory vault + engine docs +
 * one relay provider per doc + a VaultSession reconciling "disk" (the
 * MemVaultAdapter) against the CRDTs. Drives everything App.svelte renders.
 *
 * Origin note (verified against @hocuspocus/provider 4.1.2): provider-applied
 * updates carry the provider INSTANCE as origin, not the seam's 'remote'
 * string, so VaultSession's own remote-origin listeners never fire here.
 * This module routes doc updates and folder-map adoption itself, and only
 * filters out the seam string origins it can trust ('seed' from enrollment,
 * 'disk' from reconciler ingest).
 */
import type { DivergenceReview, VaultAdapter } from '@editor/vault'
import {
  decodeFile,
  enrollFolder,
  hashBytes,
  joinFolder,
  MemJournal,
  MemLcaStore,
  NEVER_ON_DISK,
  VaultSession,
} from '@editor/vault'
import { createYjsEngine, type EngineDoc, type FileEntry } from '@editor/sync'
import type { Awareness } from 'y-protocols/awareness'
import type { CollabUser } from '@editor/editor'
import { colorFor, type MemoryModeConfig } from './params.js'
import { connectDoc, whenSynced, type DocConnection } from './providers.js'
import { realClock } from './real-clock.js'
import { createSyncRecord, type SyncRecord } from './sync-record.svelte.js'
import { createVaultAdapter } from './vault-adapter.js'

/** records key for the folder doc ('//' is impossible in a vault path). */
export const FOLDER_RECORD_KEY = '//folder'

const FLUSH_DEBOUNCE_MS = 800
const CLOSED_RECONCILE_MS = 200

export interface FileRow {
  path: string
  guid: string
  kind: 'text' | 'binary'
}

export interface WorkspaceUi {
  phase: 'connecting' | 'ready'
  error: string
  files: FileRow[]
  presence: string[]
  reviews: DivergenceReview[]
  selectedPath: string | null
  /** Per-doc sync records keyed by path (+ FOLDER_RECORD_KEY). */
  records: Record<string, SyncRecord>
}

export interface Workspace {
  ui: WorkspaceUi
  user: CollabUser
  role: 'seed' | 'join'
  docForPath(path: string): EngineDoc | null
  awarenessForPath(path: string): Awareness | null
  select(path: string | null): void
  createFile(): Promise<void>
  resolveReview(guid: string, mergedText: string): Promise<void>
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

export async function setupWorkspace(cfg: MemoryModeConfig): Promise<Workspace> {
  const ui = $state<WorkspaceUi>({
    phase: 'connecting',
    error: '',
    files: [],
    presence: [],
    reviews: [],
    selectedPath: null,
    records: {},
  })

  const user: CollabUser = { name: cfg.user, color: colorFor(cfg.user) }
  const engine = createYjsEngine()
  const adapter = createVaultAdapter(cfg.mode)
  const lcaStore = new MemLcaStore()
  const journal = new MemJournal(() => realClock.now())
  const folderDoc = engine.createDoc(`${cfg.room}/folder`)
  const docs = new Map<string, EngineDoc>()
  const conns = new Map<string, DocConnection>()
  const debounces = new Map<string, () => void>()

  let sessionRef: VaultSession | null = null
  let adoptionEnabled = false
  let mapWork: Promise<void> = Promise.resolve()

  const pushError = (err: unknown): void => {
    console.error('[workspace]', err)
    ui.error = err instanceof Error ? err.message : String(err)
  }

  const recordForPath = (path: string): SyncRecord => {
    let rec = ui.records[path]
    if (!rec) {
      rec = createSyncRecord()
      ui.records[path] = rec
    }
    return rec
  }

  const guidFor = (path: string): string | null => {
    const entry = folderDoc.getMap().get(path)
    return entry && entry.kind === 'text' && !entry.deleted ? entry.guid : null
  }

  const pathForGuid = (guid: string): string | null => {
    for (const [path, entry] of folderDoc.getMap().entries()) {
      if (entry.guid === guid && !entry.deleted) return path
    }
    return null
  }

  const refreshFiles = (): void => {
    ui.files = folderDoc
      .getMap()
      .entries()
      .filter(([, e]) => !e.deleted)
      .map(([path, e]) => ({ path, guid: e.guid, kind: e.kind }))
      .sort((a, b) => a.path.localeCompare(b.path))
    for (const row of ui.files) if (row.kind === 'text') recordForPath(row.path)
  }

  /** Recompute diskMatchesCrdt from actual bytes — never guessed. */
  const refreshDiskMatch = async (path: string, guid: string): Promise<void> => {
    const doc = docs.get(guid)
    if (!doc) return
    const bytes = await adapter.read(path)
    const diskText = bytes ? decodeFile(bytes).text : ''
    recordForPath(path).diskMatchesCrdt = diskText === doc.getText()
  }

  const debounceDoc = (guid: string, ms: number, fn: () => void): void => {
    debounces.get(guid)?.()
    debounces.set(
      guid,
      realClock.schedule(() => {
        debounces.delete(guid)
        fn()
      }, ms)
    )
  }

  const flushOpenDoc = async (guid: string, path: string): Promise<void> => {
    if (!sessionRef) return
    try {
      await sessionRef.flush(guid)
      await refreshDiskMatch(path, guid)
    } catch (err) {
      pushError(err)
    }
  }

  const reconcileClosedDoc = async (guid: string, path: string): Promise<void> => {
    if (!sessionRef) return
    try {
      await sessionRef.markClosed(guid)
      await refreshDiskMatch(path, guid)
    } catch (err) {
      pushError(err)
    }
  }

  const routeDocUpdate = (guid: string, origin: unknown): void => {
    if (origin === 'seed' || origin === 'disk') return
    const path = pathForGuid(guid)
    if (!path) return
    recordForPath(path).diskMatchesCrdt = false
    if (ui.selectedPath === path) {
      debounceDoc(guid, FLUSH_DEBOUNCE_MS, () => void flushOpenDoc(guid, path))
    } else {
      debounceDoc(guid, CLOSED_RECONCILE_MS, () => void reconcileClosedDoc(guid, path))
    }
  }

  const attachDoc = (guid: string, path: string): void => {
    if (conns.has(guid)) return
    const doc = docs.get(guid)
    if (!doc) return
    const conn = connectDoc({
      relay: cfg.relay,
      name: `${cfg.room}/${guid}`,
      token: cfg.token,
      doc,
      user,
      record: recordForPath(path),
    })
    conns.set(guid, conn)
    engine.onUpdate(doc, (_update, origin) => routeDocUpdate(guid, origin))
  }

  /** Bind a doc/provider/LCA for a folder-map entry we did not create. */
  const adoptEntry = async (path: string, entry: FileEntry): Promise<void> => {
    const doc = engine.createDoc(entry.guid)
    docs.set(entry.guid, doc)
    await lcaStore.put({
      guid: entry.guid,
      path,
      baseText: '',
      contentHash: NEVER_ON_DISK,
      heads: engine.encodeHeads(engine.heads(doc)),
      eol: 'lf',
      bom: false,
    })
    attachDoc(entry.guid, path)
  }

  const scanMap = async (): Promise<void> => {
    const adopted: { guid: string; path: string }[] = []
    for (const [path, entry] of folderDoc.getMap().entries()) {
      if (entry.kind !== 'text' || entry.deleted) continue
      if (!docs.has(entry.guid)) {
        await adoptEntry(path, entry)
        adopted.push({ guid: entry.guid, path })
      }
    }
    if (adopted.length > 0 && sessionRef) {
      // VaultSession only learns paths at start() — rebuild so flush/watch
      // routing knows the new files, then materialize whatever has content.
      await restartSession()
      for (const { guid, path } of adopted) await reconcileClosedDoc(guid, path)
    }
    refreshFiles()
  }

  const queueMapScan = (): Promise<void> => {
    mapWork = mapWork.then(scanMap).catch(pushError)
    return mapWork
  }

  folderDoc.getMap().observe(() => {
    if (adoptionEnabled) void queueMapScan()
    else refreshFiles()
  })

  const makeSession = (): VaultSession =>
    new VaultSession({
      engine,
      adapter,
      lcaStore,
      journal,
      clock: realClock,
      folderDoc,
      docs,
      events: {
        onReview: (review) => {
          ui.reviews = [...ui.reviews.filter((r) => r.guid !== review.guid), review]
          recordForPath(pathForGuid(review.guid) ?? review.path).diverged = true
        },
        onReviewCleared: (guid) => {
          ui.reviews = ui.reviews.filter((r) => r.guid !== guid)
          const path = pathForGuid(guid)
          if (path) recordForPath(path).diverged = false
        },
        onActivity: (guid) => {
          const path = pathForGuid(guid)
          if (path) void refreshDiskMatch(path, guid)
        },
        onBreaker: (paths) => {
          // V1 web demo has no batch-confirm affordance; log and proceed.
          console.warn('[workspace] mass-change breaker tripped — auto-confirming', paths)
          void sessionRef?.confirmPendingBatch()
        },
        onError: pushError,
      },
    })

  const restartSession = async (): Promise<void> => {
    sessionRef?.dispose()
    sessionRef = makeSession()
    await sessionRef.start()
    if (ui.selectedPath) {
      const guid = guidFor(ui.selectedPath)
      if (guid) sessionRef.markOpen(guid)
    }
  }

  // ---- folder doc provider + presence ----

  const folderConn = connectDoc({
    relay: cfg.relay,
    name: `${cfg.room}/folder`,
    token: cfg.token,
    doc: folderDoc,
    user,
    record: recordForPath(FOLDER_RECORD_KEY),
  })

  const updatePresence = (): void => {
    const names = new Set<string>()
    for (const state of folderConn.awareness.getStates().values()) {
      const name = (state as { user?: { name?: string } }).user?.name
      if (name) names.add(name)
    }
    ui.presence = [...names].sort()
  }
  folderConn.awareness.on('change', updatePresence)
  folderConn.awareness.on('update', updatePresence)
  updatePresence()

  // ---- role-specific bootstrap ----

  if (cfg.role === 'seed') {
    await seedDemoFiles(adapter)
    const enrolled = await enrollFolder(engine, adapter, folderDoc, lcaStore)
    for (const [guid, doc] of enrolled.docs) docs.set(guid, doc)
    for (const [path, entry] of folderDoc.getMap().entries()) {
      if (entry.kind === 'text' && !entry.deleted) attachDoc(entry.guid, path)
    }
    await restartSession()
    adoptionEnabled = true
    // Deliberately not awaiting relay connectivity: seeding works offline,
    // the pills just say so.
  } else {
    // Joiner: folder doc first; "synced" alone is not enough — the seeder may
    // arrive later, so also wait for the map to be non-empty.
    await whenSynced(folderConn.provider, () =>
      folderDoc
        .getMap()
        .entries()
        .some(([, e]) => !e.deleted)
    )
    adoptionEnabled = true
    await queueMapScan() // creates per-file docs + providers
    await Promise.all([...conns.values()].map((c) => whenSynced(c.provider)))
    const { problems } = await joinFolder(engine, adapter, folderDoc, docs, lcaStore)
    if (problems.length > 0) {
      pushError(new Error(`join problems: ${problems.map((p) => `${p.path} (${p.reason})`).join(', ')}`))
    }
    await restartSession()
    // Materialize relay content onto the joiner's "disk".
    for (const guid of docs.keys()) {
      const path = pathForGuid(guid)
      if (path) await reconcileClosedDoc(guid, path)
    }
  }

  refreshFiles()
  ui.phase = 'ready'

  // ---- public surface ----

  const select = (path: string | null): void => {
    if (ui.selectedPath === path) return
    const prevPath = ui.selectedPath
    ui.selectedPath = path // before flush routing so prev counts as closed
    if (prevPath) {
      const prevGuid = guidFor(prevPath)
      if (prevGuid) {
        debounces.get(prevGuid)?.()
        debounces.delete(prevGuid)
        void reconcileClosedDoc(prevGuid, prevPath)
      }
    }
    if (path) {
      const guid = guidFor(path)
      if (guid) sessionRef?.markOpen(guid)
    }
  }

  const createFile = async (): Promise<void> => {
    try {
      const taken = new Set(folderDoc.getMap().entries().map(([p]) => p))
      let n = 1
      while (taken.has(`notes/untitled-${n}.md`)) n++
      const path = `notes/untitled-${n}.md`
      const bytes = new TextEncoder().encode('')
      await adapter.writeAtomic(path, bytes)
      const guid = crypto.randomUUID()
      const doc = engine.createDoc(guid)
      docs.set(guid, doc) // before the map txn so our own observer won't adopt it
      await lcaStore.put({
        guid,
        path,
        baseText: '',
        contentHash: hashBytes(bytes),
        heads: engine.encodeHeads(engine.heads(doc)),
        eol: 'lf',
        bom: false,
      })
      folderDoc.transactMap((m) => m.set(path, { guid, kind: 'text' }), 'local')
      attachDoc(guid, path)
      await restartSession()
      refreshFiles()
      select(path)
    } catch (err) {
      pushError(err)
    }
  }

  const resolveReview = async (guid: string, mergedText: string): Promise<void> => {
    if (!sessionRef) return
    try {
      await sessionRef.resolveReview(guid, mergedText)
      const path = pathForGuid(guid)
      if (path) await refreshDiskMatch(path, guid)
    } catch (err) {
      pushError(err)
    }
  }

  return {
    ui,
    user,
    role: cfg.role,
    docForPath: (path) => {
      const guid = guidFor(path)
      return guid ? (docs.get(guid) ?? null) : null
    },
    awarenessForPath: (path) => {
      const guid = guidFor(path)
      return guid ? (conns.get(guid)?.awareness ?? null) : null
    },
    select,
    createFile,
    resolveReview,
  }
}
