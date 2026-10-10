/**
 * The app's `.claude/skills/` farm: it COPIES each usable skill through the
 * vault adapter (the app cannot make links). How the farm works, its
 * manifest and what it never touches: `docs/agent-access.md` § the skills farm.
 */
import {
  FARM_DIR,
  planFarm,
  readFarmManifest,
  removeFarmEntry,
  SKILLS_DIR,
  writeFarmFile,
  writeFarmManifest,
  type FarmFs,
  type FarmManifest,
  type SkillFs,
} from '@ohhi/harness/skills'

export type { FarmFs }

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

/**
 * Make `.claude/skills/` hold exactly `wanted` (skill folder names under
 * `.agents/skills/`), as far as the farm may: copy each wanted skill's files,
 * drop files a skill no longer has, remove the farm's own entries that are no
 * longer wanted, and leave everything else alone.
 */
export async function syncFarm(opts: { fs: FarmFs; skills: SkillFs; wanted: readonly string[] }): Promise<FarmResult> {
  const { fs } = opts
  const { manifest, text } = await readFarmManifest(fs)
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
      await writeFarmFile(fs, dest, bytes)
      files.push(dest)
    }
    for (const stale of (prior?.files ?? []).filter((f) => !files.includes(f))) {
      const bytes = await fs.read(stale)
      if (bytes === null) continue
      await fs.record?.(stale, bytes)
      await fs.remove(stale)
    }
    next.skills[name] = { by: 'app', kind: 'copy', files }
    result.written.push(name)
  }

  for (const name of plan.remove) {
    if (await removeFarmEntry(fs, name, manifest.skills[name])) {
      delete next.skills[name]
      result.removed.push(name)
    } else {
      result.blocked.push(name)
    }
  }

  await writeFarmManifest(fs, next, text)
  return result
}

/**
 * Turn the app's farm off: every copy the APP made goes, nothing else — a CLI
 * link is the CLI's (`ohhi skills export` manages it), and a folder neither
 * made was never the farm's.
 */
export async function clearFarm(fs: FarmFs): Promise<FarmResult> {
  const { manifest, text } = await readFarmManifest(fs)
  const next: FarmManifest = { version: 1, skills: { ...manifest.skills } }
  const result: FarmResult = { written: [], removed: [], blocked: [], linked: [] }
  for (const [name, entry] of Object.entries(manifest.skills)) {
    if (entry.by !== 'app') continue
    if (await removeFarmEntry(fs, name, entry)) {
      delete next.skills[name]
      result.removed.push(name)
    } else {
      result.blocked.push(name)
    }
  }
  await writeFarmManifest(fs, next, text)
  return result
}
