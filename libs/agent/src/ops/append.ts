import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { findSection, joinLines, linesOf } from '../text.js'
import { commit, openForWrite } from '../write-file.js'

/**
 * `append` — add to the end of a note, or to the end of one of its SECTIONS.
 *
 * The section form is the one that matters: "add this to the Decisions list"
 * is the shape of almost every agent write, and doing it with `patch` means
 * quoting the last line of the section, which breaks the moment somebody else
 * appends first.
 *
 * Placement rules, both of which exist so the diff is one hunk:
 *  - exactly one newline between what was there and what arrives;
 *  - a section keeps the blank line that separated it from the next heading.
 */
export const append: OpDef<'append'> = {
  ...OP_SCHEMAS.append,
  async run(backend, input) {
    const note = await openForWrite(backend, input.path, input.expectHash)
    if (input.text.length === 0) throw new OpError('usage', 'nothing to append')
    const added = linesOf(input.text)

    let lines = linesOf(note.text)
    let at: number

    if (input.section !== undefined) {
      if (!note.exists) throw new OpError('not_found', `no such note: ${note.path}`, { path: note.path })
      const section = findSection(note.text, input.section)
      if (!section) {
        throw new OpError('not_found', `no section ${input.section} in ${note.path} — ask for --outline`, {
          path: note.path,
          section: input.section,
        })
      }
      // Last line of the section that actually says something; the blank lines
      // after it belong to the gap before the next heading, not to the text.
      let end = section.to
      while (end > section.from && lines[end - 1].trim() === '') end--
      const after = lines.slice(section.to)
      lines = [...lines.slice(0, end), ...added, ...(after.length > 0 ? [''] : []), ...after]
      at = end + 1
    } else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
      at = lines.length + 1
      lines = [...lines, ...added]
    }

    const done = await commit(backend, note, joinLines(lines), input.dryRun ?? false)
    return {
      schema: schemaName('append'),
      path: note.path,
      line: at,
      hash: done.hash,
      journalSeq: done.journalSeq,
      dryRun: input.dryRun ?? false,
    }
  },
}
