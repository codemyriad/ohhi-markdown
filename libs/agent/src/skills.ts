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
import type { SkillMeta as SkillMetaSchema } from './contract.js'

export type SkillMeta = z.infer<typeof SkillMetaSchema>
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
const MAX_NAME = 64
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
    if (!NAME.test(name)) problems.push('name-format')
    if (name.length > MAX_NAME) problems.push('name-length')
    if (name !== folder) problems.push('name-mismatch')
    if (/anthropic|claude/.test(name) || name === 'synced') problems.push('name-reserved')
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

/** Every skill under `root` (default `.agents/skills`), sorted by folder. Invalid ones included, with problems. */
export async function loadSkills(fs: SkillFs, root: string = SKILLS_DIR): Promise<SkillMeta[]> {
  const files = await fs.list(root)
  const out: SkillMeta[] = []
  for (const dir of skillDirs(root, files)) {
    const text = await fs.read(`${dir}/SKILL.md`)
    if (text === null) continue
    out.push(parseSkill(dir, text, files).meta)
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
  return parseSkill(dir, text, await fs.list(dir))
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
  /** SKILL.md's content hash when it was last trusted; a change from elsewhere drops trust. */
  hash?: string
  installedAt: number
  /** When the person last reviewed and trusted it; changes from elsewhere after this drop trust. */
  reviewedAt?: number
  lastUsed?: number
}
export type SkillsState = Record<string, SkillState>

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
 * enabled in `state`. With no state file at all (a vault the app never
 * opened — the CLI's case) every valid skill is in: the person put it there.
 */
export function usableSkills<M extends Pick<SkillMeta, 'name' | 'problems'>>(metas: readonly M[], state: SkillsState | null): M[] {
  return metas.filter((m) => isValidSkill(m) && (state === null || (state[m.name]?.trusted === true && state[m.name]?.enabled === true)))
}

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

export function parseFarmManifest(text: string | null): FarmManifest {
  const empty: FarmManifest = { version: 1, skills: {} }
  if (text === null) return empty
  try {
    const raw = JSON.parse(text) as Partial<FarmManifest>
    if (raw?.version !== 1 || !raw.skills || typeof raw.skills !== 'object') return empty
    const skills: Record<string, FarmEntry> = {}
    for (const [name, e] of Object.entries(raw.skills)) {
      if (!e || (e.by !== 'cli' && e.by !== 'app') || (e.kind !== 'symlink' && e.kind !== 'copy')) continue
      skills[name] = { by: e.by, kind: e.kind, ...(Array.isArray(e.files) ? { files: e.files.filter((f) => typeof f === 'string') } : {}) }
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
