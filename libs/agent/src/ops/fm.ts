import { OP_SCHEMAS, schemaName } from '../contract.js'
import { openForRead } from '../read.js'
import type { OpDef } from '../op.js'
import { readFrontmatter } from '../frontmatter-read.js'

/**
 * `fm` — READ a note's frontmatter. There is no `fm set`.
 *
 * Writing frontmatter is golden rule 2's hardest case: a YAML round-trip
 * reserializes a block nobody asked to change and turns a one-key edit into a
 * whole-file git diff. It ships when `libs/frontmatter` (read-shaping X3)
 * has the surgical patcher, and not before — stated here, in the op
 * description, and in the skill, so an agent is never left guessing whether
 * it is missing a flag.
 */
export const fm: OpDef<'fm'> = {
  ...OP_SCHEMAS.fm,
  async run(backend, input) {
    const { path, text } = await openForRead(backend, input.path)
    return { schema: schemaName('fm'), path, frontmatter: readFrontmatter(text) }
  },
}
