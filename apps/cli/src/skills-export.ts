/**
 * `ohhi skills export` — the `.claude/skills/` farm for Claude Code
 * (writing-harness B9, Fork 6-A; research note harness-skills §2/§6).
 *
 * `.agents/skills/<name>/` is canonical and read natively by most harnesses;
 * Claude Code reads only `.claude/skills/`. This links each USABLE skill —
 * valid, and trusted + enabled in `.ohhi/skills.json` (no file: every valid
 * skill, the person put it there) — as `.claude/skills/<name>` →
 * `../../.agents/skills/<name>`, and takes away links it made earlier that are
 * no longer wanted (a disabled skill must not keep a link: every harness
 * treats presence as enabled).
 *
 * `.claude/skills/.ohhi-farm.json` records what the farm wrote — this command
 * and the app's copy farm share it — so neither ever deletes a folder it did
 * not make: a name present in `.claude/skills/` that the manifest does not
 * record is someone's real skill, reported `blocked` and left alone.
 *
 * Node-only, and not a contract op (it writes links, not notes). The list is
 * the `skills` op's own answer, so the farm and `ohhi skills` never disagree.
 */
import { lstat, mkdir, readdir, readlink, rmdir, symlink, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runOp, type OpOutput } from '@ohhi/agent'
import {
  FARM_DIR,
  FARM_MANIFEST,
  parseFarmManifest,
  parseSkillsState,
  planFarm,
  renderFarmManifest,
  SKILLS_DIR,
  SKILLS_STATE_PATH,
  usableSkills,
  type FarmEntry,
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

type SkillRow = OpOutput<'skills'>['skills'][number]

async function allSkills(backend: Backend): Promise<SkillRow[]> {
  const out: SkillRow[] = []
  let cursor: string | undefined
  do {
    const page = await runOp(backend, 'skills', { limit: 1000, ...(cursor ? { cursor } : {}) })
    out.push(...page.skills)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return out
}

const decode = (bytes: Uint8Array | null): string | null => (bytes ? new TextDecoder().decode(bytes) : null)

/** What is in `.claude/skills/` now (names only; the manifest itself excluded). */
async function presentNames(farm: string): Promise<string[]> {
  try {
    return (await readdir(farm)).filter((name) => !name.startsWith('.'))
  } catch {
    return []
  }
}

/**
 * Take away one entry the farm made. A link is unlinked; a copy loses exactly
 * the files the manifest lists, then its now-empty folders. Anything left
 * (a file someone added) keeps the folder — reported, never forced.
 */
async function removeOwned(root: string, name: string, entry: FarmEntry): Promise<boolean> {
  const at = join(root, FARM_DIR, name)
  let stats
  try {
    stats = await lstat(at)
  } catch {
    return true // already gone
  }
  if (stats.isSymbolicLink()) {
    await unlink(at)
    return true
  }
  if (entry.kind !== 'copy' || !stats.isDirectory()) return false
  for (const file of entry.files ?? []) await unlink(join(root, file)).catch(() => undefined)
  const dirs = new Set<string>()
  for (const file of entry.files ?? []) {
    for (let d = dirname(join(root, file)); d.startsWith(at); d = dirname(d)) dirs.add(d)
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) await rmdir(d).catch(() => undefined)
  try {
    await lstat(at)
    return false
  } catch {
    return true
  }
}

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
  const wanted = usableSkills(await allSkills(backend), state).map((s) => s.name)
  const manifestBefore = await backend.adapter.read(FARM_MANIFEST)
  const manifest = parseFarmManifest(decode(manifestBefore))
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
        if (prior && !(await removeOwned(root, name, prior))) {
          blocked.push(name)
          continue
        }
        await symlink(target, at, 'dir')
      }
      next.skills[name] = { by: 'cli', kind: 'symlink' }
    }
    for (const name of plan.remove) {
      if (await removeOwned(root, name, manifest.skills[name])) {
        delete next.skills[name]
        removed.push(name)
      } else {
        blocked.push(name)
      }
    }
    const text = renderFarmManifest(next)
    if (decode(manifestBefore) !== text) {
      // Golden rule 1: the pre-image first, then the atomic write.
      await backend.journal.record(FARM_MANIFEST, manifestBefore)
      await backend.adapter.writeAtomic(FARM_MANIFEST, new TextEncoder().encode(text))
    }
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
