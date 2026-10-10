/**
 * The construct table (read-shaping.md B2), row by row, plus the rules that are
 * easy to get wrong: what the active region reveals, what each mode hides, and
 * the invariant that the caret can never land inside hidden text.
 *
 * Everything here is the decoration SET, not the DOM: the engine is a function
 * of the state, and that is what makes the whole table testable in node (R6).
 */
import { describe, expect, it } from 'vitest'
import { buildPreview } from '../src/preview/build.js'
import type { FenceWidget } from '../src/preview/code-widgets.js'
import type {
  CheckboxWidget,
  CollectionEmbedWidget,
  EmbedWidget,
  FrontmatterStripWidget,
  PropertiesFormWidget,
} from '../src/preview/widgets.js'
import { decorations, hidden, makeState, testHost, type FlatDeco } from './support.js'

const at = (decos: FlatDeco[], text: string): FlatDeco[] => decos.filter((d) => d.text === text)
const kinds = (decos: FlatDeco[], text: string): string[] => at(decos, text).map((d) => d.kind)
const classes = (decos: FlatDeco[], text: string): string[] => at(decos, text).map((d) => d.value)
const hides = (decos: FlatDeco[], text: string): boolean =>
  at(decos, text).some((d) => d.kind === 'hide' || d.kind.endsWith('widget'))

describe('headings (1,659)', () => {
  const note = 'intro\n\n### A heading\n'

  it('hides the marker and sizes the line off the active region', () => {
    const decos = decorations(makeState(note, { at: 0 }))
    expect(hides(decos, '### ')).toBe(true)
    expect(decos.some((d) => d.kind === 'line' && d.value === 'cm-live-h3')).toBe(true)
  })

  it('gives the marker back when the caret is on the line', () => {
    const decos = decorations(makeState(note, { at: 12 }))
    expect(hides(decos, '### ')).toBe(false)
    // The line class stays: styling is not hiding, so Source is styled too.
    expect(decos.some((d) => d.value === 'cm-live-h3')).toBe(true)
  })
})

describe('emphasis, code and highlight (2,514 / 1,655 / 5,300 / 3)', () => {
  const note = 'a **bold** and *ital* and ~~gone~~ and ==mark== and `code` here\n'

  it('hides every delimiter off the active region', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))
    expect(kinds(decos, '**')).toEqual(['hide', 'hide'])
    expect(kinds(decos, '*')).toEqual(['hide', 'hide'])
    expect(kinds(decos, '~~')).toEqual(['hide', 'hide'])
    expect(kinds(decos, '==')).toEqual(['hide', 'hide'])
    expect(kinds(decos, '`')).toEqual(['hide', 'hide'])
    expect(classes(decos, 'code')).toContain('cm-inline-code')
  })

  it('shows them all when the caret is on the line', () => {
    const decos = decorations(makeState(note, { at: 3 }))
    expect(decos.filter((d) => d.kind === 'hide')).toEqual([])
    // The inline-code chip is style, so it survives the reveal.
    expect(classes(decos, 'code')).toContain('cm-inline-code')
  })
})

describe('lists (14,909 bullets / 9,055 ordered / 1,941 tasks)', () => {
  const note = '- plain\n\t- nested\n1. ordered\n- [ ] todo\n- [x] done\n'

  it('replaces `- ` with a bullet, leaving the indent as text', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))
    const bullets = decos.filter((d) => d.value === 'BulletWidget')
    expect(bullets).toHaveLength(2)
    // Only the marker and its space: the tab in front of the nested item is
    // untouched text, so tab-size 4 puts the bullet at its column.
    expect(bullets.map((b) => b.text)).toEqual(['- ', '- '])
  })

  it('styles an ordered marker instead of replacing it', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))
    expect(classes(decos, '1.')).toEqual(['cm-list-num'])
  })

  it('draws a checkbox in place of the brackets, and no bullet beside it', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))
    const boxes = decos.filter((d) => d.value === 'CheckboxWidget')
    expect(boxes.map((b) => b.text)).toEqual(['[ ]', '[x]'])
    expect((boxes[0].widget as CheckboxWidget).done).toBe(false)
    expect((boxes[1].widget as CheckboxWidget).done).toBe(true)
    // The task's own text is the checkbox's accessible name — no i18n needed.
    expect((boxes[0].widget as CheckboxWidget).label).toBe('todo')
    // `- ` before a task is hidden, not bulleted.
    expect(decos.filter((d) => d.text === '- ' && d.value === 'BulletWidget')).toHaveLength(2)
  })

  it('keeps the checkbox on the active line', () => {
    const decos = decorations(makeState(note, { at: 33 })) // on the `- [ ] todo` line
    expect(decos.some((d) => d.value === 'CheckboxWidget')).toBe(true)
  })

  it('names a checkbox after its task — and a task with no text after nothing else', () => {
    const decos = decorations(makeState('- [ ] write the report\n', { at: 40 }))
    expect((decos.find((d) => d.value === 'CheckboxWidget')?.widget as CheckboxWidget).label).toBe(
      'write the report'
    )
    // A task you have only just opened has no text; an unnamed checkbox is an
    // axe violation and a screen-reader dead end, so the host's word stands in.
    const empty = decorations(makeState('- [ ] \n', { at: 40 }))
    expect((empty.find((d) => d.value === 'CheckboxWidget')?.widget as CheckboxWidget).label).toBe(
      'Task'
    )
  })

  it('gives the brackets back when the selection is inside them', () => {
    const note2 = '- [ ] todo\n'
    const decos = decorations(makeState(note2, { at: 3 }))
    expect(decos.some((d) => d.value === 'CheckboxWidget')).toBe(false)
  })
})

describe('links (5,631 markdown / 3,005 bare / 947 wikilinks)', () => {
  const note = 'see [the docs](https://ex.dev/a) and https://bare.dev and [[Note|alias]] and [[Plain]]\n'
  const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))

  it('collapses `[text](url)` to its text', () => {
    expect(kinds(decos, '[')).toEqual(['hide'])
    expect(kinds(decos, '](https://ex.dev/a)')).toEqual(['hide'])
    expect(classes(decos, 'the docs')).toEqual(['cm-md-link cm-live-link'])
  })

  it('marks a bare URL without hiding anything', () => {
    expect(classes(decos, 'https://bare.dev')).toEqual(['cm-url cm-live-link'])
  })

  it('shows a wikilink as its alias, or as its target', () => {
    expect(kinds(decos, '[[Note|')).toEqual(['hide'])
    expect(classes(decos, 'alias')).toEqual(['cm-wikilink-unresolved cm-live-link'])
    expect(classes(decos, 'Plain')).toEqual(['cm-wikilink-unresolved cm-live-link'])
    expect(kinds(decos, ']]')).toEqual(['hide', 'hide'])
  })

  it('marks a resolved wikilink differently from one with no note behind it', () => {
    // 12% of this vault's targets resolve to nothing and read as intent, so the
    // rendered label has to keep saying which it is.
    const resolving = makeState('[[Plain]]\n', {
      mode: 'reading',
      linkHost: { resolve: () => 'Notes/Plain.md', open: () => {}, create: () => {}, candidates: () => [] },
    })
    expect(classes(decorations(resolving), 'Plain')).toEqual(['cm-wikilink cm-live-link'])
  })

  it('marks a RAW link once, on its target, and without the pointer', () => {
    // R2 2026-09-13: the raw form used to come from a second ViewPlugin, so a
    // rendered link carried both its label span and a target span inside it.
    // One owner now, and `cm-live-link` is what says a plain click follows it.
    const source = decorations(makeState('see [[Note|alias]] and [[Plain]]\n', { mode: 'source' }))
    expect(classes(source, 'Note')).toEqual(['cm-wikilink-unresolved'])
    expect(classes(source, 'Plain')).toEqual(['cm-wikilink-unresolved'])
    expect(source.filter((d) => d.kind === 'hide')).toEqual([])

    // …and in Live it is the caret's own line that keeps the raw form.
    const live = decorations(makeState('[[Plain]]\n', { at: 2 }))
    expect(classes(live, 'Plain')).toEqual(['cm-wikilink-unresolved'])
  })
})

describe('blocks: quotes, rules, fences (1,016 / 314 / 527)', () => {
  it('hides `> ` and marks the line', () => {
    const decos = decorations(makeState('> quoted line\n', { at: 0, mode: 'reading' }))
    expect(kinds(decos, '> ')).toEqual(['hide'])
    expect(decos.some((d) => d.kind === 'line' && d.value === 'cm-live-quote')).toBe(true)
  })

  it('draws a rule in place of its line', () => {
    const decos = decorations(makeState('text\n\n---\n\nmore\n', { at: 0 }))
    const rule = decos.find((d) => d.value === 'RuleWidget')
    expect(rule?.kind).toBe('block-widget')
    expect(rule?.text).toBe('---')
  })

  it('shows the rule as text when the caret is on it', () => {
    const decos = decorations(makeState('text\n\n---\n\nmore\n', { at: 7 }))
    expect(decos.some((d) => d.value === 'RuleWidget')).toBe(false)
  })

  it('caps a fence with its language, and slabs the lines between', () => {
    const decos = decorations(makeState('```rust\nfn main() {}\n```\n', { at: 30, mode: 'live' }))
    const fences = decos.filter((d) => d.value === 'FenceWidget')
    expect(fences.map((f) => f.kind)).toEqual(['block-widget', 'block-widget'])
    expect((fences[0].widget as FenceWidget).lang).toBe('rust')
    expect((fences[1].widget as FenceWidget).lang).toBe(null)
    expect(decos.filter((d) => d.kind === 'line' && d.value === 'cm-live-code')).toHaveLength(1)
  })

  it('keeps both fences drawn when the caret is in the code (E3)', () => {
    const decos = decorations(makeState('```rust\nfn main() {}\n```\n', { at: 10 }))
    expect(decos.filter((d) => d.value === 'FenceWidget')).toHaveLength(2)
    expect(decos.filter((d) => d.kind === 'line' && d.value === 'cm-live-code')).toHaveLength(1)
  })

  it('shows only the fence line the caret is on as text (E3)', () => {
    // On the opening line: it is text (with the card's top edge), the cap stays.
    const open = decorations(makeState('```rust\nfn main() {}\n```\n', { at: 3 }))
    expect(open.filter((d) => d.value === 'FenceWidget').map((d) => d.text)).toEqual(['```'])
    expect(classes(open, '')).toEqual(expect.arrayContaining(['cm-live-code', 'cm-code-first']))
    // On the closing line: the header stays, the cap is text with the bottom edge.
    const close = decorations(makeState('```rust\nfn main() {}\n```\n', { at: 22 }))
    expect(close.filter((d) => d.value === 'FenceWidget').map((d) => d.text)).toEqual(['```rust'])
    expect(close.filter((d) => d.kind === 'line' && d.value === 'cm-code-last')).toHaveLength(1)
  })
})

describe('embeds (14, all .png)', () => {
  it('replaces a line-of-its-own embed with a block image', () => {
    const decos = decorations(makeState('text\n\n![[shot.png]]\n', { at: 0 }))
    const embed = decos.find((d) => d.value === 'EmbedWidget')
    expect(embed?.kind).toBe('block-widget')
    expect((embed?.widget as EmbedWidget).name).toBe('shot.png')
    expect((embed?.widget as EmbedWidget).block).toBe(true)
  })

  it('keeps an embed inside a sentence inline — a block widget may not split a line', () => {
    const decos = decorations(makeState('see ![[shot.png]] there\n', { at: 30, mode: 'reading' }))
    const embed = decos.find((d) => d.value === 'EmbedWidget')
    expect(embed?.kind).toBe('widget')
    expect((embed?.widget as EmbedWidget).block).toBe(false)
  })

  it('draws nothing but pictures — a PDF or a transclusion stays as its text', () => {
    // An <img> over bytes that are not an image is a broken image, and a
    // *missing attachment* placeholder over a file that is right there is a
    // lie. Both are markup this renderer has no picture for, so both stay text.
    for (const name of ['paper.pdf', 'Some Note', 'archive.zip']) {
      const decos = decorations(makeState(`![[${name}]]\n`, { at: 30 }))
      expect(decos.some((d) => d.value === 'EmbedWidget')).toBe(false)
      expect(hidden(makeState(`![[${name}]]\n`, { at: 30 }))).toEqual([])
    }
    // …and the picture types still draw, whatever their case.
    for (const name of ['shot.PNG', 'a.jpeg', 'b.svg']) {
      expect(
        decorations(makeState(`![[${name}]]\n`, { at: 30 })).some((d) => d.value === 'EmbedWidget')
      ).toBe(true)
    }
  })
})

describe('collection embeds (bases-shaping A6)', () => {
  /** A host that can mount a collection and knows one file. */
  const host = () =>
    testHost({
      resolveCollection: (name) => (name === 'Competitors.base' ? 'Areas/Competitors.base' : null),
      mountCollection: () => ({ update: () => {}, destroy: () => {} }),
    })
  const widgetOf = (doc: string, over = {}) =>
    decorations(makeState(doc, { at: 0, host: host(), ...over })).find((d) => d.value === 'CollectionEmbedWidget')

  it('mounts the first view of a resolved collection as a block', () => {
    const embed = widgetOf('intro\n\n![[Competitors.base]]\n')
    expect(embed?.kind).toBe('block-widget')
    const w = embed?.widget as CollectionEmbedWidget
    expect(w.name).toBe('Competitors.base')
    expect(w.path).toBe('Areas/Competitors.base')
    expect(w.view).toBeNull()
  })

  it('names the view after `#`, and tolerates an alias after `|`', () => {
    const w = widgetOf('intro\n\n![[Competitors.base#Threat Watch|whatever]]\n')?.widget as CollectionEmbedWidget
    expect(w.view).toBe('Threat Watch')
    expect(w.path).toBe('Areas/Competitors.base')
  })

  it('draws the missing placeholder for a collection the vault has not got', () => {
    const w = widgetOf('intro\n\n![[Nope.base]]\n')?.widget as CollectionEmbedWidget
    expect(w.path).toBeNull()
    expect(w.name).toBe('Nope.base')
  })

  it('stays as its text inside a sentence, in Source, in the active region, and without a host', () => {
    expect(widgetOf('see ![[Competitors.base]] here\n')).toBeUndefined()
    expect(widgetOf('![[Competitors.base]]\n', { mode: 'source' })).toBeUndefined()
    expect(widgetOf('![[Competitors.base]]\n', { at: 3 })).toBeUndefined()
    expect(
      decorations(makeState('intro\n\n![[Competitors.base]]\n', { at: 0 })).some((d) => d.value === 'CollectionEmbedWidget')
    ).toBe(false)
    // …and a `.base` the host cannot mount is not an image either.
    expect(decorations(makeState('intro\n\n![[Competitors.base]]\n', { at: 0 })).some((d) => d.value === 'EmbedWidget')).toBe(false)
  })

  it('renders in Reading too', () => {
    expect(widgetOf('intro\n\n![[Competitors.base]]\n', { mode: 'reading' })?.kind).toBe('block-widget')
  })
})

describe('tags, block ids and HTML (28 / 27 / 24)', () => {
  it('chips a tag in every mode — a chip hides nothing', () => {
    for (const mode of ['live', 'source', 'reading'] as const) {
      const decos = decorations(makeState('about #edible/roadmap today\n', { at: 0, mode }))
      expect(classes(decos, '#edible/roadmap')).toEqual(['cm-tag'])
    }
  })

  it('dims a block id at the end of a line, and never resolves it', () => {
    const decos = decorations(makeState('a paragraph ^abc123\n', { at: 30 }))
    expect(classes(decos, '^abc123')).toEqual(['cm-block-id'])
  })

  it('styles HTML as code and never renders it', () => {
    const decos = decorations(makeState('<iframe src="x"></iframe>\n', { at: 30, mode: 'reading' }))
    expect(classes(decos, '<iframe src="x"></iframe>')).toEqual(['cm-html'])
    expect(decos.some((d) => d.kind === 'hide')).toBe(false)
  })
})

describe('tables (16 blocks)', () => {
  const note = '| a | b |\n| --- | --- |\n| 1 | *2* |\n'

  it('is source-styled in Live: pipes marked, nothing hidden', () => {
    const decos = decorations(makeState(note, { at: 30 }))
    expect(decos.filter((d) => d.value === 'cm-table-pipe').length).toBeGreaterThan(0)
    expect(decos.some((d) => d.kind === 'line' && d.value === 'cm-table-head')).toBe(true)
    expect(decos.some((d) => d.kind === 'block-widget')).toBe(false)
  })

  it('is one block widget in Reading, built from the tree', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'reading' }))
    const table = decos.find((d) => d.value === 'TableWidget')
    expect(table?.kind).toBe('block-widget')
    expect(table?.text).toBe(note.trimEnd())
  })
})

describe('modes', () => {
  const note = '# Head\n\n- [ ] a **task**\n'

  it('Source hides nothing at all', () => {
    const decos = decorations(makeState(note, { at: 0, mode: 'source' }))
    expect(decos.filter((d) => d.kind !== 'line' && d.kind !== 'mark')).toEqual([])
  })

  it('Reading has no active region, so the caret’s line renders too', () => {
    const decos = decorations(makeState(note, { at: 2, mode: 'reading' }))
    expect(hides(decos, '# ')).toBe(true)
  })
})

describe('the atomic-range invariant (R2.2)', () => {
  const note =
    '---\ntags: [a]\n---\n\n# Head\n\n- [ ] a **task** with [a link](https://ex.dev) and #tag\n\n---\n\n```js\nlet a\n```\n\n![[shot.png]]\n'

  it('hands every hidden range to atomicRanges', () => {
    const state = makeState(note, { at: 0, mode: 'reading' })
    const replaced = decorations(state)
      .filter((d) => d.kind === 'hide' || d.kind === 'widget' || d.kind === 'block-widget')
      .map((d) => `${d.from}-${d.to}`)
    expect(hidden(state).map((h) => `${h.from}-${h.to}`)).toEqual(replaced)
  })

  it('never hides the position the caret is actually at', () => {
    // The honest form of "the caret cannot land inside hidden text": put it at
    // every offset in turn and check what THAT state hides. The active region
    // is what makes this hold — a caret on a line reveals its markers — and
    // where it does not (a checkbox stays drawn), the selection-inside rule does.
    for (let pos = 0; pos <= note.length; pos++) {
      const inside = hidden(makeState(note, { at: pos, mode: 'live' })).filter(
        (range) => pos > range.from && pos < range.to
      )
      expect({ pos, inside }).toEqual({ pos, inside: [] })
    }
  })
})

describe('the frontmatter strip (17 files, Fork 5-C)', () => {
  const note = '---\ntitle: A note\ntags: [composition testing]\n---\n\n# Body\n'

  it('collapses the whole block to chips and a count', () => {
    const decos = decorations(makeState(note, { at: 55 }))
    const strip = decos.find((d) => d.value === 'FrontmatterStripWidget')
    expect(strip?.kind).toBe('block-widget')
    expect(strip?.from).toBe(0)
    expect(strip?.to).toBe(49)
    const widget = strip?.widget as FrontmatterStripWidget
    // The vault's legacy space-separated flow list reads as two tags.
    expect(widget.tags).toEqual(['composition', 'testing'])
    expect(widget.properties).toBe(2)
    expect(widget.supported).toBe(true)
    expect(widget.editable).toBe(true)
  })

  it('is the YAML again the moment the caret is anywhere in the block (R4.1.1)', () => {
    for (const pos of [0, 5, 20, 46]) {
      const decos = decorations(makeState(note, { at: pos }))
      expect(decos.some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
      expect(decos.filter((d) => d.kind === 'line' && d.value === 'cm-live-frontmatter')).toHaveLength(4)
    }
  })

  it('badges a block the patcher cannot round-trip, rather than fixing it', () => {
    const nested = '---\nkey:\n  nested: true\n---\n\nbody\n'
    const strip = decorations(makeState(nested, { at: 30 })).find(
      (d) => d.value === 'FrontmatterStripWidget'
    )
    expect((strip?.widget as FrontmatterStripWidget).supported).toBe(false)
  })

  it('is not clickable in Reading — there is no caret to hand back', () => {
    const strip = decorations(makeState(note, { at: 0, mode: 'reading' })).find(
      (d) => d.value === 'FrontmatterStripWidget'
    )
    expect((strip?.widget as FrontmatterStripWidget).editable).toBe(false)
  })

  it('leaves the YAML visible when the host has no frontmatter reader', () => {
    const host = testHost()
    delete host.frontmatter
    const decos = decorations(makeState(note, { at: 55, host }))
    expect(decos.some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
    expect(decos.filter((d) => d.value === 'cm-live-frontmatter')).toHaveLength(4)
  })

  it('collapses a block the GRAMMAR will not claim — the text is the authority', () => {
    // `# why` is a YAML comment and an ATX heading, and the block parser reads
    // it as the heading (see frontmatter-block.ts). @ohhi/frontmatter reads
    // the block, so the strip is drawn from the text and the markdown the tree
    // thinks is in there — a rule, a setext heading — is not drawn at all.
    const commented = '---\n# why\ntags: [a]\n---\n\nbody\n'
    const decos = decorations(makeState(commented, { at: commented.length }))
    const strip = decos.find((d) => d.value === 'FrontmatterStripWidget')
    expect(strip?.from).toBe(0)
    expect(strip?.to).toBe(23)
    expect((strip?.widget as FrontmatterStripWidget).tags).toEqual(['a'])
    expect(decos.filter((d) => d.from < 23)).toHaveLength(1)
  })

  it('never collapses a block that is still being typed', () => {
    const half = '---\ntags: [a]\n\n# Body\n'
    const decos = decorations(makeState(half, { at: half.length }))
    expect(decos.some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
    expect(hidden(makeState(half, { at: half.length }))).toEqual([])
  })
})

describe('the properties form on a row-note (bases-shaping A7, Fork 3-B)', () => {
  const note = '---\ntitle: A note\ntags: [composition testing]\n---\n\n# Body\n'
  const member = (over = {}) =>
    testHost({
      inCollection: () => true,
      mountProperties: () => ({ update: () => {}, destroy: () => {} }),
      ...over,
    })
  const names = (doc: string, over = {}) =>
    decorations(makeState(doc, { at: 55, host: member(), ...over })).filter((d) => d.kind === 'block-widget').map((d) => d.value)

  it('replaces the strip with the form, over the same block, when the note is in a collection', () => {
    const decos = decorations(makeState(note, { at: 55, host: member() }))
    const form = decos.find((d) => d.value === 'PropertiesFormWidget')
    expect(form?.kind).toBe('block-widget')
    expect(form?.from).toBe(0)
    expect(form?.to).toBe(49)
    const w = form?.widget as PropertiesFormWidget
    expect(w.text).toBe('---\ntitle: A note\ntags: [composition testing]\n---')
    expect(w.editable).toBe(true)
    expect(decos.some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
    // The same hidden range as the strip: the caret still steps over the block.
    expect(hidden(makeState(note, { at: 55, host: member() }))).toEqual([{ from: 0, to: 49 }])
  })

  it('keeps the strip for a note in no collection, and when the host cannot mount a form', () => {
    expect(names(note, { host: testHost({ inCollection: () => false }) })).toEqual(['FrontmatterStripWidget'])
    expect(names(note, { host: testHost({ inCollection: () => true }) })).toEqual(['FrontmatterStripWidget'])
    expect(names(note, { host: testHost() })).toEqual(['FrontmatterStripWidget'])
  })

  it('keeps the strip (and its badge) for a block the patcher cannot write into', () => {
    const nested = '---\nkey:\n  nested: true\n---\n\nbody\n'
    const decos = decorations(makeState(nested, { at: 30, host: member() }))
    const strip = decos.find((d) => d.value === 'FrontmatterStripWidget')
    expect((strip?.widget as FrontmatterStripWidget).supported).toBe(false)
    expect(decos.some((d) => d.value === 'PropertiesFormWidget')).toBe(false)
  })

  it('is the YAML the moment the caret is in the block — every byte reachable (R4.1.1)', () => {
    for (const pos of [0, 5, 20, 46]) {
      const decos = decorations(makeState(note, { at: pos, host: member() }))
      expect(decos.some((d) => d.value === 'PropertiesFormWidget')).toBe(false)
      expect(decos.filter((d) => d.kind === 'line' && d.value === 'cm-live-frontmatter')).toHaveLength(4)
    }
  })

  it('is read-only on its keys in Reading, and plain text in Source', () => {
    const reading = decorations(makeState(note, { at: 0, mode: 'reading', host: member() })).find((d) => d.value === 'PropertiesFormWidget')
    expect((reading?.widget as PropertiesFormWidget).editable).toBe(false)
    expect(names(note, { mode: 'source' })).toEqual([])
  })

  it('is one widget for one block: equal inputs, equal widget', () => {
    const a = decorations(makeState(note, { at: 55, host: member() })).find((d) => d.value === 'PropertiesFormWidget')?.widget as PropertiesFormWidget
    const b = decorations(makeState(note, { at: 60, host: member() })).find((d) => d.value === 'PropertiesFormWidget')?.widget as PropertiesFormWidget
    expect(a.eq(b)).toBe(true)
    const edited = note.replace('A note', 'B note')
    const c = decorations(makeState(edited, { at: 55, host: member() })).find((d) => d.value === 'PropertiesFormWidget')?.widget as PropertiesFormWidget
    expect(a.eq(c)).toBe(false)
  })
})

/**
 * S12: a peer's edit is an ordinary transaction (yCollab dispatches changes the
 * way typing does), so the question is what the engine does when one lands
 * INSIDE a range the local reader cannot see. The answer is that both halves
 * rebuild from the new tree on `docChanged` — nothing is mapped forward, so
 * there is no stale marker to leave behind.
 */
describe('an edit inside a hidden range (Spike S12)', () => {
  const hiddenAt = (state: ReturnType<typeof makeState>): string[] =>
    hidden(state).map((h) => state.doc.sliceString(h.from, h.to))

  it('rebuilds the markers around a peer’s insert inside them', () => {
    const note = 'a **bold** word\n\nthe caret is here\n'
    const state = makeState(note, { at: note.length - 1 })
    expect(hiddenAt(state)).toEqual(['**', '**'])

    // The peer types inside the hidden emphasis: `bold` → `bolder`.
    const grown = state.update({ changes: { from: 8, insert: 'er' } }).state
    expect(hiddenAt(grown)).toEqual(['**', '**'])
    expect(grown.doc.toString()).toContain('**bolder**')

    // …and when the peer's edit BREAKS the construct, the markers that are no
    // longer markers become text again rather than staying hidden.
    const broken = state.update({ changes: { from: 2, to: 4 } }).state
    expect(broken.doc.sliceString(0, 13)).toBe('a bold** word')
    expect(hiddenAt(broken)).toEqual([])
  })

  it('re-reads the frontmatter strip when a peer edits the block', () => {
    const note = '---\ntags: [a]\n---\n\nbody\n'
    const state = makeState(note, { at: note.length })
    const chips = (s: ReturnType<typeof makeState>): readonly string[] =>
      (decorations(s).find((d) => d.value === 'FrontmatterStripWidget')
        ?.widget as FrontmatterStripWidget).tags
    expect(chips(state)).toEqual(['a'])

    // A peer adds a tag inside the collapsed block: the strip is a function of
    // the text, so the chip is there on the next build.
    const added = state.update({ changes: { from: 12, insert: ' b' } }).state
    expect(chips(added)).toEqual(['a', 'b'])

    // A peer breaks the block: no strip, and nothing hidden that a reader
    // cannot get to (R4.1.1 — nothing holds the block together).
    const broken = state.update({ changes: { from: 0, insert: '\n' } }).state
    expect(decorations(broken).some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
  })

  it('keeps typing at a marker’s boundary out of the marker', () => {
    const note = 'a **bold** word\n\nelsewhere\n'
    const state = makeState(note, { at: note.length - 1 })
    // Insert at the two edges of a hidden range. `inclusive: false` is what
    // decides this: the inserted text belongs to the document, not to the
    // decoration, so it is never swallowed by it.
    const before = state.update({ changes: { from: 2, insert: 'X' } }).state
    expect(before.doc.sliceString(0, 16)).toBe('a X**bold** word')
    expect(hidden(before).map((h) => before.doc.sliceString(h.from, h.to))).toEqual(['**', '**'])
    const after = state.update({ changes: { from: 4, insert: 'X' } }).state
    expect(after.doc.sliceString(0, 12)).toBe('a **Xbold** ')
    expect(hidden(after).map((h) => after.doc.sliceString(h.from, h.to))).toEqual(['**', '**'])
  })

  it('leaves nothing hidden when a delete eats into a marker', () => {
    const note = 'a **bold** word\n\nelsewhere\n'
    const state = makeState(note, { at: note.length - 1 })
    // Backspace over the closing pair: what is left is not emphasis, so the
    // opening pair stops being a marker instead of staying invisible.
    const eaten = state.update({ changes: { from: 8, to: 10 } }).state
    expect(eaten.doc.sliceString(0, 13)).toBe('a **bold word')
    expect(hidden(eaten).map((h) => eaten.doc.sliceString(h.from, h.to))).toEqual([])
  })
})

describe('the decoration set itself', () => {
  it('is sorted and non-empty for a real note', () => {
    const { decorations: set } = buildPreview(makeState('# Head\n\n- one\n', { at: 30 }))
    expect(set.size).toBeGreaterThan(0)
  })
})
