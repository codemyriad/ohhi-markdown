/**
 * Spike S10-Q4 — a synthetic vault shaped like Chris's real one.
 *
 * Shape comes from `v2-shaping` §Evidence (the live corpus, measured):
 * 1,029 `.md` / 3.02 MB, wikilinks in 29% of files, frontmatter in 1.5%,
 * checkboxes the highest-count construct, folders 2–4 levels deep.
 *
 * Deterministic: every path, size and byte comes from a seeded mulberry32
 * (`@ohhi/testkit`), so two runs of the bench pull an identical corpus.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mulberry32, pick, randInt, type Rng } from '@ohhi/testkit'

const TOP = [
  'Areas', 'Projects', 'Journal', 'Notes', 'Resources',
  'Archive', 'TODO', 'People', 'Meetings', 'Reading', 'Snippets', 'Inbox',
]
const MID = [
  'CS', 'Data Vis', 'Systems', 'Design', 'Health', 'Finance', 'Team',
  'Weekly', 'Daily', 'Papers', 'Talks', 'Recipes', 'Travel', 'Music',
]
const LEAF = ['drafts', 'notes', 'archive', 'refs', 'log', 'wip']
const WORDS = [
  'vault', 'reconciler', 'markdown', 'sync', 'relay', 'folder', 'mount', 'device',
  'index', 'wikilink', 'checkbox', 'frontmatter', 'provider', 'snapshot', 'journal',
  'merge', 'branch', 'commit', 'latency', 'throughput', 'cursor', 'editor', 'peer',
  'offline', 'durable', 'atomic', 'rename', 'tombstone', 'carve', 'adopt', 'token',
  'segment', 'palavra', 'saudade', 'estrutura', 'ideia', 'projeto', 'memória',
]

export interface GeneratedVault {
  files: number
  bytes: number
  /** Vault-relative paths, in creation order. */
  paths: string[]
  maxDepth: number
}

/** Long-tailed size: ~0.5 KB floor, ~3 KB mean, 20 KB tail (u^7 shaping). */
function targetBytes(rng: Rng): number {
  return 512 + Math.floor(Math.pow(rng(), 7) * 20_000)
}

function sentence(rng: Rng, n: number): string {
  const words: string[] = []
  for (let i = 0; i < n; i++) words.push(pick(rng, WORDS))
  return `${words.join(' ')}.`
}

function buildDirs(rng: Rng): string[] {
  const dirs: string[] = ['']
  for (const top of TOP) {
    dirs.push(top)
    const mids = randInt(rng, 2, 7)
    for (let i = 0; i < mids; i++) {
      const mid = `${top}/${pick(rng, MID)}`
      dirs.push(mid)
      if (rng() < 0.45) dirs.push(`${mid}/${pick(rng, LEAF)}`)
    }
  }
  return [...new Set(dirs)]
}

function body(rng: Rng, title: string, size: number, targets: string[]): string {
  const out: string[] = []
  // 1.5% of the real vault has frontmatter; keep the machinery represented.
  if (rng() < 0.015) {
    out.push('---', `title: ${title}`, `tags: [${pick(rng, WORDS)}]`, '---', '')
  }
  out.push(`# ${title}`, '')
  const wantsLinks = rng() < 0.29 // 29% of files carry wikilinks
  let bytes = out.join('\n').length
  while (bytes < size) {
    const roll = rng()
    let line: string
    if (roll < 0.12) line = `- [${rng() < 0.4 ? 'x' : ' '}] ${sentence(rng, randInt(rng, 4, 12))}`
    else if (roll < 0.2) line = `## ${sentence(rng, randInt(rng, 2, 5))}`
    else if (roll < 0.26) line = '```ts\nconst x = 1\n```'
    else if (roll < 0.3 && wantsLinks && targets.length > 0)
      line = `See [[${pick(rng, targets)}]] and ${sentence(rng, randInt(rng, 5, 15))}`
    else line = sentence(rng, randInt(rng, 8, 30))
    out.push(line, '')
    bytes += line.length + 2
  }
  return `${out.join('\n')}\n`
}

/** Write `count` markdown files under `root`. Returns what landed on disk. */
export async function generateVault(
  root: string,
  count: number,
  seed: number
): Promise<GeneratedVault> {
  const rng = mulberry32(seed)
  const dirs = buildDirs(rng)
  const paths: string[] = []
  const names = new Set<string>()
  for (let i = 0; i < count; i++) {
    const dir = pick(rng, dirs)
    let name = `${pick(rng, WORDS)}-${pick(rng, WORDS)}-${i}`
    while (names.has(name)) name = `${name}x`
    names.add(name)
    paths.push(dir ? `${dir}/${name}.md` : `${name}.md`)
  }
  const basenames = paths.map((p) => p.slice(p.lastIndexOf('/') + 1, -3))

  let bytes = 0
  let maxDepth = 0
  for (const [i, path] of paths.entries()) {
    const abs = join(root, path)
    await mkdir(dirname(abs), { recursive: true })
    const text = body(rng, basenames[i]!, targetBytes(rng), basenames.slice(0, i))
    await writeFile(abs, text)
    bytes += Buffer.byteLength(text)
    maxDepth = Math.max(maxDepth, path.split('/').length - 1)
  }
  return { files: paths.length, bytes, paths, maxDepth }
}
