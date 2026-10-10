/**
 * Code fences as text (editor-usability E3): Enter's auto-close, the language
 * ranking behind the info-string completion, and the copy button's text.
 */
import { CompletionContext } from '@codemirror/autocomplete'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { autoCloseFence, fenceContent, fenceOpen, rankLanguages } from '../src/preview/fence.js'
import {
  autoCloseFenceOnEnter,
  codeBlockText,
  fenceLanguageCompletions,
  fenceLanguages,
} from '../src/preview/fence-edit.js'
import { makeState } from './support.js'

const LANGS = [
  { name: 'JavaScript', alias: ['ecmascript', 'js', 'node'] },
  { name: 'Java', alias: [] },
  { name: 'JSON', alias: ['json5'] },
  { name: 'JSX', alias: [] },
  { name: 'Rust', alias: ['rs'] },
  { name: 'Shell', alias: ['bash', 'sh', 'zsh'] },
  { name: 'Objective-C', alias: ['objective c', 'objc'] },
  { name: 'Visual Basic', alias: ['vb'] },
]

describe('fenceOpen', () => {
  it('reads backtick and tilde runs, the indent and the info', () => {
    expect(fenceOpen('```js')).toEqual({ indent: '', fence: '```', info: 'js' })
    expect(fenceOpen('\t~~~~ py title=x')).toEqual({ indent: '\t', fence: '~~~~', info: 'py title=x' })
    expect(fenceOpen('``js')).toBe(null)
    // A backtick info string may not hold a backtick: that is inline code.
    expect(fenceOpen('```js`')).toBe(null)
  })
})

describe('autoCloseFence', () => {
  it('closes a fresh opening fence', () => {
    expect(autoCloseFence(['text', '```js'], 1)).toEqual({ indent: '', fence: '```' })
    expect(autoCloseFence(['```'], 0)).toEqual({ indent: '', fence: '```' })
    expect(autoCloseFence(['\t~~~~rust'], 0)).toEqual({ indent: '\t', fence: '~~~~' })
  })

  it('does nothing when a fence below already closes it', () => {
    expect(autoCloseFence(['```js', 'code', '```'], 0)).toBe(null)
    expect(autoCloseFence(['```js', '', 'text', '`````'], 0)).toBe(null)
  })

  it('does not count a different or shorter run as the closer', () => {
    expect(autoCloseFence(['````js', '```'], 0)).toEqual({ indent: '', fence: '````' })
    expect(autoCloseFence(['```js', '~~~'], 0)).toEqual({ indent: '', fence: '```' })
  })

  it('never triggers inside an existing block', () => {
    // Line 2 is CONTENT of the block opened on line 0 (unclosed).
    expect(autoCloseFence(['```', 'code', '```py'], 2)).toBe(null)
    // …and a closer is not an opener either.
    expect(autoCloseFence(['```js', 'code', '```'], 2)).toBe(null)
    // After a closed block, a new one opens again.
    expect(autoCloseFence(['```js', 'code', '```', '```py'], 3)).toEqual({ indent: '', fence: '```' })
  })

  it('ignores lines that are not fences', () => {
    expect(autoCloseFence(['plain'], 0)).toBe(null)
    expect(autoCloseFence(['> ```js'], 0)).toBe(null)
  })
})

describe('rankLanguages', () => {
  it('ranks exact first, then shorter prefixes, one row per language', () => {
    expect(rankLanguages(LANGS, 'j').map((l) => l.label)).toEqual(['js', 'jsx', 'java', 'json'])
    expect(rankLanguages(LANGS, 'java').map((l) => l.label)).toEqual(['java', 'javascript'])
    expect(rankLanguages(LANGS, 'JSON')[0]).toEqual({ label: 'json', name: 'JSON' })
  })

  it('matches aliases and carries the language name', () => {
    expect(rankLanguages(LANGS, 'ba')).toEqual([{ label: 'bash', name: 'Shell' }])
    expect(rankLanguages(LANGS, 'rs')).toEqual([{ label: 'rs', name: 'Rust' }])
  })

  it('never offers a token with a space in it', () => {
    // `objective c` is skipped; Objective-C is offered under its shortest spaceless token.
    expect(rankLanguages(LANGS, 'obj').map((l) => l.label)).toEqual(['objc'])
    expect(rankLanguages(LANGS, 'vis')).toEqual([])
    expect(rankLanguages(LANGS, 'v').map((l) => l.label)).toEqual(['vb'])
  })

  it('lists every language once, alphabetically, for an empty query', () => {
    const all = rankLanguages(LANGS, '')
    expect(all).toHaveLength(LANGS.length)
    expect(all.map((l) => l.label)).toEqual([...all.map((l) => l.label)].sort((a, b) => a.localeCompare(b)))
    expect(all.find((l) => l.name === 'Visual Basic')?.label).toBe('vb')
  })

  it('respects the limit', () => {
    expect(rankLanguages(LANGS, '', 3)).toHaveLength(3)
  })
})

describe('fenceContent', () => {
  it('takes the fence’s indent off the code', () => {
    expect(fenceContent(['\tlet a = 1', '\t\tnested', 'outdented'], '\t')).toBe('let a = 1\n\tnested\noutdented')
    expect(fenceContent(['a', '', 'b'], '')).toBe('a\n\nb')
  })
})

/** A view stand-in: a command only reads `state` and calls `dispatch`. */
function fakeView(state: EditorState): { view: EditorView; current: () => EditorState } {
  let now = state
  const view = {
    get state() {
      return now
    },
    dispatch(spec: TransactionSpec) {
      now = now.update(spec).state
    },
  } as unknown as EditorView
  return { view, current: () => now }
}

describe('Enter on an opening fence', () => {
  it('inserts an empty line and the closer, caret between', () => {
    const doc = 'text\n```js'
    const { view, current } = fakeView(makeState(doc, { at: doc.length }))
    expect(autoCloseFenceOnEnter(view)).toBe(true)
    expect(current().doc.toString()).toBe('text\n```js\n\n```')
    expect(current().selection.main.head).toBe(doc.length + 1)
  })

  it('keeps the indent of a fence in a list item', () => {
    const doc = '- item\n\t```sh'
    const { view, current } = fakeView(makeState(doc, { at: doc.length }))
    expect(autoCloseFenceOnEnter(view)).toBe(true)
    expect(current().doc.toString()).toBe('- item\n\t```sh\n\t\n\t```')
    expect(current().selection.main.head).toBe(doc.length + 2)
  })

  it('declines mid-line, when closed already, and inside a block', () => {
    expect(autoCloseFenceOnEnter(fakeView(makeState('```js', { at: 3 })).view)).toBe(false)
    const closed = '```js\ncode\n```'
    expect(autoCloseFenceOnEnter(fakeView(makeState(closed, { at: 5 })).view)).toBe(false)
    const inside = '```\ncode\n```py'
    expect(autoCloseFenceOnEnter(fakeView(makeState(inside, { at: inside.length })).view)).toBe(false)
  })
})

describe('fence language completion', () => {
  const langs = fenceLanguages.of(LANGS)
  const complete = (doc: string, pos = doc.length, explicit = false) =>
    fenceLanguageCompletions(new CompletionContext(makeState(doc, { at: pos, extensions: [langs] }), pos, explicit))

  it('offers ranked names after ``` plus letters', () => {
    const result = complete('```j')
    expect(result?.options.map((o) => o.label)).toEqual(['js', 'jsx', 'java', 'json'])
    expect(result?.from).toBe(3)
    expect(result?.options[0].detail).toBe('JavaScript')
  })

  it('waits for a letter unless asked, then lists them all', () => {
    expect(complete('```')).toBe(null)
    expect(complete('```', 3, true)?.options).toHaveLength(LANGS.length)
  })

  it('replaces the whole word under the caret (the chip puts the caret at its start)', () => {
    const result = complete('```rust\ncode\n```', 3, true)
    expect(result?.from).toBe(3)
    expect(result?.to).toBe(7)
  })

  it('stays out of code and plain text', () => {
    expect(complete('```\ncode\n```py')).toBe(null)
    expect(complete('see ```js')).toBe(null)
  })
})

describe('codeBlockText', () => {
  it('copies the lines between the fences', () => {
    const state = makeState('para\n\n```rust\nfn main() {}\n\nlet x = 1;\n```\nafter\n')
    expect(codeBlockText(state, state.doc.line(3).from)).toBe('fn main() {}\n\nlet x = 1;')
  })

  it('copies to the end of the note when the fence is unclosed', () => {
    const state = makeState('```\nlast\nlines')
    expect(codeBlockText(state, 0)).toBe('last\nlines')
  })

  it('is null off an opening fence', () => {
    const state = makeState('plain\n')
    expect(codeBlockText(state, 0)).toBe(null)
  })
})
