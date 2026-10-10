/**
 * THE SKILL LOADER (writing-harness-shaping B9, Fork 6-A) — the one reader of
 * `.agents/skills/<name>/SKILL.md`, for every host: the `skills` / `skill`
 * ops here, `ohhi skills export`, and the app's store and farm (through
 * `@ohhi/harness`, which re-exports this module). One loader, never two.
 *
 * Host-neutral and browser-safe: it reads through a two-call `SkillFs` and
 * imports nothing but types, so the web bundle takes it via the
 * `@ohhi/agent/skills` subpath without pulling in the files backend.
 *
 * Why it lives in `libs/agent` and not `libs/harness`: the contract ops need
 * it, and `@ohhi/harness` already depends on `@ohhi/agent` — the other way
 * round is a cycle.
 *
 * Why it carries its own small frontmatter reader: SKILL.md's frontmatter is
 * NOT the flat subset. `metadata` is a nested map by the spec, and a
 * description is often a folded `>` block. `@ohhi/frontmatter` (the patcher's
 * reader) refuses both by design, because it must never write what it cannot
 * re-emit byte-for-byte; this reader only ever reads, and only the shapes the
 * spec defines: top-level scalars (plain, quoted, `>`/`|` blocks), flow and
 * block lists, and one level of `key: scalar` under a map key. Anything
 * deeper is a `metadata-nested` problem, never a guess.
 *
 * Validation follows the spec (agentskills.io/specification) leniently, as
 * its integration guide recommends: a skill with problems is still listed —
 * so it can be fixed — but it is never offered to a model or exported.
 */
import type { z } from 'zod'
import { hashText } from '@ohhi/vault'
import type { SkillMeta as SkillMetaSchema } from './contract.js'

/**
 * A skill as the loader reads it: the contract's `SkillMeta` plus `hash`,
 * the whole folder's content hash (`hashSkillFolder`). The hash is the
 * loader's, not the contract's — the `skill` op leaves it out — because trust
 * (`usableSkills`) is checked against it.
 */
export type SkillMeta = z.infer<typeof SkillMetaSchema> & {
  /** `hashSkillFolder` of the skill's folder when it was loaded; absent from `parseSkill` alone. */
  hash?: string
}
export type SkillKind = NonNullable<SkillMeta['kind']>
export type SkillInput = NonNullable<SkillMeta['input']>
export type SkillOutput = NonNullable<SkillMeta['output']>

/** Where skills live, vault-relative (the cross-harness common denominator). */
export const SKILLS_DIR = '.agents/skills'
/** Where Claude Code looks; the farm `ohhi skills export` and the app maintain. */
export const FARM_DIR = '.claude/skills'
/** What the farm's writers record, so neither ever deletes a folder it did not make. */
export const FARM_MANIFEST = `${FARM_DIR}/.ohhi-farm.json`
/** The device's skill state: trust, enabled, provenance. */
export const SKILLS_STATE_PATH = '.ohhi/skills.json'

/** The two calls the loader needs. `list(dir)` answers every FILE below `dir`, deep, vault-relative. */
export interface SkillFs {
  list(dir: string): Promise<string[]>
  read(path: string): Promise<string | null>
}

export const SKILL_KINDS: readonly SkillKind[] = ['check', 'transform', 'generate', 'research']
export const SKILL_INPUTS: readonly SkillInput[] = ['selection', 'section', 'note', 'folder']
export const SKILL_OUTPUTS: readonly SkillOutput[] = ['replace', 'insert', 'annotate', 'new-note']

/**
 * Every validation problem the loader reports, as a stable code. Agents read
 * them as they are; the app words them from its dictionary.
 */
export const SKILL_PROBLEMS = [
  'frontmatter-missing',
  'frontmatter-invalid',
  'name-missing',
  'name-format',
  'name-length',
  'name-mismatch',
  'name-reserved',
  'description-missing',
  'description-length',
  'compatibility-length',
  'metadata-nested',
  'metadata-kind',
  'metadata-input',
  'metadata-output',
  'body-length',
  'lint-command',
  'lint-context',
  'lint-hooks',
] as const
export type SkillProblem = (typeof SKILL_PROBLEMS)[number]

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const MAX_SKILL_NAME = 64
const MAX_NAME = MAX_SKILL_NAME
const MAX_DESCRIPTION = 1024
const MAX_COMPATIBILITY = 500
const MAX_BODY_LINES = 500
/** Claude Code's `!`cmd`` shell injection: a skill that would run a command on load. */
const BANG_COMMAND = /!`[^`\n]+`/

// ---- the frontmatter reader ---------------------------------------------------

type FmValue = string | string[] | Record<string, string> | { nested: true }

interface FmRead {
  /** False when the block exists but a line is outside what this reader takes. */
  ok: boolean
  fields: Map<string, FmValue>
  body: string
}

function unquote(raw: string): string {
  const text = raw.trim()
  const dq = /^"(.*)"$/.exec(text)
  if (dq) return dq[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
  const sq = /^'(.*)'$/.exec(text)
  if (sq) return sq[1].replace(/''/g, "'")
  // A trailing ` # comment` on a plain scalar is YAML's, not the value's.
  return text.replace(/\s+#.*$/, '')
}

const indentOf = (line: string): number => line.length - line.trimStart().length

/** `>` folds lines into spaces (blank line = newline); `|` keeps them. Chomping: clip, `-` strip. */
function blockScalar(style: string, lines: string[]): string {
  const indent = Math.min(...lines.filter((l) => l.trim() !== '').map(indentOf))
  const body = lines.map((l) => (l.trim() === '' ? '' : l.slice(indent)))
  while (body.length > 0 && body[body.length - 1] === '') body.pop()
  let text: string
  if (style.startsWith('|')) {
    text = body.join('\n')
  } else {
    text = ''
    for (const line of body) {
      if (line === '') text += '\n'
      else text += text === '' || text.endsWith('\n') ? line : ` ${line}`
    }
  }
  return style.includes('-') ? text : `${text}\n`
}

/** The frontmatter block and what follows it. Pure; never throws. */
export function readSkillFrontmatter(text: string): FmRead | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  if (lines[0]?.trimEnd() !== '---') return null
  const end = lines.findIndex((line, i) => i > 0 && (line.trimEnd() === '---' || line.trimEnd() === '...'))
  if (end === -1) return null
  const block = lines.slice(1, end)
  const fields = new Map<string, FmValue>()
  let ok = true
  let i = 0
  while (i < block.length) {
    const line = block[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i++
      continue
    }
    const m = /^([A-Za-z_][\w.-]*)\s*:(.*)$/.exec(line)
    if (!m || indentOf(line) > 0) {
      ok = false
      i++
      continue
    }
    const key = m[1]
    const rest = m[2].trim()
    // The lines that belong to this key: indented, or blank between indented ones.
    let j = i + 1
    while (j < block.length && (block[j].trim() === '' || indentOf(block[j]) > 0)) j++
    const child = block.slice(i + 1, j)
    while (child.length > 0 && child[child.length - 1].trim() === '') child.pop()
    i = j

    if (/^[>|][+-]?$/.test(rest)) {
      fields.set(key, child.length ? blockScalar(rest, child) : '')
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim()
      fields.set(key, inner === '' ? [] : inner.split(',').map((s) => unquote(s)))
    } else if (rest !== '') {
      // A plain scalar may continue on indented lines (YAML folds them with a space).
      const more = child.map((l) => l.trim()).filter((l) => l !== '')
      fields.set(key, [unquote(rest), ...more].join(' '))
    } else if (child.length === 0) {
      fields.set(key, '')
    } else if (child.every((l) => l.trim() === '' || /^\s*-(\s|$)/.test(l))) {
      fields.set(key, child.filter((l) => l.trim() !== '').map((l) => unquote(l.trim().slice(1))))
    } else {
      // A map: exactly one level of `key: scalar`, all at one indent.
      const items = child.filter((l) => l.trim() !== '' && !l.trimStart().startsWith('#'))
      const indent = indentOf(items[0])
      const map: Record<string, string> = {}
      let nested = false
      for (const item of items) {
        const kv = /^\s*([^\s:#][^:]*?)\s*:(.*)$/.exec(item)
        const value = kv?.[2].trim() ?? ''
        if (!kv || indentOf(item) !== indent || value === '' || /^[>|[{&*]/.test(value)) {
          nested = true
          break
        }
        map[unquote(kv[1])] = unquote(value)
      }
      fields.set(key, nested ? { nested: true } : map)
    }
  }
  const body = lines.slice(end + 1).join('\n')
  return { ok, fields, body }
}

// ---- parse + validate ---------------------------------------------------------

/** The spec's name rule, as problem codes: lowercase words joined by `-`, ≤ 64, never reserved. */
export function skillNameProblems(name: string): SkillProblem[] {
  const problems: SkillProblem[] = []
  if (!NAME.test(name)) problems.push('name-format')
  if (name.length > MAX_NAME) problems.push('name-length')
  if (/anthropic|claude/.test(name) || name === 'synced') problems.push('name-reserved')
  return problems
}

/** A name a skill may have (and a folder under `.agents/skills/` or `.claude/skills/` may be called). */
export const isValidSkillName = (name: string): boolean => skillNameProblems(name).length === 0

const asString = (v: FmValue | undefined): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : undefined

const oneOf = <T extends string>(values: readonly T[], v: string | undefined): T | undefined =>
  v !== undefined && (values as readonly string[]).includes(v) ? (v as T) : undefined

/**
 * One SKILL.md, parsed and validated. `dir` is the skill's vault-relative
 * folder (its last segment is what `name` must equal); `files` every file in
 * it (for `hasScripts`).
 */
export function parseSkill(dir: string, text: string, files: readonly string[] = []): { meta: SkillMeta; body: string } {
  const folder = dir.split('/').pop() ?? ''
  const problems: SkillProblem[] = []
  const read = readSkillFrontmatter(text)
  if (!read) problems.push('frontmatter-missing')
  else if (!read.ok) problems.push('frontmatter-invalid')
  const fields = read?.fields ?? new Map<string, FmValue>()
  const body = read ? read.body.replace(/^\n+/, '') : text

  const name = asString(fields.get('name'))?.trim() ?? ''
  if (name === '') problems.push('name-missing')
  else {
    const nameProblems = skillNameProblems(name)
    problems.push(...nameProblems.filter((p) => p !== 'name-reserved'))
    if (name !== folder) problems.push('name-mismatch')
    if (nameProblems.includes('name-reserved')) problems.push('name-reserved')
  }

  const description = asString(fields.get('description'))?.trim() ?? ''
  if (description === '') problems.push('description-missing')
  else if (description.length > MAX_DESCRIPTION) problems.push('description-length')

  const compatibility = asString(fields.get('compatibility'))?.trim()
  if (compatibility !== undefined && compatibility.length > MAX_COMPATIBILITY) problems.push('compatibility-length')
  const license = asString(fields.get('license'))?.trim()

  const rawMeta = fields.get('metadata')
  const metadata: Record<string, string> = {}
  if (rawMeta !== undefined && rawMeta !== '') {
    if (typeof rawMeta === 'object' && !Array.isArray(rawMeta) && !('nested' in rawMeta)) Object.assign(metadata, rawMeta)
    else problems.push('metadata-nested')
  }
  const kind = oneOf(SKILL_KINDS, metadata['ohhi-kind'])
  const input = oneOf(SKILL_INPUTS, metadata['ohhi-input'])
  const output = oneOf(SKILL_OUTPUTS, metadata['ohhi-output'])
  if (metadata['ohhi-kind'] !== undefined && !kind) problems.push('metadata-kind')
  if (metadata['ohhi-input'] !== undefined && !input) problems.push('metadata-input')
  if (metadata['ohhi-output'] !== undefined && !output) problems.push('metadata-output')

  if (body.split('\n').length > MAX_BODY_LINES) problems.push('body-length')
  if (BANG_COMMAND.test(body)) problems.push('lint-command')
  if (fields.has('context')) problems.push('lint-context')
  if (fields.has('hooks')) problems.push('lint-hooks')

  const meta: SkillMeta = {
    name: name || folder,
    description,
    dir,
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    metadata,
    ...(kind ? { kind } : {}),
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    hasScripts: files.some((f) => f.startsWith(`${dir}/scripts/`)),
    problems,
  }
  return { meta, body }
}

/** The skill folders under `root`, from a deep file list: `<root>/<name>/SKILL.md`. */
function skillDirs(root: string, files: readonly string[]): string[] {
  const dirs = new Set<string>()
  for (const file of files) {
    const rest = file.slice(root.length + 1).split('/')
    if (file.startsWith(`${root}/`) && rest.length === 2 && rest[1] === 'SKILL.md') dirs.add(`${root}/${rest[0]}`)
  }
  return [...dirs].sort()
}

/**
 * The content hash of a whole skill folder: every file below `dir`, sorted
 * by path, as `relative path NUL text NUL`, sha-256. A BOM and CRLF line ends
 * are normalised away, so two hosts reading the same folder agree. Trust is
 * given to this hash: a script or reference that changes after review drops
 * it exactly as a SKILL.md change does.
 */
export async function hashSkillFolder(fs: SkillFs, dir: string, files?: readonly string[]): Promise<string> {
  const inside = (files ?? (await fs.list(dir))).filter((f) => f.startsWith(`${dir}/`)).sort()
  let joined = ''
  for (const file of inside) {
    const text = ((await fs.read(file)) ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    joined += `${file.slice(dir.length + 1)}\0${text}\0`
  }
  return hashText(joined)
}

/** Every skill under `root` (default `.agents/skills`), sorted by folder. Invalid ones included, with problems. */
export async function loadSkills(fs: SkillFs, root: string = SKILLS_DIR): Promise<SkillMeta[]> {
  const files = await fs.list(root)
  const out: SkillMeta[] = []
  for (const dir of skillDirs(root, files)) {
    const text = await fs.read(`${dir}/SKILL.md`)
    if (text === null) continue
    const { meta } = parseSkill(dir, text, files)
    out.push({ ...meta, hash: await hashSkillFolder(fs, dir, files) })
  }
  return out
}

/** One skill by folder name, or null when there is no `<root>/<name>/SKILL.md`. */
export async function loadSkill(
  fs: SkillFs,
  name: string,
  root: string = SKILLS_DIR
): Promise<{ meta: SkillMeta; body: string } | null> {
  if (name === '' || name.includes('/') || name.startsWith('.')) return null
  const dir = `${root}/${name}`
  const text = await fs.read(`${dir}/SKILL.md`)
  if (text === null) return null
  const files = await fs.list(dir)
  const found = parseSkill(dir, text, files)
  return { meta: { ...found.meta, hash: await hashSkillFolder(fs, dir, files) }, body: found.body }
}

export const isValidSkill = (meta: Pick<SkillMeta, 'problems'>): boolean => meta.problems.length === 0

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The tier-1 catalog in the spec's integration-guide format: one `<skill>`
 * per VALID skill with its name, description and SKILL.md location; `''`
 * when there are none, so a prompt can leave the section out. Callers pass
 * only the skills a model may use (in the app: trusted and enabled).
 */
export function skillsCatalog(metas: readonly Pick<SkillMeta, 'name' | 'description' | 'dir' | 'problems'>[]): string {
  const rows = metas
    .filter(isValidSkill)
    .map(
      (m) =>
        `  <skill>\n    <name>${escapeXml(m.name)}</name>\n    <description>${escapeXml(m.description)}</description>\n    <location>${escapeXml(`${m.dir}/SKILL.md`)}</location>\n  </skill>`
    )
  return rows.length === 0 ? '' : ['<available_skills>', ...rows, '</available_skills>'].join('\n')
}

// ---- the device's skill state and the farm ----------------------------------

/** One row of `.ohhi/skills.json`. */
export interface SkillState {
  enabled: boolean
  /** False until the person reviewed it: a skill that arrived by sync or an outside write. */
  trusted: boolean
  /** Where it came from: `local` (made here), `github:owner/repo/path`, `folder:<name>`. */
  source?: string
  /** The commit an import was pinned to. */
  sha?: string
  /** The folder's `hashSkillFolder` when it was last trusted: trust holds only while the folder still hashes to it. */
  hash?: string
  installedAt: number
  /** When the person last reviewed and trusted it; changes from elsewhere after this drop trust. */
  reviewedAt?: number
  lastUsed?: number
}
export type SkillsState = Record<string, SkillState>

/** `.ohhi/skills.json`'s text for a state (the one rendering every writer uses). */
export const renderSkillsState = (state: SkillsState): string => `${JSON.stringify(state, null, 2)}\n`

/** `.ohhi/skills.json`'s text → the state; malformed rows are dropped, a malformed file is `{}`. */
export function parseSkillsState(text: string | null): SkillsState | null {
  if (text === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: SkillsState = {}
  for (const [name, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    if (typeof r.enabled !== 'boolean' || typeof r.trusted !== 'boolean') continue
    out[name] = {
      enabled: r.enabled,
      trusted: r.trusted,
      ...(typeof r.source === 'string' ? { source: r.source } : {}),
      ...(typeof r.sha === 'string' ? { sha: r.sha } : {}),
      ...(typeof r.hash === 'string' ? { hash: r.hash } : {}),
      installedAt: typeof r.installedAt === 'number' ? r.installedAt : 0,
      ...(typeof r.reviewedAt === 'number' ? { reviewedAt: r.reviewedAt } : {}),
      ...(typeof r.lastUsed === 'number' ? { lastUsed: r.lastUsed } : {}),
    }
  }
  return out
}

/**
 * The skills a model or another harness may see: valid, and trusted and
 * enabled in `state` — and the folder must still hash to what was trusted
 * (`meta.hash === state[name].hash`; a row with no hash, or a meta loaded
 * without one, is untrusted). With no state file at all (a vault the app
 * never opened — the CLI's case) every valid skill is in: the person put it
 * there.
 */
export function usableSkills<M extends Pick<SkillMeta, 'name' | 'problems' | 'hash'>>(metas: readonly M[], state: SkillsState | null): M[] {
  return metas.filter((m) => {
    if (!isValidSkill(m)) return false
    if (state === null) return true
    const row = state[m.name]
    return row?.trusted === true && row.enabled === true && row.hash !== undefined && row.hash === m.hash
  })
}

/** `usableSkills` as one meta's predicate — the `allow` a `createSkillSource` takes. */
export const usableBy =
  (state: SkillsState | null) =>
  (meta: Pick<SkillMeta, 'name' | 'problems' | 'hash'>): boolean =>
    usableSkills([meta], state).length > 0

/** What the farm's manifest records per entry: who made it and how. */
export interface FarmEntry {
  by: 'cli' | 'app'
  kind: 'symlink' | 'copy'
  /** The files written (copies only), vault-relative, so removal deletes exactly those. */
  files?: string[]
}
export interface FarmManifest {
  version: 1
  skills: Record<string, FarmEntry>
}

/**
 * A file a farm entry may own: vault-relative, strictly inside
 * `.claude/skills/<name>/`, no `.`/`..`/empty segment, no backslash.
 */
export function isFarmFileOf(name: string, file: string): boolean {
  const prefix = `${FARM_DIR}/${name}/`
  if (!file.startsWith(prefix) || file.includes('\\')) return false
  return file
    .slice(prefix.length)
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/**
 * The manifest's text → the manifest. It is a file in the vault, so anyone
 * can edit it: an entry whose name is not a valid skill name, or whose files
 * reach outside its own `.claude/skills/<name>/`, is dropped whole — the farm
 * then treats that folder as someone else's and never deletes from it.
 */
export function parseFarmManifest(text: string | null): FarmManifest {
  const empty: FarmManifest = { version: 1, skills: {} }
  if (text === null) return empty
  try {
    const raw = JSON.parse(text) as Partial<FarmManifest>
    if (raw?.version !== 1 || !raw.skills || typeof raw.skills !== 'object') return empty
    const skills: Record<string, FarmEntry> = {}
    for (const [name, e] of Object.entries(raw.skills)) {
      if (!isValidSkillName(name)) continue
      if (!e || (e.by !== 'cli' && e.by !== 'app') || (e.kind !== 'symlink' && e.kind !== 'copy')) continue
      if (e.files !== undefined && !Array.isArray(e.files)) continue
      const files = e.files ?? []
      if (!files.every((f) => typeof f === 'string' && isFarmFileOf(name, f))) continue
      skills[name] = { by: e.by, kind: e.kind, ...(e.files ? { files: [...files] } : {}) }
    }
    return { version: 1, skills }
  } catch {
    return empty
  }
}

export const renderFarmManifest = (m: FarmManifest): string => `${JSON.stringify(m, null, 2)}\n`

/**
 * The farm's plan: which names to (re)write and which of its OWN earlier
 * entries to remove. A name already present in the farm that the manifest
 * does not record is someone's real folder: it is `blocked`, never touched.
 */
export function planFarm(input: {
  wanted: readonly string[]
  manifest: FarmManifest
  /** Names present under `.claude/skills/` right now. */
  present: readonly string[]
}): { write: string[]; remove: string[]; blocked: string[] } {
  const ours = new Set(Object.keys(input.manifest.skills))
  const present = new Set(input.present)
  const wanted = new Set(input.wanted)
  const write: string[] = []
  const blocked: string[] = []
  for (const name of [...wanted].sort()) {
    if (present.has(name) && !ours.has(name)) blocked.push(name)
    else write.push(name)
  }
  const remove = [...ours].filter((name) => !wanted.has(name)).sort()
  return { write, remove, blocked }
}

// ---- the farm's file side (one home for the CLI and the app) ----------------

/**
 * What the farm writes through: a vault adapter's read and write side. The
 * CLI hands in a Node one, the app its vault adapter.
 */
export interface FarmFs {
  read(path: string): Promise<Uint8Array | null>
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>
  /** Remove one file (or a link). A path that is already gone is not an error. */
  remove(path: string): Promise<void>
  /** Remove an EMPTY folder; refuses (throws) a non-empty one. */
  removeDir(path: string): Promise<void>
  /** Golden rule 1, when the host has a journal: the bytes a write or removal replaces, first. */
  record?(path: string, bytes: Uint8Array | null): Promise<void>
  /** Is `path` a symbolic link? (A host without links leaves it out.) */
  isLink?(path: string): Promise<boolean>
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
  a !== null && a.length === b.length && a.every((v, i) => v === b[i])

/** Write one farm file: unchanged bytes are left alone; otherwise the pre-image is recorded first. */
export async function writeFarmFile(fs: FarmFs, path: string, bytes: Uint8Array): Promise<void> {
  const before = await fs.read(path)
  if (sameBytes(before, bytes)) return
  await fs.record?.(path, before)
  await fs.writeAtomic(path, bytes)
}

/** The manifest as it is now, with its text (`null`: no manifest yet) for `writeFarmManifest`. */
export async function readFarmManifest(fs: Pick<FarmFs, 'read'>): Promise<{ manifest: FarmManifest; text: string | null }> {
  const bytes = await fs.read(FARM_MANIFEST)
  const text = bytes ? new TextDecoder().decode(bytes) : null
  return { manifest: parseFarmManifest(text), text }
}

/** Write the manifest when it changed from `before` (its text as read), journaled. */
export async function writeFarmManifest(fs: FarmFs, next: FarmManifest, before: string | null): Promise<void> {
  const text = renderFarmManifest(next)
  if (text !== before) await writeFarmFile(fs, FARM_MANIFEST, new TextEncoder().encode(text))
}

/**
 * Take away one entry the farm made: a link is removed (never followed); a
 * copy loses exactly the files the manifest lists — each one's bytes recorded
 * first — then the folders it leaves empty, deepest first. A folder someone
 * added a file to stays (`removeDir` refuses it). False when the platform
 * refused a removal, or the entry is not one the farm could have made.
 */
export async function removeFarmEntry(fs: FarmFs, name: string, entry: FarmEntry): Promise<boolean> {
  if (!isValidSkillName(name)) return false
  const root = `${FARM_DIR}/${name}`
  try {
    if (entry.kind === 'symlink' || (await fs.isLink?.(root))) {
      await fs.remove(root)
      return true
    }
    const files = entry.files ?? []
    if (!files.every((f) => isFarmFileOf(name, f))) return false
    for (const file of files) {
      const bytes = await fs.read(file)
      if (bytes === null) continue
      await fs.record?.(file, bytes)
      await fs.remove(file)
    }
    const dirs = new Set<string>()
    for (const file of files) {
      for (let d = file.slice(0, file.lastIndexOf('/')); d === root || d.startsWith(`${root}/`); d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d)
    }
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) await fs.removeDir(d).catch(() => undefined)
    return true
  } catch {
    return false
  }
}
