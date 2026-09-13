/**
 * `#` completion over the index's tags — the `[[` precedent in wikilink-view.
 *
 * Synchronous, like that one: the tag list is already in memory, and an await
 * here would make the popup flicker in behind the next keystroke.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { isTagBody, tagBoundary } from '@ohhi/index'
import { readHost } from '../read-host.js'

export function tagCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const typedTo = context.pos - line.from
  const hash = line.text.lastIndexOf('#', typedTo - 1)
  if (hash === -1 || !tagBoundary(line.text, hash)) return null

  const typed = line.text.slice(hash + 1, typedTo)
  if (typed && !isTagBody(typed)) return null

  const query = typed.toLowerCase()
  const options = context.state
    .facet(readHost)
    .tags()
    .filter((tag) => !query || tag.toLowerCase().includes(query))
    .slice(0, 50)
    // `apply` carries the `#` because `from` is the hash: completing replaces
    // what was typed, so a tag picked from the list is never `##tag`.
    .map((tag) => ({ label: tag, apply: tag, type: 'text' }))
  if (options.length === 0) return null
  return { from: line.from + hash, to: context.pos, options, filter: false }
}
