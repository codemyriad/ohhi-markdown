/**
 * The formatting commands (quiet-shell F4, foundations Stage 3 gate): every
 * command over a real lezer tree, in node. A test doc marks the selection
 * inline — `‸` a caret, `‹…›` a selected range (anchor first) — and the result
 * is printed back the same way, so each case reads as before → after.
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { Frontmatter, Highlight, Tag, WikiLink } from '@ohhi/editor-lang'
import { describe, expect, it } from 'vitest'
import {
  cmKey,
  editorKeymap,
  cycleHeading,
  FORMAT_COMMANDS,
  formatKeymap,
  indentFormat,
  insertCallout,
  insertCodeBlock,
  insertImage,
  insertLink,
  insertRule,
  insertTable,
  insertWikilink,
  outdentFormat,
  setHeading,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
  toggleStrike,
  toggleTaskList,
} from '../src/format.js'

function parse(marked: string): { doc: string; ranges: { anchor: number; head: number }[] } {
  let doc = ''
  const ranges: { anchor: number; head: number }[] = []
  let open = -1
  for (const ch of marked) {
    if (ch === '‸') ranges.push({ anchor: doc.length, head: doc.length })
    else if (ch === '‹') open = doc.length
    else if (ch === '›') {
      ranges.push({ anchor: open, head: doc.length })
      open = -1
    } else doc += ch
  }
  return { doc, ranges }
}

function print(state: EditorState): string {
  const marks: { at: number; ch: string }[] = []
  for (const r of state.selection.ranges) {
    if (r.empty) marks.push({ at: r.head, ch: '‸' })
    else marks.push({ at: r.from, ch: '‹' }, { at: r.to, ch: '›' })
  }
  marks.sort((a, b) => b.at - a.at || (a.ch === '›' ? -1 : 1))
  let doc = state.doc.toString()
  for (const m of marks) doc = doc.slice(0, m.at) + m.ch + doc.slice(m.at)
  return doc
}

function makeState(marked: string, readOnly = false): EditorState {
  const { doc, ranges } = parse(marked)
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      (ranges.length ? ranges : [{ anchor: 0, head: 0 }]).map((r) => EditorSelection.range(r.anchor, r.head))
    ),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage, extensions: [WikiLink, Tag, Highlight, Frontmatter] }),
      readOnly ? EditorState.readOnly.of(true) : [],
    ],
  })
  ensureSyntaxTree(state, state.doc.length, 10_000)
  return state.update({}).state
}

/** A view as far as a command can tell: state in, one dispatch out. */
function fakeView(state: EditorState): EditorView & { transactions: Transaction[] } {
  const view = {
    state,
    transactions: [] as Transaction[],
    // A command may dispatch a Transaction or a spec (the list indent pair does).
    dispatch(arg: Transaction | TransactionSpec) {
      const tr = 'startState' in arg ? (arg as Transaction) : view.state.update(arg)
      view.transactions.push(tr)
      view.state = tr.state
    },
  }
  return view as unknown as EditorView & { transactions: Transaction[] }
}

/** Run `cmd` on a marked doc: the result (marked), whether it ran, and the dispatches. */
function apply(cmd: Command, marked: string, readOnly = false): { out: string; ran: boolean; dispatches: number } {
  const view = fakeView(makeState(marked, readOnly))
  const ran = cmd(view)
  return { out: print(view.state), ran, dispatches: view.transactions.length }
}

const run = (cmd: Command, marked: string): string => apply(cmd, marked).out

/** Apply twice, re-parsing between, as two key presses would. */
const twice = (cmd: Command, marked: string): string => run(cmd, run(cmd, marked))

const FENCE = '```js\nconst x‸ = 1\n```'

describe('inline toggles', () => {
  const cases: [string, Command, string][] = [
    ['bold', toggleBold, '**'],
    ['italic', toggleItalic, '*'],
    ['strike', toggleStrike, '~~'],
    ['code', toggleInlineCode, '`'],
    ['highlight', toggleHighlight, '=='],
  ]
  for (const [name, cmd, m] of cases) {
    describe(name, () => {
      it('wraps the selection and keeps the text selected', () => {
        expect(run(cmd, 'say ‹hello› there')).toBe(`say ${m}‹hello›${m} there`)
      })
      it('unwraps a selection that is already wrapped (toggle off)', () => {
        expect(run(cmd, `say ${m}‹hello›${m} there`)).toBe('say ‹hello› there')
      })
      it('round-trips', () => {
        expect(twice(cmd, 'say ‹hello› there')).toBe('say ‹hello› there')
      })
      it('unwraps when the selection covers the markers too', () => {
        expect(run(cmd, `say ‹${m}hello${m}› there`)).toBe('say ‹hello› there')
      })
      it('wraps the word at a collapsed caret, the caret staying in it', () => {
        expect(run(cmd, 'say hel‸lo there')).toBe(`say ${m}hel‸lo${m} there`)
        expect(run(cmd, 'say ‸hello there')).toBe(`say ${m}‸hello${m} there`)
      })
      it('unwraps the node a collapsed caret is in', () => {
        expect(run(cmd, `say ${m}hel‸lo${m} there`)).toBe('say hel‸lo there')
      })
      it('inserts an empty pair with the caret inside when there is no word', () => {
        expect(run(cmd, 'say ‸')).toBe(`say ${m}‸${m}`)
      })
      it('wraps each line of a selection spanning two paragraphs', () => {
        expect(run(cmd, 'one ‹two\n\nthree› four')).toBe(`one ${m}‹two${m}\n\n${m}three›${m} four`)
      })
      it('unwraps both paragraphs when both are wrapped', () => {
        expect(run(cmd, `one ${m}‹two${m}\n\n${m}three›${m} four`)).toBe('one ‹two\n\nthree› four')
      })
      it('is a no-op inside a code fence', () => {
        const r = apply(cmd, FENCE)
        expect(r).toEqual({ out: FENCE, ran: false, dispatches: 0 })
      })
      it('handles every range of a multi-cursor selection', () => {
        expect(run(cmd, '‹a› b ‹c›')).toBe(`${m}‹a›${m} b ${m}‹c›${m}`)
        expect(run(cmd, `${m}‹a›${m} b ${m}‹c›${m}`)).toBe('‹a› b ‹c›')
      })
      it('is one transaction', () => {
        expect(apply(cmd, '‹a› b ‹c›').dispatches).toBe(1)
      })
      it('answers false and changes nothing when read-only', () => {
        expect(apply(cmd, 'say ‹hello›', true)).toEqual({ out: 'say ‹hello›', ran: false, dispatches: 0 })
      })
    })
  }

  it('trims the selection so the marker hugs the text', () => {
    expect(run(toggleBold, 'say‹ hello ›there')).toBe('say‹ **hello** ›there')
  })

  it('unwraps the whole bold span from a partial selection inside it', () => {
    expect(run(toggleBold, '**hello ‹world›**')).toBe('hello ‹world›')
  })

  it('tells italic from bold: italic on bold text adds a star pair, not removes one', () => {
    expect(run(toggleItalic, '**‹bold›**')).toBe('***‹bold›***')
    expect(run(toggleBold, '***‹both›***')).toBe('*‹both›*')
  })

  it('removes markers the tree does not see as emphasis (text fallback)', () => {
    expect(run(toggleBold, '**‹ spaced ›**')).toBe('‹ spaced ›')
  })

  it('wraps after a list marker, not around it', () => {
    expect(run(toggleBold, '‹- one\n- two›')).toBe('‹- **one**\n- **two›**')
  })

  it('code: a backtick inside gets a longer fence', () => {
    expect(run(toggleInlineCode, '‹a`b›')).toBe('``‹a`b›``')
    expect(run(toggleInlineCode, '‹`x›')).toBe('`` ‹`x› ``')
    expect(run(toggleInlineCode, '`` ‹`x› ``')).toBe('‹`x›')
  })
})

describe('headings', () => {
  it('toggleHeading on and off', () => {
    expect(run(toggleHeading(2), 'Ti‸tle')).toBe('## Ti‸tle')
    expect(run(toggleHeading(2), '## Ti‸tle')).toBe('Ti‸tle')
    expect(run(toggleHeading(1), '### Ti‸tle')).toBe('# Ti‸tle')
  })
  it('setHeading sets, never toggles; 0 is a paragraph', () => {
    expect(run(setHeading(3), 'a‸')).toBe('### a‸')
    expect(apply(setHeading(3), '### a‸').ran).toBe(false)
    expect(run(setHeading(0), '### a‸')).toBe('a‸')
  })
  it('cycles paragraph → H1 … H6 → paragraph', () => {
    let s = 'x‸'
    const seen = []
    for (let i = 0; i < 7; i++) {
      s = run(cycleHeading, s)
      seen.push(s)
    }
    expect(seen).toEqual(['# x‸', '## x‸', '### x‸', '#### x‸', '##### x‸', '###### x‸', 'x‸'])
  })
  it('every line of a selection spanning two paragraphs', () => {
    expect(run(toggleHeading(1), '‹one\n\ntwo›')).toBe('‹# one\n\n# two›')
    expect(run(toggleHeading(1), '‹# one\n\n# two›')).toBe('‹one\n\ntwo›')
  })
  it('keeps a quote prefix', () => {
    expect(run(toggleHeading(2), '> quo‸te')).toBe('> ## quo‸te')
  })
  it('is a no-op inside a code fence', () => {
    expect(apply(toggleHeading(1), FENCE).ran).toBe(false)
    expect(apply(cycleHeading, FENCE).ran).toBe(false)
  })
  it('multi-range', () => {
    expect(run(toggleHeading(1), 'a‸\nb\nc‸')).toBe('# a‸\nb\n# c‸')
  })
})

describe('line toggles', () => {
  const lists: [string, Command, (i: number) => string][] = [
    ['bullet', toggleBulletList, () => '- '],
    ['ordered', toggleOrderedList, (i) => `${i}. `],
    ['task', toggleTaskList, () => '- [ ] '],
    ['quote', toggleQuote, () => '> '],
  ]
  for (const [name, cmd, p] of lists) {
    describe(name, () => {
      it('toggles on and off on the caret line', () => {
        expect(run(cmd, 'it‸em')).toBe(`${p(1)}it‸em`)
        expect(twice(cmd, 'it‸em')).toBe('it‸em')
      })
      it('acts on every selected line', () => {
        expect(run(cmd, '‹a\nb›')).toBe(`‹${p(1)}a\n${p(2)}b›`)
        expect(twice(cmd, '‹a\nb›')).toBe('‹a\nb›')
      })
      it('is a no-op inside a code fence', () => {
        expect(apply(cmd, FENCE)).toEqual({ out: FENCE, ran: false, dispatches: 0 })
      })
      it('multi-range: each caret line, once', () => {
        expect(run(cmd, 'a‸\nb\nc‸')).toBe(`${p(1)}a‸\nb\n${p(1)}c‸`)
        // Two carets on one line add one marker.
        expect(run(cmd, 'a‸b‸')).toBe(`${p(1)}a‸b‸`)
      })
    })
  }

  it('lists skip the blank line between two paragraphs', () => {
    expect(run(toggleBulletList, '‹one\n\ntwo›')).toBe('‹- one\n\n- two›')
    expect(run(toggleBulletList, '‹- one\n\n- two›')).toBe('‹one\n\ntwo›')
  })

  it('a quote covers the blank line, so it stays one quote', () => {
    expect(run(toggleQuote, '‹one\n\ntwo›')).toBe('‹> one\n>\n> two›')
    expect(run(toggleQuote, '‹> one\n>\n> two›')).toBe('‹one\n\ntwo›')
  })

  it('converts between list kinds rather than stacking markers', () => {
    expect(run(toggleBulletList, '1. it‸em')).toBe('- it‸em')
    expect(run(toggleOrderedList, '- it‸em')).toBe('1. it‸em')
    expect(run(toggleTaskList, '- it‸em')).toBe('- [ ] it‸em')
    expect(run(toggleTaskList, '2. it‸em')).toBe('2. [ ] it‸em')
    expect(run(toggleBulletList, '- [x] it‸em')).toBe('- it‸em')
  })

  it('a mixed selection turns on for every line, then off', () => {
    expect(run(toggleBulletList, '‹- a\nb›')).toBe('‹- a\n- b›')
    expect(run(toggleBulletList, '‹- a\n- b›')).toBe('‹a\nb›')
  })

  it('keeps indentation', () => {
    expect(run(toggleBulletList, '  ne‸sted')).toBe('  - ne‸sted')
    // A tab-indented line is an indented code block: literal, left alone.
    expect(apply(toggleBulletList, '\tne‸sted').ran).toBe(false)
  })

  it('a selection ending at the start of a line does not take that line', () => {
    expect(run(toggleBulletList, '‹a\n›b')).toBe('‹- a\n›b')
  })

  it('leaves a fence line inside a wider selection alone', () => {
    expect(run(toggleQuote, '‹a\n```\ncode\n```\nb›')).toBe('‹> a\n```\ncode\n```\n> b›')
  })

  it('one transaction, one undo step', () => {
    expect(apply(toggleOrderedList, '‹a\nb\nc›').dispatches).toBe(1)
  })
})

describe('inserts', () => {
  it('link: the selection is the text and `url` is selected', () => {
    expect(run(insertLink, 'see ‹docs› now')).toBe('see [docs](‹url›) now')
    expect(run(insertLink, 'see ‸')).toBe('see [](‹url›)')
  })
  it('link: a selected URL goes in the parentheses, caret in the text', () => {
    expect(run(insertLink, '‹https://x.dev›')).toBe('[‸](https://x.dev)')
  })
  it('wikilink: caret inside, selection kept as the target, typed as input', () => {
    expect(run(insertWikilink, 'go ‸')).toBe('go [[‸]]')
    expect(run(insertWikilink, 'go ‹Home›')).toBe('go [[Home‸]]')
    const view = fakeView(makeState('‸'))
    insertWikilink(view)
    expect(view.transactions[0].isUserEvent('input.type')).toBe(true)
  })
  it('image: alt from the selection, `url` selected', () => {
    expect(run(insertImage, '‹cat›')).toBe('![cat](‹url›)')
    expect(run(insertImage, '‸')).toBe('![](‹url›)')
  })
  it('table: a 2-column skeleton on its own lines, caret in the first cell', () => {
    expect(run(insertTable, '‸')).toBe('| ‸ |  |\n| --- | --- |\n|  |  |\n|  |  |')
    expect(run(insertTable, 'para‸\nnext')).toBe(
      'para\n\n| ‸ |  |\n| --- | --- |\n|  |  |\n|  |  |\n\nnext'
    )
  })
  it('table: a blank caret line becomes the table', () => {
    expect(run(insertTable, 'above\n‸\nbelow')).toBe('above\n\n| ‸ |  |\n| --- | --- |\n|  |  |\n|  |  |\n\nbelow')
  })
  it('every insert is a no-op inside a code fence', () => {
    for (const cmd of [insertLink, insertWikilink, insertImage, insertTable]) {
      expect(apply(cmd, FENCE).ran).toBe(false)
    }
  })
  it('multi-range', () => {
    expect(run(insertWikilink, '‸ and ‸')).toBe('[[‸]] and [[‸]]')
  })
})

describe('block commands (E6)', () => {
  it('indent: a list line nests under its sibling, as Tab does', () => {
    expect(run(indentFormat, '- a\n- b‸')).toBe('- a\n  - b‸')
  })
  it('indent: off a list line it indents the line', () => {
    expect(apply(indentFormat, 'pla‸in').ran).toBe(true)
    expect(run(indentFormat, 'pla‸in')).not.toBe('pla‸in')
  })
  it('outdent: takes one indent unit off a nested list line', () => {
    expect(run(outdentFormat, '- a\n\t- b‸')).toBe('- a\n- b‸')
  })
  it('callout: the first line takes `> [!note] `, the rest `> `, a gap `>`', () => {
    expect(run(insertCallout, '‸')).toBe('> [!note] ‸')
    expect(run(insertCallout, 'Ti‸tle')).toBe('> [!note] Ti‸tle')
    expect(run(insertCallout, '‹one\n\ntwo›')).toBe('‹> [!note] one\n>\n> two›')
  })
  it('callout: toggles off on a callout', () => {
    expect(run(insertCallout, '> [!note] ‹one\n>\n> two›')).toBe('‹one\n\ntwo›')
    expect(twice(insertCallout, 'Ti‸tle')).toBe('Ti‸tle')
  })
  it('code block: an empty block, caret on the info string', () => {
    expect(run(insertCodeBlock, '‸')).toBe('```‸\n\n```')
    expect(run(insertCodeBlock, 'text‸')).toBe('text\n```‸\n\n```')
  })
  it('code block: wraps the selected lines, with a fence longer than any inside', () => {
    expect(run(insertCodeBlock, 'a‹b\nc›d')).toBe('```‸\nab\ncd\n```')
    expect(run(insertCodeBlock, '‹a ``` b›')).toBe('````‸\na ``` b\n````')
  })
  it('code block: a no-op inside a fence', () => {
    expect(apply(insertCodeBlock, FENCE).ran).toBe(false)
  })
  it('rule: `---` on its own line, never a setext underline', () => {
    expect(run(insertRule, '‸')).toBe('---\n‸')
    expect(run(insertRule, 'para‸')).toBe('para\n\n---\n‸')
    expect(run(insertRule, 'para\n‸')).toBe('para\n\n---\n‸')
    expect(run(insertRule, 'para‸\nnext')).toBe('para\n\n---\n‸\nnext')
  })
  it('every new command is one transaction and answers false read-only', () => {
    for (const cmd of [insertCallout, insertCodeBlock, insertRule, toggleHighlight]) {
      expect(apply(cmd, 'x‸').dispatches).toBe(1)
      expect(apply(cmd, 'x‸', true).ran).toBe(false)
    }
  })
})

describe('frontmatter', () => {
  it('is literal: no command edits inside it', () => {
    const doc = '---\ntitle: x‸\n---\nbody'
    expect(apply(toggleBulletList, doc).ran).toBe(false)
    expect(apply(toggleBold, doc).ran).toBe(false)
  })
})

describe('FORMAT_COMMANDS', () => {
  it('is the ordered table, with its default keys', () => {
    expect(FORMAT_COMMANDS.map((c) => c.id)).toEqual([
      'format.bold',
      'format.italic',
      'format.strike',
      'format.highlight',
      'format.code',
      'format.heading-1',
      'format.heading-2',
      'format.heading-3',
      'format.paragraph',
      'format.list',
      'format.ordered-list',
      'format.task',
      'format.indent',
      'format.outdent',
      'format.quote',
      'format.callout',
      'format.code-block',
      'format.link',
      'format.wikilink',
      'format.table',
      'format.image',
      'format.rule',
    ])
    expect(FORMAT_COMMANDS.filter((c) => c.keys).map((c) => [c.id, c.keys])).toEqual([
      ['format.bold', 'Mod+b'],
      ['format.italic', 'Mod+i'],
      ['format.strike', 'Mod+Shift+x'],
      ['format.highlight', 'Mod+Shift+h'],
      ['format.code', 'Mod+Shift+c'],
      ['format.list', 'Mod+Shift+8'],
      ['format.ordered-list', 'Mod+Shift+7'],
      ['format.link', 'Mod+k'],
    ])
  })
  it('the CM6 keymap is the same keys in CM6 spelling', () => {
    expect(formatKeymap().map((k) => k.key)).toEqual([
      'Mod-b',
      'Mod-i',
      'Mod-Shift-x',
      'Mod-Shift-h',
      'Mod-Shift-c',
      'Mod-Shift-8',
      'Mod-Shift-7',
      'Mod-k',
    ])
  })
})

describe('formatKeymap(bindings) — the host’s resolved keymap (quiet-shell F10)', () => {
  const runOf = (id: string) => FORMAT_COMMANDS.find((c) => c.id === id)!.run
  it('a cleared format.bold ([]) takes Mod-b out of the editor', () => {
    const table = formatKeymap({ 'format.bold': [] })
    expect(table.map((k) => k.key)).not.toContain('Mod-b')
    expect(table.map((k) => k.key)).toContain('Mod-i')
    expect(table.some((k) => k.run === toggleBold)).toBe(false)
  })
  it('a rebind replaces the default; several chords bind several keys', () => {
    const table = formatKeymap({ 'format.bold': ['Alt+B'], 'format.strike': ['Mod+Shift+s', 'Alt+s'] })
    expect(table.map((k) => k.key).slice(0, 4)).toEqual(['Alt-b', 'Mod-i', 'Mod-Shift-s', 'Alt-s'])
    expect(table.map((k) => k.key)).not.toContain('Mod-Shift-x')
    expect(table.find((k) => k.key === 'Alt-b')?.run).toBe(toggleBold)
    expect(table.find((k) => k.key === 'Alt-s')?.run).toBe(runOf('format.strike'))
  })
  it('an absent id keeps its default', () => {
    const keys = formatKeymap({ 'format.code': ['Mod+e'] }).map((k) => k.key)
    expect(keys).toContain('Mod-e')
    expect(keys).not.toContain('Mod-Shift-c')
    expect(keys).toContain('Mod-Shift-x')
  })
  it('cmKey spells registry chords the CM6 way', () => {
    expect(cmKey('Mod+Shift+K')).toBe('Mod-Shift-k')
    expect(cmKey('Mod+-')).toBe('Mod--')
    expect(cmKey('Ctrl+Mod+ArrowLeft', true)).toBe('Ctrl-Mod-ArrowLeft')
    expect(cmKey('Mod+=')).toBe('Mod-=')
    expect(cmKey('')).toBeNull()
  })
  it('off a Mac, Ctrl+Mod+X is pressed as Ctrl+Alt+X (Alt+Arrow on the arrows), as in the shell', () => {
    expect(cmKey('Ctrl+Mod+b', false)).toBe('Ctrl-Alt-b')
    expect(cmKey('Ctrl+Mod+Shift+b', false)).toBe('Ctrl-Alt-Shift-b')
    expect(cmKey('Ctrl+Mod+ArrowLeft', false)).toBe('Alt-ArrowLeft')
    expect(cmKey('Ctrl+b', false)).toBe('Ctrl-b')
    expect(cmKey('Ctrl+Mod+b', true)).toBe('Ctrl-Mod-b')
    expect(formatKeymap({ 'format.bold': ['Ctrl+Mod+b'] }, false)[0]!.key).toBe('Ctrl-Alt-b')
  })
  it('editorKeymap rebinds or unbinds any editor key by id — edit.toggle-checkbox too', () => {
    const run = () => true
    const keys = [{ id: 'edit.toggle-checkbox' as const, run, keys: 'Mod+l' }, ...FORMAT_COMMANDS]
    expect(editorKeymap(keys).map((k) => k.key).slice(0, 3)).toEqual(['Mod-l', 'Mod-b', 'Mod-i'])
    expect(editorKeymap(keys, { 'edit.toggle-checkbox': [] }).some((k) => k.run === run)).toBe(false)
    expect(editorKeymap(keys, { 'edit.toggle-checkbox': ['Alt+l'] }).find((k) => k.run === run)?.key).toBe('Alt-l')
  })
})
