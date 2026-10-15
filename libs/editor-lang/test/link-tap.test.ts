/**
 * A wikilink under a finger (QA round 1): the card's state — shown by the
 * first tap, kept while the caret stays on the link, taken down by typing or
 * by the caret leaving — and the hit test that keeps a press beside a link
 * from following it. The DOM half (the tap itself) is the e2e's
 * `small-screen.spec.ts`.
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { onLinkText } from '../src/preview/clicks.js'
import { cardOpenOn, linkCard, showLinkCard } from '../src/preview/link-tap.js'

const DOC = 'see [[Alpha]] and more text'
const LINK = { from: 4, to: 13, target: 'Alpha' }

const open = (): EditorState => {
  const state = EditorState.create({ doc: DOC, extensions: [linkCard] })
  return state.update({ selection: { anchor: 6 }, effects: showLinkCard.of(LINK) }).state
}

describe('the link card', () => {
  it('is up over the tapped link, and only that one', () => {
    const state = open()
    expect(cardOpenOn(state, LINK.from)).toBe(true)
    expect(cardOpenOn(state, 0)).toBe(false)
    expect(state.field(linkCard)?.tooltip.pos).toBe(LINK.from)
  })

  it('stays while the caret moves within the link, as the same tooltip', () => {
    const state = open()
    const before = state.field(linkCard)
    const moved = state.update({ selection: { anchor: 9 } }).state
    expect(cardOpenOn(moved, LINK.from)).toBe(true)
    expect(moved.field(linkCard)).toBe(before)
  })

  it('goes when the caret leaves the link', () => {
    const moved = open().update({ selection: { anchor: 20 } }).state
    expect(moved.field(linkCard)).toBeNull()
  })

  it('goes on the first keystroke', () => {
    const typed = open().update({ changes: { from: 8, insert: 'x' } }).state
    expect(typed.field(linkCard)).toBeNull()
  })

  it('goes on its own effect', () => {
    const closed = open().update({ effects: showLinkCard.of(null) }).state
    expect(cardOpenOn(closed, LINK.from)).toBe(false)
  })
})

/** Just enough of an Element for `closest`: the classes of it and its ancestors. */
function element(...chain: string[][]): Element {
  return {
    closest(selector: string) {
      const wanted = selector.split(',').map((s) => s.trim().replace(/^\./, ''))
      return chain.some((classes) => classes.some((c) => wanted.includes(c))) ? ({} as Element) : null
    },
  } as unknown as Element
}

describe('a press counts only on the link’s own text', () => {
  it('on a rendered or raw wikilink, yes', () => {
    expect(onLinkText(element(['cm-wikilink', 'cm-live-link'], ['cm-line']), 'WikiLink')).toBe(true)
    expect(onLinkText(element(['cm-wikilink-unresolved'], ['cm-line']), 'WikiLink')).toBe(true)
  })

  it('on the empty rest of its line, no (posAtCoords snapped into the link)', () => {
    expect(onLinkText(element(['cm-line'], ['cm-content']), 'WikiLink')).toBe(false)
    expect(onLinkText(element(['cm-line']), 'Link')).toBe(false)
    expect(onLinkText(element(['cm-line']), 'Tag')).toBe(false)
  })

  it('markdown links and tags by their own marks', () => {
    expect(onLinkText(element(['cm-md-link', 'cm-live-link']), 'Link')).toBe(true)
    expect(onLinkText(element(['cm-url', 'cm-live-link']), 'URL')).toBe(true)
    expect(onLinkText(element(['cm-tag']), 'Tag')).toBe(true)
  })
})
