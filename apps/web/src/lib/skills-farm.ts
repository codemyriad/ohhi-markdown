/**
 * The app's `.claude/skills/` farm (writing-harness-shaping B9, Fork 6-A).
 *
 * Claude Code reads `.claude/skills/`, not `.agents/skills/`. The CLI's
 * `ohhi skills export` symlinks; the app cannot (the Tauri fs plugin has no
 * symlink call, and OPFS has no disk anyone else reads), so it COPIES each
 * usable skill — trusted, enabled, valid — through the vault adapter, and
 * re-copies when one changes. `.claude` is in `IGNORED_DIRS`, so the copies
 * never echo into the tree, the index or sync.
 *
 * Both writers keep ONE manifest, `.claude/skills/.ohhi-farm.json`
 * (`FarmManifest` in `@ohhi/agent/skills`): what each wrote, and for a copy
 * every file. So the app never deletes a folder it did not make — a name in
 * `.claude/skills/` the manifest does not record is someone's own skill,
 * `blocked` and untouched — and the CLI and the app never delete each
 * other's entries unknowingly. A CLI symlink is left as it is while the
 * skill is wanted (it already shows the skill); when the skill is no longer
 * wanted the app removes the link, and if the platform refuses, reports it.
 *
 * Pure over a `FarmFs` (structurally a `VaultAdapter`'s write side), so the
 * test drives it with an in-memory adapter.
 */
import {
  FARM_DIR,
  FARM_MANIFEST,
  parseFarmManifest,
  planFarm,
  renderFarmManifest,
  SKILLS_DIR,
  type FarmEntry,
  type FarmManifest,
  type SkillFs,
} from '@ohhi/harness/skills'

/** What the farm writes through: a vault adapter's read and write side. */
export interface FarmFs {
  read(path: string): Promise<Uint8Array | null>
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
  removeDir(path: string): Promise<void>
  /** Golden rule 1, when the host has a journal: the bytes a write replaces, first. */
  record?(path: string, bytes: Uint8Array | null): Promise<void>
}

export interface FarmResult {
  /** Copied (or already up to date). */
  written: string[]
  /** Farm entries taken away: no longer wanted. */
  removed: string[]
  /** Present and not the farm's, or a removal the platform refused: left alone. */
  blocked: string[]
  /** CLI symlinks left in place (they already expose the skill). */
  linked: string[]
}

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean =>
  a !== null && a.length === b.length && a.every((v, i) => v === b[i])

async function write(fs: FarmFs, path: string, bytes: Uint8Array): Promise<void> {
  const before = await fs.read(path)
  if (sameBytes(before, bytes)) return
  await fs.record?.(path, before)
  await fs.writeAtomic(path, bytes)
}

/** Take away exactly what an entry recorded, then the folders it leaves empty. */
async function removeEntry(fs: FarmFs, name: string, entry: FarmEntry): Promise<boolean> {
  const root = `${FARM_DIR}/${name}`
  try {
    if (entry.kind === 'symlink') {
      await fs.remove(root)
      return true
    }
    const files = entry.files ?? []
    for (const file of files) {
      await fs.record?.(file, await fs.read(file))
      await fs.remove(file)
    }
    const dirs = new Set<string>()
    for (const file of files) {
      for (let d = file.slice(0, file.lastIndexOf('/')); d.startsWith(root); d = d.slice(0, d.lastIndexOf('/'))) dirs.add(d)
    }
    // Deepest first; a folder someone added a file to stays (removeDir refuses a non-empty one).
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) await fs.removeDir(d).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

async function readManifest(fs: FarmFs): Promise<{ manifest: FarmManifest; text: string | null }> {
  const bytes = await fs.read(FARM_MANIFEST)
  const text = bytes ? new TextDecoder().decode(bytes) : null
  return { manifest: parseFarmManifest(text), text }
}

async function writeManifest(fs: FarmFs, next: FarmManifest, before: string | null): Promise<void> {
  const text = renderFarmManifest(next)
  if (text !== before) await write(fs, FARM_MANIFEST, new TextEncoder().encode(text))
}

/**
 * Make `.claude/skills/` hold exactly `wanted` (skill folder names under
 * `.agents/skills/`), as far as the farm may: copy each wanted skill's files,
 * drop files a skill no longer has, remove the farm's own entries that are no
 * longer wanted, and leave everything else alone.
 */
export async function syncFarm(opts: { fs: FarmFs; skills: SkillFs; wanted: readonly string[] }): Promise<FarmResult> {
  const { fs } = opts
  const { manifest, text } = await readManifest(fs)
  // Only a wanted name the manifest does not know needs a look on disk: is it someone's own skill?
  const unknown = opts.wanted.filter((name) => !manifest.skills[name])
  const present: string[] = []
  for (const name of unknown) if ((await fs.read(`${FARM_DIR}/${name}/SKILL.md`)) !== null) present.push(name)
  const plan = planFarm({ wanted: opts.wanted, manifest, present })

  const next: FarmManifest = { version: 1, skills: { ...manifest.skills } }
  const result: FarmResult = { written: [], removed: [], blocked: [...plan.blocked], linked: [] }

  for (const name of plan.write) {
    const prior = manifest.skills[name]
    if (prior?.kind === 'symlink') {
      result.linked.push(name)
      continue
    }
    const source = `${SKILLS_DIR}/${name}`
    const files: string[] = []
    for (const path of await opts.skills.list(source)) {
      const bytes = await fs.read(path)
      if (!bytes) continue
      const dest = `${FARM_DIR}/${name}${path.slice(source.length)}`
      await write(fs, dest, bytes)
      files.push(dest)
    }
    for (const stale of (prior?.files ?? []).filter((f) => !files.includes(f))) {
      await fs.record?.(stale, await fs.read(stale))
      await fs.remove(stale)
    }
    next.skills[name] = { by: 'app', kind: 'copy', files }
    result.written.push(name)
  }

  for (const name of plan.remove) {
    if (await removeEntry(fs, name, manifest.skills[name])) {
      delete next.skills[name]
      result.removed.push(name)
    } else {
      result.blocked.push(name)
    }
  }

  await writeManifest(fs, next, text)
  return result
}

/**
 * Turn the app's farm off: every copy the APP made goes, nothing else — a CLI
 * link is the CLI's (`ohhi skills export` manages it), and a folder neither
 * made was never the farm's.
 */
export async function clearFarm(fs: FarmFs): Promise<FarmResult> {
  const { manifest, text } = await readManifest(fs)
  const next: FarmManifest = { version: 1, skills: { ...manifest.skills } }
  const result: FarmResult = { written: [], removed: [], blocked: [], linked: [] }
  for (const [name, entry] of Object.entries(manifest.skills)) {
    if (entry.by !== 'app') continue
    if (await removeEntry(fs, name, entry)) {
      delete next.skills[name]
      result.removed.push(name)
    } else {
      result.blocked.push(name)
    }
  }
  await writeManifest(fs, next, text)
  return result
}
