/**
 * Bringing a skill in from outside: a GitHub folder pinned to a commit, or a
 * folder on this computer (desktop) — and the review a person reads before
 * anything is written or trusted. A skill already in the vault (it synced in)
 * is reviewed the same way (`candidateFromVault`).
 *
 * A candidate carries every file's bytes: an import writes them all, as they
 * are — scripts, images, a LICENSE without an extension — so the folder on
 * disk is the folder that was reviewed. Text files are shown in the review;
 * binaries are listed, never shown.
 */
import { getLL } from '@ohhi/i18n'
import { looksBinary } from '@ohhi/vault'
import type { SkillMeta } from '@ohhi/harness'
import { hashSkillFolder, loadSkill, parseSkill, readSkillFrontmatter, SKILLS_DIR, type SkillFs } from '@ohhi/harness/skills'

/** One file of a skill being imported or reviewed. */
export interface ImportFile {
  /** Relative to the skill's folder: `SKILL.md`, `references/style.md`. */
  rel: string
  bytes: Uint8Array
  /** The text, for a text file; absent for a binary (listed in the review, never shown). */
  text?: string
  size: number
}

export interface ImportCandidate {
  /** The folder name it will get under `.agents/skills/`. */
  name: string
  /** `github:owner/repo/path`, `folder:<name>`, or `vault` for a skill already here. */
  source: string
  /** The commit an import from GitHub is pinned to. */
  sha?: string
  files: ImportFile[]
}

const decoder = new TextDecoder()

/** A file's bytes as an `ImportFile`: text when it reads as text. */
export function importFile(rel: string, bytes: Uint8Array): ImportFile {
  return looksBinary(rel, bytes) ? { rel, bytes, size: bytes.length } : { rel, bytes, text: decoder.decode(bytes), size: bytes.length }
}

/** A relative path an import may write: inside the skill's folder, no `.`/`..`/empty segment, no backslash. */
export function safeRel(rel: string): boolean {
  return !rel.includes('\\') && rel.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

/** The candidate's files as a `SkillFs` rooted where it will be installed — for its hash and its parse. */
export function candidateFs(candidate: ImportCandidate): { fs: SkillFs; dir: string } {
  const dir = `${SKILLS_DIR}/${candidate.name}`
  const byPath = new Map(candidate.files.map((f) => [`${dir}/${f.rel}`, f.text ?? decoder.decode(f.bytes)]))
  return {
    dir,
    fs: {
      list: async (d) => [...byPath.keys()].filter((p) => p.startsWith(`${d}/`)).sort(),
      read: async (p) => byPath.get(p) ?? null,
    },
  }
}

/** The folder hash of exactly what a candidate holds — what trusting it trusts. */
export async function candidateHash(candidate: ImportCandidate): Promise<string> {
  const { fs, dir } = candidateFs(candidate)
  return hashSkillFolder(fs, dir)
}

// ---- the review ------------------------------------------------------------------

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
export async function candidateFromVault(
  fs: SkillFs & { readBytes?(path: string): Promise<Uint8Array | null> },
  id: string
): Promise<ImportCandidate | null> {
  const dir = `${SKILLS_DIR}/${id}`
  if (!(await loadSkill(fs, id))) return null
  const files: ImportFile[] = []
  for (const path of await fs.list(dir)) {
    const rel = path.slice(dir.length + 1)
    const bytes = (await fs.readBytes?.(path)) ?? new TextEncoder().encode((await fs.read(path)) ?? '')
    files.push(importFile(rel, bytes))
  }
  return { name: id, source: 'vault', files }
}

// ---- fetching ----------------------------------------------------------------------

/** Why an import failed, as a dictionary key under `ai.skills.import_dialog` plus its arguments. */
export class SkillImportError extends Error {
  constructor(
    readonly code: 'bad_source' | 'no_skill_md' | 'too_many' | 'fetch_failed' | 'network' | 'folder_failed' | 'exists' | 'bad_path' | 'changed',
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
 * and file is read at that sha.
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
    // A file with no raw URL (a submodule, an LFS pointer) cannot be imported as it is: the import fails whole.
    if (!e.download_url) throw new SkillImportError('fetch_failed', { status: 0, path: e.path })
    files.push(importFile(rel, new Uint8Array(await (await get(e.download_url, e.path)).arrayBuffer())))
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
        else if (entry.isFile) files.push(importFile(childRel, await readFile(`${dir}/${entry.name}`)))
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
    case 'exists':
      return t.exists({ name: String(p.name ?? '') })
    case 'bad_path':
      return t.bad_path({ path: String(p.path ?? '') })
    case 'changed':
      return t.changed({ name: String(p.name ?? '') })
  }
}
