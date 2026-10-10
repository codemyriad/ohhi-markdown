/**
 * `@ohhi/harness/skills` — the skills seam for every host (writing-harness
 * B9). The loader itself is `@ohhi/agent/skills` (the contract ops need it,
 * and this package depends on that one, not the reverse); this module
 * re-exports it and adds what only a harness host needs: a `SkillSource` over
 * any `SkillFs` (`skillFsOf(backend)` from `@ohhi/agent/core` is the one over
 * a vault backend), and the empty source.
 *
 * Browser-safe: no Node imports, and it does not pull in `@ohhi/agent`'s root
 * (the files backend) — only the loader's subpath.
 */
import { loadSkill, loadSkills, usableSkills, type SkillFs } from '@ohhi/agent/skills'
import type { SkillMeta, SkillSource } from '../types.js'

export * from '@ohhi/agent/skills'

/**
 * A `SkillSource` for the harness: only the skills a model may use. `allow`
 * narrows further — `usableBy(state)` is the trust rule (trusted, enabled,
 * and the folder still hashing to what was trusted); without it every VALID
 * skill is offered — the rule for a vault with no `.ohhi/skills.json`.
 */
export function createSkillSource(fs: SkillFs, allow: (meta: SkillMeta) => boolean = () => true): SkillSource {
  const offered = async (): Promise<SkillMeta[]> => usableSkills(await loadSkills(fs), null).filter(allow)
  return {
    list: offered,
    async body(name) {
      const found = await loadSkill(fs, name)
      if (!found || usableSkills([found.meta], null).length === 0 || !allow(found.meta)) return null
      return found.body
    },
  }
}

/** The one source with nothing in it — a host before any skills exist. */
export const emptySkillSource: SkillSource = { list: async () => [], body: async () => null }
