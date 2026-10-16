/**
 * Skills in the app: the vault's `.agents/skills/`, read through the ONE
 * loader (`@ohhi/harness/skills`, which is `@ohhi/agent/skills`), with this
 * device's trust and enabled state from `.ohhi/skills.json` and the
 * `.claude/skills/` farm (`skills-farm.ts`).
 *
 * The trust gate. A skill the person made here (*New skill…*) or imported
 * after reviewing it (*Trust and enable*) is trusted — pinned to the hash of
 * its WHOLE folder as it was reviewed (`hashSkillFolder`). Any other skill
 * this device first sees — it arrived by sync, or something outside Oh Hi
 * wrote it — is listed `trusted: false` and is NOT offered to the agent
 * until the person reviews it. A trusted skill whose folder then changes is
 * re-pinned when the change was this person's, and loses its trust when the
 * workspace's event log says a peer, the relay, the disk or an agent changed
 * it after the last review. `source()` — what the harness host gets — offers
 * a skill only while it is valid, trusted, enabled AND its folder still
 * hashes to the pinned hash (`usableBy`). `scripts/` never run in the app.
 *
 * `.ohhi/skills.json` = `{ [name]: SkillState }`, written through
 * `writeAppFile` (journaled, atomic; golden rule 1). It is device-local:
 * `.ohhi/` is never synced, so trust is never shared — every person reviews.
 *
 * Shape: `createSkills(host)` is the testable core; `attachWritingHarness`
 * binds it (and the sessions) to the open vault and makes it
 * `currentSkills()` for Settings and `ai.run-skill`.
 */
import { getLL } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import type { SkillMeta, SkillSource } from '@ohhi/harness'
import {
  createSkillSource,
  emptySkillSource,
  isValidSkill,
  isValidSkillName,
  loadSkill,
  loadSkills,
  parseSkillsState,
  renderSkillsState,
  SKILLS_DIR,
  SKILLS_STATE_PATH,
  usableBy,
  type SkillFs,
  type SkillsState,
  type SkillState,
} from '@ohhi/harness/skills'
import { attachHarness, type HarnessShell } from './sessions.svelte.js'
import { candidateFromVault, candidateHash, safeRel, SkillImportError, type ImportCandidate } from './skill-import.js'
import { clearFarm, syncFarm, type FarmFs, type FarmResult } from './skills-farm.js'
import template from './skill-template.md?raw'
import type { Workspace } from './workspace.svelte.js'

// ---- the store ------------------------------------------------------------------

/** One skill as Settings lists it. */
export interface SkillRow {
  /** The folder name under `.agents/skills/` — the key of `.ohhi/skills.json`. */
  id: string
  meta: SkillMeta
  trusted: boolean
  enabled: boolean
  valid: boolean
  /** Offered to the agent: valid, trusted, enabled, and unchanged since it was trusted. */
  usable: boolean
  source?: string
  sha?: string
}

/** What the farm needs from the platform: a vault adapter's write side, and a remembered on/off. */
export interface FarmHost {
  fs: FarmFs
  enabled(): boolean
  setEnabled(on: boolean): void
}

export interface SkillsHost {
  /** The vault's files, deep (`.agents/` is not ignored), and their text. */
  fs: SkillFs & { readBytes?(path: string): Promise<Uint8Array | null> }
  readState(): Promise<string | null>
  writeState(text: string): Promise<void>
  /** Create a text file (`workspace.createFile`): its path, or null when refused. */
  createFile(dir: string, name: string, text: string): Promise<string | null>
  /** Write a NEW file's bytes as they are, journaled (`workspace.importFileBytes`); rejects when it exists. */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>
  clock: Clock
  /** Desktop only: absent where no other app reads the disk (OPFS). */
  farm?: FarmHost | null
}

/** A change the workspace logged — the structural part of `AppEvent` this needs. */
export interface SkillEvent {
  id: string
  at: number
  kind: string
  actor: { kind: string }
  scope: { path?: string }
}

export interface FarmStatus {
  /** This platform has a disk Claude Code reads, and the host wired the farm. */
  available: boolean
  enabled: boolean
  last: FarmResult | null
  error: string | null
}

export interface SkillsStore {
  readonly rows: SkillRow[]
  /** False until the first read finished. */
  readonly ready: boolean
  readonly farm: FarmStatus
  refresh(): Promise<void>
  /** Feed the workspace's events: a skill changed by someone else loses its trust. */
  observe(events: readonly SkillEvent[]): void
  setEnabled(id: string, on: boolean): Promise<void>
  /**
   * Trust and enable after a review. `reviewed` is the folder hash of what
   * the person read (`candidate.hash`): when the folder changed since, it is
   * refused (`SkillImportError('changed')`) — trust is never given to bytes
   * nobody reviewed.
   */
  trust(id: string, reviewed?: string): Promise<void>
  /** A new skill from the template, trusted (it is this person's); its SKILL.md path. */
  create(name: string): Promise<string | null>
  /**
   * Write a reviewed import — every file, as its bytes — and trust exactly
   * that. Refused when the folder exists; fails whole when any file cannot
   * be written. Its SKILL.md path.
   */
  install(candidate: ImportCandidate): Promise<string | null>
  setFarm(on: boolean): Promise<void>
  markUsed(id: string): Promise<void>
  /** The `SkillSource` for the harness host: usable skills only. */
  source(): SkillSource
  /** The note text the store reads through (live Y.Text first). */
  readText(path: string): Promise<string | null>
  /** A skill in the vault as a review candidate (*Review…*), with its folder hash. */
  candidate(id: string): Promise<(ImportCandidate & { hash: string }) | null>
}

/** Actors whose change to a skill means it is no longer the one the person reviewed. */
const FOREIGN = new Set(['peer', 'relay', 'disk', 'agent'])
const CHANGE_KINDS = new Set(['doc.changed', 'file.created', 'file.moved'])

const folderOf = (meta: Pick<SkillMeta, 'dir'>): string => meta.dir.slice(meta.dir.lastIndexOf('/') + 1)

/** The template a new skill starts from, with its name in. */
export function skillTemplate(name: string): string {
  return template.replaceAll('{{name}}', name)
}

export function createSkills(host: SkillsHost): SkillsStore {
  let rows = $state<SkillRow[]>([])
  let ready = $state(false)
  const farm = $state<FarmStatus>({
    available: !!host.farm,
    enabled: host.farm?.enabled() ?? false,
    last: null,
    error: null,
  })
  let state: SkillsState = {}
  let metas: SkillMeta[] = []
  /** Skill folder → the latest change someone else made to it (event log time), since the last refresh. */
  let touched = new Map<string, number>()
  /** Events already read, as `id@at` — an event that folds in a later change comes back with a new `at`. */
  const seen = new Set<string>()
  /** Made here this session: trusted on first sight. */
  const ownProvenance = new Map<string, Partial<SkillState>>()

  // One operation at a time: a refresh and a toggle must not interleave their writes.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => undefined)
    return next
  }
  let refreshQueued = false

  const rowsOf = (): SkillRow[] => {
    const usable = usableBy(state)
    return metas.map((meta) => {
      const id = folderOf(meta)
      const s = state[id]
      return {
        id,
        meta,
        trusted: s?.trusted === true,
        enabled: s?.enabled === true,
        valid: isValidSkill(meta),
        usable: usable(meta),
        ...(s?.source ? { source: s.source } : {}),
        ...(s?.sha ? { sha: s.sha } : {}),
      }
    })
  }

  async function saveState(next: SkillsState, before: string | null): Promise<void> {
    const text = renderSkillsState(next)
    if (text !== before && !(before === null && Object.keys(next).length === 0)) await host.writeState(text)
    state = next
  }

  async function runFarm(): Promise<void> {
    if (!host.farm) return
    try {
      farm.last = farm.enabled
        ? await syncFarm({ fs: host.farm.fs, skills: host.fs, wanted: rowsOf().filter((r) => r.usable).map((r) => r.id) })
        : null
      farm.error = null
    } catch (err) {
      farm.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function doRefresh(): Promise<void> {
    refreshQueued = false
    // What arrives while this refresh reads belongs to the next one.
    const changed = touched
    touched = new Map()
    const loaded = await loadSkills(host.fs)
    const before = await host.readState()
    const next: SkillsState = structuredClone(parseSkillsState(before) ?? {})
    const now = host.clock.now()
    for (const meta of loaded) {
      const id = folderOf(meta)
      const row = next[id]
      const own = ownProvenance.get(id)
      if (!row) {
        next[id] = own
          ? { enabled: true, trusted: true, installedAt: now, reviewedAt: now, ...(meta.hash ? { hash: meta.hash } : {}), ...own }
          : { enabled: false, trusted: false, installedAt: now }
      } else if (row.trusted && row.hash !== meta.hash) {
        const since = row.reviewedAt ?? row.installedAt
        // A change seen before this refresh, or arriving while it reads (kept for the next one too).
        const foreign = Math.max(changed.get(id) ?? -Infinity, touched.get(id) ?? -Infinity)
        if (foreign > since) row.trusted = false
        else if (meta.hash) row.hash = meta.hash
      }
    }
    await saveState(next, before)
    metas = loaded
    rows = rowsOf()
    ready = true
    await runFarm()
  }

  /** Change one row of the state and write it. */
  const update = (id: string, patch: (row: SkillState | undefined, now: number) => SkillState): Promise<void> =>
    serial(async () => {
      const before = await host.readState()
      const next: SkillsState = structuredClone(parseSkillsState(before) ?? {})
      next[id] = patch(next[id], host.clock.now())
      await saveState(next, before)
      rows = rowsOf()
      await runFarm()
    })

  /** The folder's hash as the loader reads it now; null when there is no skill there. */
  const currentHash = async (id: string): Promise<string | null> => (await loadSkill(host.fs, id))?.meta.hash ?? null

  /** Pin `id` to `hash` as reviewed now, with its provenance. */
  const pin = (id: string, hash: string, provenance: Partial<SkillState> = {}): Promise<void> =>
    update(id, (row, now) => ({
      ...(row ?? { installedAt: now }),
      ...provenance,
      enabled: true,
      trusted: true,
      hash,
      reviewedAt: now,
    }))

  const store: SkillsStore = {
    get rows() {
      return rows
    },
    get ready() {
      return ready
    },
    get farm() {
      return farm
    },
    refresh() {
      if (refreshQueued) return queue.then(() => undefined)
      refreshQueued = true
      return serial(doRefresh)
    },
    observe(events) {
      let hit = false
      for (const e of events) {
        const key = `${e.id}@${e.at}`
        if (seen.has(key)) continue
        seen.add(key)
        const path = e.scope.path
        if (!path || !FOREIGN.has(e.actor.kind) || !CHANGE_KINDS.has(e.kind)) continue
        if (!path.startsWith(`${SKILLS_DIR}/`)) continue
        const id = path.slice(SKILLS_DIR.length + 1).split('/')[0]
        touched.set(id, Math.max(touched.get(id) ?? -Infinity, e.at))
        hit = true
      }
      if (hit) void store.refresh()
    },
    setEnabled(id, on) {
      return update(id, (row, now) => ({ ...(row ?? { trusted: false, installedAt: now }), enabled: on }))
    },
    async trust(id, reviewed) {
      const hash = await currentHash(id)
      if (hash === null || (reviewed !== undefined && hash !== reviewed)) throw new SkillImportError('changed', { name: id })
      await pin(id, hash)
    },
    async create(name) {
      if (!isValidSkillName(name)) throw new Error('name')
      if (metas.some((m) => folderOf(m) === name) || (await host.fs.list(`${SKILLS_DIR}/${name}`)).length > 0) {
        throw new Error('taken')
      }
      ownProvenance.set(name, { source: 'local' })
      const path = await host.createFile(`${SKILLS_DIR}/${name}`, 'SKILL.md', skillTemplate(name))
      if (!path) return null
      const hash = await currentHash(name)
      if (hash) await pin(name, hash, { source: 'local' })
      await store.refresh()
      return path
    },
    async install(candidate) {
      const name = candidate.name
      const dir = `${SKILLS_DIR}/${name}`
      if (!isValidSkillName(name)) throw new Error('name')
      // Never over an existing folder: its bytes were not the ones reviewed.
      if (metas.some((m) => folderOf(m) === name) || (await host.fs.list(dir)).length > 0) {
        throw new SkillImportError('exists', { name })
      }
      if (!candidate.files.some((f) => f.rel === 'SKILL.md')) throw new SkillImportError('no_skill_md', { path: candidate.source })
      const bad = candidate.files.find((f) => !safeRel(f.rel))
      if (bad) throw new SkillImportError('bad_path', { path: bad.rel })
      const reviewed = await candidateHash(candidate)
      // SKILL.md last: a half-written folder is never a loadable skill.
      const ordered = [...candidate.files.filter((f) => f.rel !== 'SKILL.md'), ...candidate.files.filter((f) => f.rel === 'SKILL.md')]
      for (const file of ordered) await host.writeBytes(`${dir}/${file.rel}`, file.bytes)
      const hash = await currentHash(name)
      if (hash !== reviewed) throw new SkillImportError('changed', { name })
      await pin(name, hash, { source: candidate.source, ...(candidate.sha ? { sha: candidate.sha } : {}) })
      await store.refresh()
      return `${dir}/SKILL.md`
    },
    setFarm(on) {
      return serial(async () => {
        host.farm?.setEnabled(on)
        farm.enabled = on
        if (!host.farm) return
        if (on) await runFarm()
        else {
          try {
            farm.last = null
            await clearFarm(host.farm.fs)
            farm.error = null
          } catch (err) {
            farm.error = err instanceof Error ? err.message : String(err)
          }
        }
      })
    },
    markUsed(id) {
      return update(id, (row, now) => ({ ...(row ?? { enabled: false, trusted: false, installedAt: now }), lastUsed: now }))
    },
    source() {
      return createSkillSource(host.fs, usableBy(state))
    },
    readText: (path) => host.fs.read(path),
    async candidate(id) {
      const found = await candidateFromVault(host.fs, id)
      return found ? { ...found, hash: await candidateHash(found) } : null
    },
  }
  return store
}

// ---- binding to an open vault --------------------------------------------------

/** The workspace calls the store needs (a `Workspace` has them all). */
export type SkillsWorkspace = Pick<
  Workspace,
  'ui' | 'docForPath' | 'readFileBytes' | 'readAppFile' | 'writeAppFile' | 'createFile' | 'importFileBytes'
>

const decoder = new TextDecoder()

/** The loader's two calls over the live workspace: its file list, and a note's live text (else its bytes). */
export function workspaceSkillFs(ws: Pick<SkillsWorkspace, 'ui' | 'docForPath' | 'readFileBytes'>): SkillsHost['fs'] {
  return {
    list: async (dir) =>
      ws.ui.files
        .filter((f) => (f.kind === 'text' || f.kind === 'binary') && f.path.startsWith(`${dir}/`))
        .map((f) => f.path)
        .sort(),
    read: async (path) => {
      const doc = ws.docForPath(path)
      if (doc) return doc.getText()
      const bytes = await ws.readFileBytes(path)
      return bytes ? decoder.decode(bytes) : null
    },
    readBytes: (path) => ws.readFileBytes(path),
  }
}

const FARM_KEY = (room: string): string => `ohhi.skills.farm.${room}`

/** The farm's on/off, per vault on this device: on unless turned off. */
export function farmSetting(room: string): Pick<FarmHost, 'enabled' | 'setEnabled'> {
  return {
    enabled: () => {
      try {
        return localStorage.getItem(FARM_KEY(room)) !== 'off'
      } catch {
        return true
      }
    },
    setEnabled: (on) => {
      try {
        localStorage.setItem(FARM_KEY(room), on ? 'on' : 'off')
      } catch {
        // A blocked storage just forgets the choice; the farm still follows it this session.
      }
    },
  }
}

/**
 * The farm's file side over an open vault: its root adapter, each write's
 * pre-image recorded in the root journal first (golden rule 1).
 */
export function farmFsFor(ws: Pick<Workspace, 'adapterForFarm' | 'journalFor'>): FarmFs {
  const adapter = ws.adapterForFarm()
  const journal = ws.journalFor('')
  return {
    read: (p) => adapter.read(p),
    writeAtomic: (p, bytes) => adapter.writeAtomic(p, bytes),
    remove: (p) => adapter.remove(p),
    removeDir: (p) => adapter.removeDir(p),
    ...(journal ? { record: (p: string, bytes: Uint8Array | null) => journal.record(p, bytes) } : {}),
  }
}

export function workspaceSkillsHost(ws: SkillsWorkspace & { room?: string }, opts: { clock: Clock; farm?: FarmFs | null }): SkillsHost {
  return {
    fs: workspaceSkillFs(ws),
    readState: () => ws.readAppFile(SKILLS_STATE_PATH),
    writeState: (text) => ws.writeAppFile(SKILLS_STATE_PATH, text),
    createFile: (dir, name, text) => ws.createFile(dir, name, text),
    writeBytes: (path, bytes) => ws.importFileBytes(path, bytes),
    clock: opts.clock,
    farm: opts.farm ? { fs: opts.farm, ...farmSetting(ws.room ?? '') } : null,
  }
}

let current = $state<SkillsStore | null>(null)

/** The open vault's skills, or null with no vault. */
export function currentSkills(): SkillsStore | null {
  return current
}

/**
 * Bind skills to an open vault: build the store, read once, re-read when a
 * file under `.agents/skills/` appears, moves or goes, and hand it the event
 * log (changes from elsewhere drop trust). `farm` is the vault adapter on
 * desktop and absent in the browser. Returns the detach.
 */
export function attachSkills(ws: Workspace, opts: { clock: Clock; farm?: FarmFs | null }): () => void {
  const store = createSkills(workspaceSkillsHost(ws, opts))
  current = store
  const stop = $effect.root(() => {
    const files = $derived(
      ws.ui.files
        .filter((f) => f.path.startsWith(`${SKILLS_DIR}/`))
        .map((f) => f.path)
        .join('\n')
    )
    $effect(() => {
      void files
      void store.refresh()
    })
    $effect(() => {
      store.observe(ws.ui.events)
    })
  })
  return () => {
    stop()
    if (current === store) current = null
  }
}

/**
 * The writing harness's one entry point for the composition root: the
 * sessions and runs (`attachHarness`), and the open vault's skills, rebound
 * whenever the vault changes. `desktop` turns the `.claude/skills/` farm on
 * (a disk Claude Code reads). Returns the detach.
 */
export function attachWritingHarness(shell: Omit<HarnessShell, 'skills'> & { desktop: boolean }): () => void {
  const { desktop, ...rest } = shell
  attachHarness({ ...rest, skills: () => currentSkills()?.source() ?? emptySkillSource })
  const stop = $effect.root(() => {
    $effect(() => {
      const ws = shell.workspace()
      if (!ws) return
      return attachSkills(ws, { clock: shell.clock, farm: desktop ? farmFsFor(ws) : null })
    })
  })
  return () => {
    stop()
    attachHarness(null)
  }
}

// ---- words ---------------------------------------------------------------------

/** A loader problem code in the person's words (`name-format` → `ai.skills.problem.name_format`). */
export function problemText(code: string): string {
  const words = getLL().web.ai.skills.problem as unknown as Record<string, (() => string) | undefined>
  return words[code.replaceAll('-', '_')]?.() ?? getLL().web.ai.skills.problem.unknown({ code })
}
