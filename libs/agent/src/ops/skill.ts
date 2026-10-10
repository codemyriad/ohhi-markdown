import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { loadSkill, SKILLS_DIR } from '../skills.js'
import { skillFsOf } from './skills.js'

/** `skill <name>` — one skill's parsed frontmatter, problems and instructions. */
export const skill: OpDef<'skill'> = {
  ...OP_SCHEMAS.skill,
  async run(backend, input) {
    const found = await loadSkill(skillFsOf(backend), input.name)
    if (!found) throw new OpError('not_found', `no such skill: ${input.name} (looked for ${SKILLS_DIR}/${input.name}/SKILL.md)`, { name: input.name })
    return { schema: schemaName('skill'), meta: found.meta, body: found.body }
  },
}
