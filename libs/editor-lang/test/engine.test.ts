/**
 * The extension itself: what the field and the plugin rebuild on, and that the
 * two halves of the build add up to the whole (the split in preview/index.ts is
 * a performance decision; it must not be a behaviour decision).
 */
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  Frontmatter,
  Highlight,
  livePreview,
  previewMode,
  readHost,
  refreshPreview,
  Tag,
  WikiLink,
  wikiLinkExtensions,
} from '../src/index.js'
import {
  buildBlockPreview,
  buildInlinePreview,
  buildPreview,
  type PreviewDecorations,
} from '../src/preview/build.js'
import { blockPreviewField } from '../src/preview/index.js'
import { makeState, modeCompartment, testHost } from './support.js'

const note =
  '---\ntags: [a]\n---\n\n# Head\n\n- [ ] a **task** with [a link](https://ex.dev) and #tag\n\n---\n\n```js\nlet a\n```\n\n![[shot.png]]\n'

const ranges = (set: PreviewDecorations['decorations'], len: number): string[] => {
  const out: string[] = []
  set.between(0, len, (from, to, deco) => {
    out.push(`${from}-${to}:${(deco.spec as { class?: string }).class ?? 'replace'}`)
  })
  return out
}

describe('the block / inline split', () => {
  it('adds up to the whole document’s decorations', () => {
    const state = makeState(note, { at: 200, mode: 'live' })
    const whole = state.doc.length
    const all = ranges(buildPreview(state).decorations, whole)
    const split = [
      ...ranges(buildBlockPreview(state).decorations, whole),
      ...ranges(buildInlinePreview(state, [{ from: 0, to: whole }]).decorations, whole),
    ].sort()
    expect(split).toEqual([...all].sort())
  })

  it('puts every block widget in the field’s half, where CM6 accepts them', () => {
    const state = makeState(note, { at: 200 })
    const blocks = buildBlockPreview(state)
    let blockCount = 0
    blocks.decorations.between(0, state.doc.length, (_f, _t, deco) => {
      expect((deco.spec as { block?: boolean }).block).toBe(true)
      blockCount++
    })
    expect(blockCount).toBeGreaterThan(0)
    // ...and none of them in the plugin's half, which CM6 would throw on.
    buildInlinePreview(state, [{ from: 0, to: state.doc.length }]).decorations.between(
      0,
      state.doc.length,
      (_f, _t, deco) => {
        expect((deco.spec as { block?: boolean }).block).toBeFalsy()
      }
    )
  })
})

describe('when the block field rebuilds', () => {
  const state = makeState(note, { at: 200 })

  it('does nothing for a transaction that changes nothing', () => {
    const before = state.field(blockPreviewField)
    expect(state.update({}).state.field(blockPreviewField)).toBe(before)
  })

  it('rebuilds when the selection moves — the active region is an input', () => {
    const before = state.field(blockPreviewField)
    const moved = state.update({ selection: EditorSelection.single(5) }).state
    expect(moved.field(blockPreviewField)).not.toBe(before)
  })

  it('rebuilds when the document changes', () => {
    const before = state.field(blockPreviewField)
    const typed = state.update({ changes: { from: 20, insert: 'x' } }).state
    expect(typed.field(blockPreviewField)).not.toBe(before)
  })

  it('rebuilds on `refreshPreview` — the host’s own inputs changed, not the state’s', () => {
    // Membership of a collection lives in the host, outside the state: the
    // host flips its answer and asks for a rebuild with one effect.
    let member = false
    const hostCompartment = new Compartment()
    const host = testHost({ inCollection: () => member, mountProperties: () => ({ update: () => {}, destroy: () => {} }) })
    const s = makeState(note, { at: 200, extensions: [hostCompartment.of(readHost.of(host))] })
    const widget = (st: EditorState): string | undefined => {
      let name: string | undefined
      st.field(blockPreviewField).decorations.between(0, 20, (_f, _t, deco) => {
        name = (deco.spec as { widget?: object }).widget?.constructor.name
      })
      return name
    }
    expect(widget(s)).toBe('FrontmatterStripWidget')
    member = true
    expect(widget(s.update({}).state)).toBe('FrontmatterStripWidget')
    expect(widget(s.update({ effects: refreshPreview.of(null) }).state)).toBe('PropertiesFormWidget')
  })

  it('rebuilds when the mode is reconfigured — Reading draws what Live hides', () => {
    const table = makeState('| a |\n| --- |\n| 1 |\n', { at: 0 })
    expect(table.field(blockPreviewField).decorations.size).toBe(0)
    const reading = table.update({
      effects: modeCompartment.reconfigure(previewMode.of('reading')),
    }).state
    // The Reading table is a block widget, so it appears in the field's half.
    expect(reading.field(blockPreviewField).decorations.size).toBe(1)
  })
})

describe('the extension set libs/editor installs', () => {
  it('composes with the wikilink extensions — one autocompletion, not two', () => {
    // Two `autocompletion()` configs are a CM6 config merge conflict on
    // `override`, thrown at state creation; the `#` source therefore lives in
    // the single install inside wikiLinkExtensions().
    const state = EditorState.create({
      doc: '# Head\n\n- [ ] a task with [[a link]] and #tag\n',
      extensions: [
        markdown({ base: markdownLanguage, extensions: [WikiLink, Tag, Highlight, Frontmatter] }),
        ...wikiLinkExtensions(),
        ...livePreview(),
      ],
    })
    expect(state.field(blockPreviewField)).toBeDefined()
  })
})

describe('the frontmatter block through an edit (R4.1.1)', () => {
  const widgets = (state: EditorState): string[] => {
    const out: string[] = []
    buildBlockPreview(state).decorations.between(0, state.doc.length, (_f, _t, deco) => {
      out.push((deco.spec as { widget?: object }).widget?.constructor.name ?? '')
    })
    return out
  }

  it('dissolves when the fence is broken, and comes back when it is typed again', () => {
    const block = makeState('---\ntags: [a]\n---\n\nbody\n', { at: 24 })
    expect(widgets(block)).toEqual(['FrontmatterStripWidget'])

    // Take a dash off the opening fence. Nothing repairs it and nothing
    // prompts: the parser stops seeing frontmatter, and the lines are whatever
    // they now are (here a setext heading — which hides nothing).
    const broken = block.update({ changes: { from: 0, to: 1 } }).state
    expect(widgets(broken)).toEqual([])
    expect(buildBlockPreview(broken).hidden.size).toBe(0)

    // Type it back: the block is frontmatter again, and the strip returns.
    const fixed = broken.update({ changes: { from: 0, insert: '-' } }).state
    expect(widgets(fixed)).toEqual(['FrontmatterStripWidget'])
  })

  it('comes back after a line above it is put in and taken out again', () => {
    // The same promise, through the edit that lezer cannot see: a DELETION AT
    // OFFSET 0 leaves a reusable fragment starting at 0, and the block parser
    // only ever runs there — so the tree still says "rule, setext heading"
    // after the note is whole again. The text is the authority on what a note
    // is, and the engine asks it (R4.1.1).
    const note = '---\ntags: [a]\n---\n\nbody\n'
    const block = makeState(note, { at: note.length })
    expect(widgets(block)).toEqual(['FrontmatterStripWidget'])

    const pushed = block.update({ changes: { from: 0, insert: '\n' } }).state
    expect(widgets(pushed)).toEqual(['RuleWidget'])

    const back = pushed.update({ changes: { from: 0, to: 1 } }).state
    expect(back.doc.toString()).toBe(note)
    expect(widgets(back)).toEqual(['FrontmatterStripWidget'])
    // …and nothing the stale tree still believes is drawn over the block.
    expect(
      buildBlockPreview(back).decorations.size + buildInlinePreview(back, [{ from: 0, to: 17 }]).decorations.size
    ).toBe(1)
  })
})
