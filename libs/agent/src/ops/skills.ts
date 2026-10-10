import { OP_SCHEMAS, schemaName } from '../contract.js'
import type { VaultBackend } from '../backend.js'
import { readNote } from '../backend.js'
import type { OpDef } from '../op.js'
import { paginate } from '../paging.js'
import { loadSkills, SKILLS_DIR, type SkillFs } from '../skills.js'

/**
 * The loader's two calls over a backend: the walk's file list (`.agents/` is
 * not ignored, so it is in it) and a fresh read from disk.
 */
export function skillFsOf(backend: VaultBackend): SkillFs {
  return {
    list: async (dir) => [...(await backend.files()).keys()].filter((p) => p.startsWith(`${dir}/`)).sort(),
    read: async (path) => (await readNote(backend, path))?.text ?? null,
  }
}

/** `skills` — every skill under `.agents/skills/`, invalid ones with their problems. */
export const skills: OpDef<'skills'> = {
  ...OP_SCHEMAS.skills,
  async run(backend, input) {
    const all = await loadSkills(skillFsOf(backend))
    const page = paginate(
      all.map(({ name, description, dir, kind, input: in_, output, hasScripts, problems }) => ({
        name,
        description,
        dir,
        ...(kind ? { kind } : {}),
        ...(in_ ? { input: in_ } : {}),
        ...(output ? { output } : {}),
        hasScripts,
        problems,
      })),
      input
    )
    return {
      schema: schemaName('skills'),
      dir: SKILLS_DIR,
      skills: page.items,
      returned: page.returned,
      total: page.total,
      nextCursor: page.nextCursor,
    }
  },
}
