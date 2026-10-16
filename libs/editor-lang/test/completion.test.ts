/**
 * `#` completion (R5.1). The list comes from the index through the host, so a
 * tag you can complete is a tag search can find.
 */
import { CompletionContext } from '@codemirror/autocomplete'
import { describe, expect, it } from 'vitest'
import { tagCompletions } from '../src/index.js'
import { linkPopoverOpen } from '../src/link-completion-view.js'
import { makeState, testHost } from './support.js'

const TAGS = ['#edible/roadmap', '#edible/story', '#insp/data-vis-article', '#flashcards/systems']

function complete(doc: string, pos = doc.length): ReturnType<typeof tagCompletions> {
  const state = makeState(doc, { at: pos, host: testHost({ tags: () => TAGS }) })
  return tagCompletions(new CompletionContext(state, pos, false))
}

describe('tagCompletions', () => {
  it('offers every tag the moment a `#` is typed', () => {
    const result = complete('a note about #')
    expect(result?.options.map((o) => o.label)).toEqual(TAGS)
    // `from` is the hash, so applying replaces what was typed rather than
    // leaving `##tag` behind.
    expect(result?.from).toBe(13)
  })

  it('filters on what has been typed so far', () => {
    expect(complete('see #ins')?.options.map((o) => o.label)).toEqual(['#insp/data-vis-article'])
    expect(complete('see #edible/')?.options.map((o) => o.label)).toEqual([
      '#edible/roadmap',
      '#edible/story',
    ])
  })

  it('applies the whole tag, `#` included', () => {
    expect(complete('see #ins')?.options[0].apply).toBe('#insp/data-vis-article')
  })

  it('does not fire where a `#` is not a tag', () => {
    expect(complete('issue ref a#')).toBe(null)
    expect(complete('see #ins ')).toBe(null) // the run ended at the space
    expect(complete('nothing here')).toBe(null)
  })

  it('is null rather than empty when nothing matches, so the popup stays shut', () => {
    expect(complete('see #zzz')).toBe(null)
    const state = makeState('#', { at: 1, host: testHost() })
    expect(tagCompletions(new CompletionContext(state, 1, false))).toBe(null)
  })
})

/**
 * The popover's class is decided from the document, not from the open
 * dialog's rows: CM6 asks for it while the dialog is still being built, when
 * the rows are not in the state yet, so a rows-based answer was wrong on
 * every first paint and the list jumped sideways a frame later (QA
 * 2026-10-16, Chris's screencast).
 */
describe('linkPopoverOpen', () => {
  const at = (doc: string, pos = doc.length) => linkPopoverOpen(makeState(doc, { at: pos, host: testHost() }))

  it('is true inside an open [[ , before any rows exist', () => {
    expect(at('see [[Un')).toBe(true)
    expect(at('see [[Note#he')).toBe(true)
  })

  it('is false in plain text and in a # tag', () => {
    expect(at('see #ins')).toBe(false)
    expect(at('nothing here')).toBe(false)
    expect(at('see [[done]] and ')).toBe(false)
  })
})
