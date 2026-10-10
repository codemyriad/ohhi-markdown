/**
 * Skills in the app (writing-harness-shaping B9, Fork 6-A): the vault's
 * `.agents/skills/`, read through the ONE loader (`@ohhi/harness/skills`,
 * which is `@ohhi/agent/skills`), with this device's trust and enabled state
 * from `.ohhi/skills.json` and the `.claude/skills/` farm (`skills-farm.ts`).
 *
 * The trust gate. A skill the person made here (*New skill…*) or imported
 * after reviewing it (*Trust and enable*) is trusted. Any other skill this
 * device first sees — it arrived by sync, or something outside Oh hi wrote it
 * — is listed `trusted: false` and is NOT offered to the agent until the
 * person reviews it. A trusted skill whose SKILL.md then changes is
 * re-pinned when the change was this person's, and loses its trust when the
 * workspace's event log says a peer, the relay, the disk or an agent changed
 * it after the last review. `source()` — what the harness host gets — offers
 * valid, trusted, enabled skills only. `scripts/` never run in the app.
 *
 * `.ohhi/skills.json` = `{ [name]: { enabled, trusted, source?, sha?, hash?,
 * installedAt, reviewedAt?, lastUsed? } }` (`SkillState`), written through
 * `writeAppFile` (journaled, atomic; golden rule 1). It is device-local:
 * `.ohhi/` is never synced, so trust is never shared — every person reviews.
 *
 * Shape: `createSkills(host)` is the testable core; `attachSkills(workspace)`
 * binds it to an open vault and makes it `currentSkills()` for the Settings
 * panel and `ai.run-skill`; `runSkillCommand` is that command's row.
 */
import { mount, unmount } from 'svelte'
import { getLL } from '@ohhi/i18n'
import { hashText, looksBinary, type Clock } from '@ohhi/vault'
import type { Mention, SkillMeta, SkillSource } from '@ohhi/harness'
import {
  createSkillSource,
  isValidSkill,
  loadSkill,
  loadSkills,
  parseSkill,
  parseSkillsState,
  readSkillFrontmatter,
  SKILLS_DIR,
  SKILLS_STATE_PATH,
  type SkillFs,
  type SkillInput,
  type SkillsState,
  type SkillState,
} from '@ohhi/harness/skills'
import type { Command } from './commands.js'
import { aiEnabled } from './config.js'
import type { FlashInput } from './notices.js'
import { mentionOf } from './references.js'
import { captureFocusedSelection, startRun, type RunHandle, type StartRunInput } from './sessions.svelte.js'
import { clearFarm, syncFarm, type FarmFs, type FarmResult } from './skills-farm.js'
import { routeInApp, routeSkillRun, withLanding } from './skill-routing.js'
import SkillPicker from './components/SkillPicker.svelte'
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
  /** Offered to the agent: valid, trusted and enabled. */
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
  fs: SkillFs
  readState(): Promise<string | null>
  writeState(text: string): Promise<void>
  /** Create a text file (`workspace.createFile`): its path, or null when refused. */
  createFile(dir: string, name: string, text: string): Promise<string | null>
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

/** One file of a skill being imported. `text` is absent for a binary, which is not imported. */
export interface ImportFile {
  /** Relative to the skill's folder: `SKILL.md`, `references/style.md`. */
  rel: string
  text?: string
  size: number
}

export interface ImportCandidate {
  /** The folder name it will get under `.agents/skills/`. */
  name: string
  /** `github:owner/repo/path` or `folder:<name>`. */
  source: string
  /** The commit an import from GitHub is pinned to. */
  sha?: string
  files: ImportFile[]
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
  /** Trust and enable (a review, or an import with its provenance). */
  trust(id: string, provenance?: { source?: string; sha?: string }): Promise<void>
  /** A new skill from the template, trusted (it is this person's); its SKILL.md path. */
  create(name: string): Promise<string | null>
  /** Write a reviewed import and trust it; its SKILL.md path. */
  install(candidate: ImportCandidate): Promise<string | null>
  setFarm(on: boolean): Promise<void>
  markUsed(id: string): Promise<void>
  /** The `SkillSource` for the harness host: valid, trusted, enabled skills only. */
  source(): SkillSource
  /** The note text the store reads through (live Y.Text first). */
  readText(path: string): Promise<string | null>
  /** A skill in the vault as a review candidate (*Review…*). */
  candidate(id: string): Promise<ImportCandidate | null>
}

/** The spec's name rule (also the folder name). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const validSkillName = (name: string): boolean => name.length <= 64 && SKILL_NAME.test(name)

/** Actors whose change to a skill means it is no longer the one the person reviewed. */
const FOREIGN = new Set(['peer', 'relay', 'disk', 'agent'])
const CHANGE_KINDS = new Set(['doc.changed', 'file.created', 'file.moved'])

const folderOf = (meta: Pick<SkillMeta, 'dir'>): string => meta.dir.slice(meta.dir.lastIndexOf('/') + 1)
const renderState = (state: SkillsState): string => `${JSON.stringify(state, null, 2)}\n`

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
  /** Skill folder → the latest change someone else made to it (event log time). */
  const touched = new Map<string, number>()
  const seen = new Set<string>()
  /** Made or imported here this session: trusted on first sight. */
  const ownProvenance = new Map<string, Partial<SkillState>>()

  // One operation at a time: a refresh and a toggle must not interleave their writes.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn)
    queue = next.catch(() => undefined)
    return next
  }
  let refreshQueued = false

  const rowsOf = (): SkillRow[] =>
    metas.map((meta) => {
      const id = folderOf(meta)
      const s = state[id]
      const trusted = s?.trusted === true
      const enabled = s?.enabled === true
      const valid = isValidSkill(meta)
      return {
        id,
        meta,
        trusted,
        enabled,
        valid,
        usable: valid && trusted && enabled,
        ...(s?.source ? { source: s.source } : {}),
        ...(s?.sha ? { sha: s.sha } : {}),
      }
    })

  async function saveState(next: SkillsState, before: string | null): Promise<void> {
    const text = renderState(next)
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
    const loaded = await loadSkills(host.fs)
    const before = await host.readState()
    const next: SkillsState = structuredClone(parseSkillsState(before) ?? {})
    const now = host.clock.now()
    for (const meta of loaded) {
      const id = folderOf(meta)
      const hash = hashText((await host.fs.read(`${meta.dir}/SKILL.md`)) ?? '')
      const row = next[id]
      const own = ownProvenance.get(id)
      if (!row) {
        next[id] = own
          ? { enabled: true, trusted: true, installedAt: now, reviewedAt: now, hash, ...own }
          : { enabled: false, trusted: false, installedAt: now }
      } else if (row.trusted && row.hash !== hash) {
        const since = row.reviewedAt ?? row.installedAt
        if ((touched.get(id) ?? -Infinity) > since) row.trusted = false
        else row.hash = hash
      }
    }
    touched.clear()
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

  const currentHash = async (id: string): Promise<string> => hashText((await host.fs.read(`${SKILLS_DIR}/${id}/SKILL.md`)) ?? '')

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
        if (seen.has(e.id)) continue
        seen.add(e.id)
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
    async trust(id, provenance = {}) {
      const hash = await currentHash(id)
      await update(id, (row, now) => ({
        ...(row ?? { installedAt: now }),
        ...provenance,
        enabled: true,
        trusted: true,
        hash,
        reviewedAt: now,
      }))
    },
    async create(name) {
      if (!validSkillName(name)) throw new Error('name')
      if (metas.some((m) => folderOf(m) === name) || (await host.fs.read(`${SKILLS_DIR}/${name}/SKILL.md`)) !== null) {
        throw new Error('taken')
      }
      ownProvenance.set(name, { source: 'local' })
      const text = skillTemplate(name)
      const path = await host.createFile(`${SKILLS_DIR}/${name}`, 'SKILL.md', text)
      if (!path) return null
      await update(name, (_row, now) => ({ enabled: true, trusted: true, source: 'local', hash: hashText(text), installedAt: now, reviewedAt: now }))
      await store.refresh()
      return path
    },
    async install(candidate) {
      const name = candidate.name
      if (metas.some((m) => folderOf(m) === name)) throw new Error('taken')
      const skillMd = candidate.files.find((f) => f.rel === 'SKILL.md')?.text
      if (skillMd === undefined) throw new Error('no SKILL.md')
      const provenance = { source: candidate.source, ...(candidate.sha ? { sha: candidate.sha } : {}) }
      ownProvenance.set(name, provenance)
      let skillPath: string | null = null
      for (const file of candidate.files) {
        if (file.text === undefined) continue
        const path = await host.createFile(`${SKILLS_DIR}/${name}`, file.rel, file.text)
        if (file.rel === 'SKILL.md') skillPath = path
      }
      await update(name, (_row, now) => ({
        enabled: true,
        trusted: true,
        ...provenance,
        hash: hashText(skillMd),
        installedAt: now,
        reviewedAt: now,
      }))
      await store.refresh()
      return skillPath
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
      return createSkillSource(host.fs, (meta) => {
        const s = state[folderOf(meta)]
        return s?.trusted === true && s.enabled === true
      })
    },
    readText: (path) => host.fs.read(path),
    candidate: (id) => candidateFromVault(host.fs, id),
  }
  return store
}

// ---- binding to an open vault --------------------------------------------------

/** The workspace calls the store needs (a `Workspace` has them all). */
export type SkillsWorkspace = Pick<Workspace, 'ui' | 'docForPath' | 'readFileBytes' | 'readAppFile' | 'writeAppFile' | 'createFile'>

const decoder = new TextDecoder()

/** The loader's two calls over the live workspace: its file list, and a note's live text (else its bytes). */
export function workspaceSkillFs(ws: Pick<SkillsWorkspace, 'ui' | 'docForPath' | 'readFileBytes'>): SkillFs {
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
      return bytes ? decoder.decode(bytes).replace(/^﻿/, '') : null
    },
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

export function workspaceSkillsHost(ws: SkillsWorkspace & { room?: string }, opts: { clock: Clock; farm?: FarmFs | null }): SkillsHost {
  return {
    fs: workspaceSkillFs(ws),
    readState: () => ws.readAppFile(SKILLS_STATE_PATH),
    writeState: (text) => ws.writeAppFile(SKILLS_STATE_PATH, text),
    createFile: (dir, name, text) => ws.createFile(dir, name, text),
    clock: opts.clock,
    farm: opts.farm ? { fs: opts.farm, ...farmSetting(ws.room ?? '') } : null,
  }
}

let current = $state<SkillsStore | null>(null)

/** The open vault's skills, or null with no vault (or before the shell attached them). */
export function currentSkills(): SkillsStore | null {
  return current
}

/**
 * Bind skills to an open vault: build the store, read once, re-read when a
 * file under `.agents/skills/` appears, moves or goes, and hand it the event
 * log (changes from elsewhere drop trust). `farm` is the vault adapter on
 * desktop — the app's writes to `.claude/skills/` — and absent in the browser.
 * Returns the detach; call it when the vault closes.

 *
 * `App.svelte` calls it whenever the open vault changes (the farm is the
 * root adapter on desktop, through `Workspace.adapterForFarm`) and hands
 * `currentSkills()?.source()` to the harness host.
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

// ---- review and import -----------------------------------------------------------

/** What the review pane shows about a skill before it is trusted. */
export interface SkillReview {
  name: string
  meta: SkillMeta
  skillMd: string
  files: ImportFile[]
  urls: string[]
  allowedTools: string | null
  binaryCount: number
}

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g

export function reviewOf(candidate: ImportCandidate): SkillReview {
  const skillMd = candidate.files.find((f) => f.rel === 'SKILL.md')?.text ?? ''
  const dir = `${SKILLS_DIR}/${candidate.name}`
  const { meta } = parseSkill(dir, skillMd, candidate.files.map((f) => `${dir}/${f.rel}`))
  const urls = new Set<string>()
  for (const f of candidate.files) for (const m of f.text?.matchAll(URL_RE) ?? []) urls.add(m[0].replace(/[.,;:]+$/, ''))
  const tools = readSkillFrontmatter(skillMd)?.fields.get('allowed-tools')
  return {
    name: candidate.name,
    meta,
    skillMd,
    files: candidate.files,
    urls: [...urls].slice(0, 50),
    allowedTools: tools === undefined ? null : Array.isArray(tools) ? tools.join(' ') : typeof tools === 'string' ? tools : null,
    binaryCount: candidate.files.filter((f) => f.text === undefined).length,
  }
}

/** A skill already in the vault, as a candidate — the review pane for a skill that synced in. */
export async function candidateFromVault(fs: SkillFs, id: string): Promise<ImportCandidate | null> {
  const dir = `${SKILLS_DIR}/${id}`
  if (!(await loadSkill(fs, id))) return null
  const files: ImportFile[] = []
  for (const path of await fs.list(dir)) {
    const rel = path.slice(dir.length + 1)
    const text = await fs.read(path)
    const bytes = new TextEncoder().encode(text ?? '')
    files.push(text === null || looksBinary(rel, bytes) ? { rel, size: bytes.length } : { rel, text, size: bytes.length })
  }
  return { name: id, source: 'vault', files }
}

/** Why an import failed, as a dictionary key under `ai.skills.import_dialog` plus its arguments. */
export class SkillImportError extends Error {
  constructor(
    readonly code: 'bad_source' | 'no_skill_md' | 'too_many' | 'fetch_failed' | 'network' | 'folder_failed',
    readonly params: Record<string, string | number> = {}
  ) {
    super(code)
    this.name = 'SkillImportError'
  }
}

export interface GithubSource {
  owner: string
  repo: string
  ref?: string
  path: string
}

/** `owner/repo[/path]`, or a `github.com/owner/repo/tree|blob/<ref>/<path>` link. */
export function parseGithubSource(input: string): GithubSource | null {
  let text = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//, '').replace(/\/+$/, '').replace(/\.git$/, '')
  if (text === '' || /\s/.test(text)) return null
  const tree = /^([\w.-]+)\/([\w.-]+)\/(?:tree|blob)\/([^/]+)(?:\/(.*))?$/.exec(text)
  if (tree) {
    let path = tree[4] ?? ''
    if (path.endsWith('/SKILL.md') || path === 'SKILL.md') path = path.slice(0, -'SKILL.md'.length).replace(/\/$/, '')
    return { owner: tree[1], repo: tree[2], ref: tree[3], path }
  }
  text = text.replace(/\/SKILL\.md$/, '')
  const plain = /^([\w.-]+)\/([\w.-]+)(?:\/(.*))?$/.exec(text)
  return plain ? { owner: plain[1], repo: plain[2], path: plain[3] ?? '' } : null
}

const MAX_FILES = 100
const MAX_BYTES = 2_000_000

/**
 * Fetch one skill folder from GitHub's contents API, pinned to a commit: the
 * ref (or the default branch) is resolved to its sha first and every listing
 * and file is read at that sha. Text files carry their text; binaries are
 * listed and not imported.
 */
export async function fetchGithubSkill(src: GithubSource, fetchImpl: typeof fetch = (i, init) => globalThis.fetch(i, init)): Promise<ImportCandidate> {
  const api = `https://api.github.com/repos/${src.owner}/${src.repo}`
  const get = async (url: string, what: string): Promise<Response> => {
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json' } })
    } catch (err) {
      throw new SkillImportError('network', { message: err instanceof Error ? err.message : String(err) })
    }
    if (!res.ok) throw new SkillImportError('fetch_failed', { status: res.status, path: what })
    return res
  }
  const ref = src.ref ?? ((await (await get(api, `${src.owner}/${src.repo}`)).json()) as { default_branch: string }).default_branch
  const sha = ((await (await get(`${api}/commits/${encodeURIComponent(ref)}`, ref)).json()) as { sha: string }).sha

  interface Entry { type: string; path: string; size: number; download_url: string | null }
  const listed: Entry[] = []
  const walk = async (path: string): Promise<void> => {
    const url = `${api}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`
    const body = (await (await get(url, path || '/')).json()) as Entry[] | Entry
    if (!Array.isArray(body)) throw new SkillImportError('no_skill_md', { path: path || '/' })
    for (const e of body) {
      if (e.type === 'dir') await walk(e.path)
      else if (e.type === 'file') listed.push(e)
      if (listed.length > MAX_FILES) throw new SkillImportError('too_many', { max: MAX_FILES })
    }
  }
  await walk(src.path)
  const prefix = src.path ? `${src.path}/` : ''
  if (!listed.some((e) => e.path === `${prefix}SKILL.md`)) throw new SkillImportError('no_skill_md', { path: src.path || '/' })
  if (listed.reduce((n, e) => n + e.size, 0) > MAX_BYTES) throw new SkillImportError('too_many', { max: MAX_FILES })

  const files: ImportFile[] = []
  for (const e of listed) {
    const rel = e.path.slice(prefix.length)
    if (!e.download_url) continue
    const bytes = new Uint8Array(await (await get(e.download_url, e.path)).arrayBuffer())
    files.push(looksBinary(rel, bytes) ? { rel, size: bytes.length } : { rel, text: decoder.decode(bytes), size: bytes.length })
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const name = (src.path.split('/').pop() || src.repo).toLowerCase()
  return { name, source: `github:${src.owner}/${src.repo}${src.path ? `/${src.path}` : ''}`, sha, files }
}

/** Desktop: pick a skill folder and read it (Tauri dialog + fs, loaded only here). Null when cancelled. */
export async function pickLocalSkillFolder(): Promise<ImportCandidate | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false })
    if (typeof picked !== 'string') return null
    const { readDir, readFile } = await import('@tauri-apps/plugin-fs')
    const root = picked.replace(/[\\/]+$/, '')
    const files: ImportFile[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const entry of await readDir(dir)) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory) await walk(`${dir}/${entry.name}`, childRel)
        else if (entry.isFile) {
          const bytes = await readFile(`${dir}/${entry.name}`)
          files.push(looksBinary(childRel, bytes) ? { rel: childRel, size: bytes.length } : { rel: childRel, text: decoder.decode(bytes), size: bytes.length })
        }
        if (files.length > MAX_FILES) throw new SkillImportError('too_many', { max: MAX_FILES })
      }
    }
    await walk(root, '')
    if (!files.some((f) => f.rel === 'SKILL.md')) throw new SkillImportError('no_skill_md', { path: root })
    const name = root.slice(Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\')) + 1).toLowerCase()
    return { name, source: `folder:${name}`, files }
  } catch (err) {
    if (err instanceof SkillImportError) throw err
    throw new SkillImportError('folder_failed', { message: err instanceof Error ? err.message : String(err) })
  }
}

// ---- ai.run-skill ------------------------------------------------------------------

/** What `ai.run-skill` runs on: the focused note, and its selection as a `lines` mention when there is one. */
export interface SkillTarget {
  path: string
  selection: Mention | null
}

/** Which skills fit a target: by `ohhi-input` (a skill that does not say fits anything). */
export function fitsTarget(input: SkillInput | undefined, hasSelection: boolean): boolean {
  if (input === undefined) return true
  return hasSelection ? input === 'selection' || input === 'section' : input !== 'selection'
}

/** A palette over the skills; resolves with the pick, or null when dismissed. */
export function pickSkill(skills: SkillMeta[], placeholder: string): Promise<SkillMeta | null> {
  return new Promise((resolve) => {
    let instance: ReturnType<typeof mount> | null = null
    const done = (meta: SkillMeta | null): void => {
      if (instance) void unmount(instance)
      instance = null
      resolve(meta)
    }
    instance = mount(SkillPicker, { target: document.body, props: { skills, placeholder, onPick: (m: SkillMeta) => done(m), onClose: () => done(null) } })
  })
}

export interface RunSkillDeps {
  flash?(input: FlashInput): void
  selectedPath?(): string | null
  /** Injected for tests; B's `startRun` (`sessions.svelte.ts`, the one run door) otherwise. */
  startRun?(input: StartRunInput): Promise<RunHandle | null>
  /** Injected for tests; `currentSkills` otherwise. */
  skills?(): SkillsStore | null
  /** Injected for tests; the focused note and B's `captureFocusedSelection` otherwise. */
  target?(): Promise<SkillTarget | null>
  pick?(skills: SkillMeta[], placeholder: string): Promise<SkillMeta | null>
  /** Injected for tests; `routeSkillRun` over the open vault otherwise (lands the answer by `meta.kind`). */
  route?(input: { meta: SkillMeta; handle: RunHandle; target: SkillTarget }): Promise<unknown>
}

/**
 * `ai.run-skill`: on the selection or the focused note, a picker of the
 * trusted, enabled skills whose `ohhi-input` fits, then a turn through B's
 * `startRun` with that skill and the target as its reference — in a new
 * session, opened beside the note.
 */
export function runSkillCommand(deps: RunSkillDeps): Command {
  const t = getLL().web.ai
  const skillsOf = deps.skills ?? currentSkills
  const targetOf =
    deps.target ??
    (async (): Promise<SkillTarget | null> => {
      const path = deps.selectedPath?.() ?? null
      return path ? { path, selection: await captureFocusedSelection(path) } : null
    })
  const pick = deps.pick ?? pickSkill
  const start = deps.startRun ?? startRun
  const say = (text: string): void => deps.flash?.({ level: 'info', text })
  return {
    id: 'ai.run-skill',
    title: t.commands.run_skill(),
    group: getLL().web.commands.groups.ai(),
    when: () => aiEnabled(),
    run: async () => {
      const store = skillsOf()
      if (!store) return say(t.skills.run.no_vault())
      const target = await targetOf()
      if (!target) return say(t.skills.run.no_note())
      const hasSelection = target.selection !== null
      const what = hasSelection ? t.skills.run.target_selection() : t.skills.run.target_note()
      const offered = (await store.source().list()).filter((m) => fitsTarget(m.input, hasSelection))
      if (offered.length === 0) return say(t.skills.run.none({ target: what }))
      const meta = await pick(offered, t.skills.run.placeholder({ target: what }))
      if (!meta) return
      const body = (await store.source().body(meta.name)) ?? ''
      const refs: Mention[] = [target.selection ?? mentionOf({ kind: 'file', path: target.path })]
      // The kind decides where the answer lands (`skill-routing.ts`): its rules ride on the body.
      const handle = await start({ instruction: meta.description, refs, skill: { meta, body: withLanding(meta, body) } })
      if (!handle) return say(t.skills.run.not_started({ name: meta.name }))
      say(t.skills.run.started({ name: meta.name }))
      void store.markUsed(folderOf(meta))
      void (deps.route ?? ((input) => routeSkillRun(routeInApp(deps.flash), input)))({ meta, handle, target })
    },
  }
}

// ---- words ---------------------------------------------------------------------

/** A loader problem code in the person's words (`name-format` → `ai.skills.problem.name_format`). */
export function problemText(code: string): string {
  const words = getLL().web.ai.skills.problem as unknown as Record<string, (() => string) | undefined>
  return words[code.replaceAll('-', '_')]?.() ?? getLL().web.ai.skills.problem.unknown({ code })
}

/** An import failure in the person's words. */
export function importErrorText(err: unknown): string {
  const t = getLL().web.ai.skills.import_dialog
  if (!(err instanceof SkillImportError)) return t.write_failed({ message: err instanceof Error ? err.message : String(err) })
  const p = err.params
  switch (err.code) {
    case 'bad_source':
      return t.bad_source()
    case 'no_skill_md':
      return t.no_skill_md({ path: String(p.path ?? '') })
    case 'too_many':
      return t.too_many({ max: Number(p.max ?? 0) })
    case 'fetch_failed':
      return t.fetch_failed({ status: Number(p.status ?? 0), path: String(p.path ?? '') })
    case 'network':
      return t.network({ message: String(p.message ?? '') })
    case 'folder_failed':
      return t.folder_failed({ message: String(p.message ?? '') })
  }
}
