import { hashBytes, decodeFile, looksBinary } from '@editor/vault'
import { OP_SCHEMAS, OpError, schemaName } from '../contract.js'
import type { OpDef } from '../op.js'
import { normalizeVaultPath } from '../paths.js'
import { readFrontmatter } from '../frontmatter-read.js'
import { budget, findSection, outlineOf, sliceLines } from '../text.js'

/** The default character budget. ~20 KB is p99 of the real vault's notes. */
const DEFAULT_MAX_CHARS = 20_000

/**
 * `read` — a note, or the PART of it you asked for (shaping R4).
 *
 * Modes are exclusive and resolved in this order: `outline`, `frontmatter`,
 * `section`, `lines`, whole note. Declared rather than inferred, because an
 * agent that passes both `--outline` and `--section` must get the same answer
 * every time.
 *
 * This op does NOT build the index. Headings come from `parseMarkdown` over
 * the bytes just read, so line numbers describe the text being served rather
 * than a snapshot taken earlier in the process — and `ohhi read` on a cold
 * CLI costs a file read, not a 250 ms vault derive.
 *
 * `hash` is over the RAW BYTES, so it is the `expectHash` for a later write
 * even when the note is CRLF or carries a BOM.
 */
export const read: OpDef<'read'> = {
  ...OP_SCHEMAS.read,
  async run(backend, input) {
    const path = normalizeVaultPath(input.path)
    const bytes = await backend.adapter.read(path)
    if (!bytes) throw new OpError('not_found', `no such note: ${path}`, { path })
    if (looksBinary(path, bytes)) {
      throw new OpError('refused', `not a text note: ${path}`, { path })
    }
    const text = decodeFile(bytes).text
    const head = { schema: schemaName('read'), path, size: bytes.length, hash: hashBytes(bytes) }
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS

    if (input.outline) {
      return { ...head, mode: 'outline' as const, truncated: false, outline: outlineOf(text) }
    }
    if (input.frontmatter) {
      return { ...head, mode: 'frontmatter' as const, truncated: false, frontmatter: readFrontmatter(text) }
    }
    if (input.section !== undefined) {
      const section = findSection(text, input.section)
      if (!section) {
        throw new OpError('not_found', `no section ${input.section} in ${path} — ask for --outline`, {
          path,
          section: input.section,
        })
      }
      const slice = sliceLines(text, section.from, section.to)
      const cut = budget(slice.text, slice.from, maxChars)
      return { ...head, mode: 'section' as const, text: cut.text, from: slice.from, to: slice.to, truncated: cut.truncated, ...(cut.nextLine === undefined ? {} : { nextLine: cut.nextLine }) }
    }
    if (input.lines) {
      const slice = sliceLines(text, input.lines.from, input.lines.to)
      const cut = budget(slice.text, slice.from, maxChars)
      return { ...head, mode: 'lines' as const, text: cut.text, from: slice.from, to: slice.to, truncated: cut.truncated, ...(cut.nextLine === undefined ? {} : { nextLine: cut.nextLine }) }
    }
    const cut = budget(text, 1, maxChars)
    return {
      ...head,
      mode: 'full' as const,
      text: cut.text,
      truncated: cut.truncated,
      ...(cut.truncated ? { from: 1, to: (cut.nextLine ?? 2) - 1, nextLine: cut.nextLine } : {}),
    }
  },
}
