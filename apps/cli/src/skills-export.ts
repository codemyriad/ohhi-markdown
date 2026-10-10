/** `ohhi skills export` — the `.claude/skills/` farm for Claude Code; see docs/agent-access.md › Skills. */
import { lstat, mkdir, readdir, readlink, rmdir, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { skillFsOf } from '@ohhi/agent/core'
import {
  FARM_DIR,
  loadSkills,
  parseSkillsState,
  planFarm,
  readFarmManifest,
  removeFarmEntry,
  SKILLS_DIR,
  SKILLS_STATE_PATH,
  usableSkills,
  writeFarmManifest,
  type FarmFs,
  type FarmManifest,
} from '@ohhi/agent/skills'
import { openVault, type Backend } from './backend.js'
import type { SkillsExportCommand } from './grammar.js'
import type { Io, Sink } from './io.js'

/** The `--json` document. Not in `spec/`: this is a host command, not a vault op (as `ohhi ask`). */
export interface SkillsExportOut {
  schema: 'ohhi.skills-export.v1'
  dir: string
  /** Links written (or already right). */
  linked: string[]
  /** Farm entries removed: disabled, untrusted, invalid or gone. */
  removed: string[]
  /** Present in `.claude/skills/` but not made by the farm: never touched. */
  blocked: string[]
  dryRun: boolean
}

const decode = (bytes: Uint8Array | null): string | null => (bytes ? new TextDecoder().decode(bytes) : null)

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException)?.code === 'ENOENT'

/**
 * The farm's `FarmFs` on disk: reads and writes through the vault adapter
 * (atomic), removals as plain unlink/rmdir, every replaced or removed file's
 * bytes recorded in the vault's journal first (golden rule 1).
 */
function nodeFarmFs(backend: Backend): FarmFs {
  const abs = (path: string): string => join(backend.root, path)
  return {
    read: (path) => backend.adapter.read(path),
    writeAtomic: (path, bytes) => backend.adapter.writeAtomic(path, bytes),
    remove: async (path) => {
      await unlink(abs(path)).catch((err: unknown) => {
        if (!isMissing(err)) throw err
      })
    },
    removeDir: (path) => rmdir(abs(path)),
    record: (path, bytes) => backend.journal.record(path, bytes),
    isLink: async (path) => (await lstat(abs(path)).catch(() => null))?.isSymbolicLink() === true,
  }
}

/** What is in `.claude/skills/` now (names only; the manifest itself excluded). */
async function presentNames(farm: string): Promise<string[]> {
  try {
    return (await readdir(farm)).filter((name) => !name.startsWith('.'))
  } catch {
    return []
  }
}

/** Is the entry gone from disk (a removal may leave a folder someone added a file to)? */
const gone = async (at: string): Promise<boolean> => (await lstat(at).catch(() => null)) === null

async function isOurLink(at: string, target: string): Promise<boolean> {
  try {
    return (await lstat(at)).isSymbolicLink() && (await readlink(at)) === target
  } catch {
    return false
  }
}

export async function skillsExport(command: SkillsExportCommand, io: Io, sink: Sink): Promise<number> {
  const backend = await openVault(command.globals, io)
  const root = backend.root
  const farm = join(root, FARM_DIR)

  const state = parseSkillsState(decode(await backend.adapter.read(SKILLS_STATE_PATH)))
  // The loader's own list (with each folder's hash, which trust is checked against).
  const wanted = usableSkills(await loadSkills(skillFsOf(backend)), state).map((s) => s.name)
  const fs = nodeFarmFs(backend)
  const { manifest, text: manifestBefore } = await readFarmManifest(fs)
  const plan = planFarm({ wanted, manifest, present: await presentNames(farm) })

  const next: FarmManifest = { version: 1, skills: { ...manifest.skills } }
  const removed: string[] = []
  const blocked = [...plan.blocked]

  if (!command.dryRun) {
    await mkdir(farm, { recursive: true })
    for (const name of plan.write) {
      const at = join(farm, name)
      const target = `../../${SKILLS_DIR}/${name}`
      if (!(await isOurLink(at, target))) {
        const prior = manifest.skills[name]
        if (prior && !((await removeFarmEntry(fs, name, prior)) && (await gone(at)))) {
          blocked.push(name)
          continue
        }
        await symlink(target, at, 'dir')
      }
      next.skills[name] = { by: 'cli', kind: 'symlink' }
    }
    for (const name of plan.remove) {
      if ((await removeFarmEntry(fs, name, manifest.skills[name])) && (await gone(join(farm, name)))) {
        delete next.skills[name]
        removed.push(name)
      } else {
        blocked.push(name)
      }
    }
    await writeFarmManifest(fs, next, manifestBefore)
  } else {
    removed.push(...plan.remove)
  }

  const linked = command.dryRun ? plan.write : plan.write.filter((n) => !blocked.includes(n))
  const out: SkillsExportOut = {
    schema: 'ohhi.skills-export.v1',
    dir: FARM_DIR,
    linked,
    removed,
    blocked: [...new Set(blocked)].sort(),
    dryRun: command.dryRun,
  }
  if (command.globals.json) {
    sink.raw(JSON.stringify(out) + '\n')
  } else {
    for (const name of out.linked) sink.out(`${command.dryRun ? 'would link' : 'linked'}  ${FARM_DIR}/${name} -> ../../${SKILLS_DIR}/${name}`)
    for (const name of out.removed) sink.out(`${command.dryRun ? 'would remove' : 'removed'} ${FARM_DIR}/${name}`)
    sink.err(`linked=${out.linked.length} removed=${out.removed.length} blocked=${out.blocked.length}${state === null ? ` (no ${SKILLS_STATE_PATH}: every valid skill)` : ''}`)
    for (const name of out.blocked) sink.err(`blocked: ${FARM_DIR}/${name} exists and the farm did not make it — left alone`)
  }
  return 0
}
