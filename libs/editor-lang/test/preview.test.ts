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
import type { CheckboxWidget, EmbedWidget, FenceWidget, FrontmatterStripWidget } from '../src/preview/widgets.js'
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

  it('shows a fence’s own lines when the caret is inside it', () => {
    const decos = decorations(makeState('```rust\nfn main() {}\n```\n', { at: 10 }))
    expect(decos.some((d) => d.value === 'FenceWidget')).toBe(false)
    expect(decos.filter((d) => d.kind === 'line' && d.value === 'cm-live-code')).toHaveLength(3)
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

  it('never collapses a block that is still being typed', () => {
    const half = '---\ntags: [a]\n\n# Body\n'
    const decos = decorations(makeState(half, { at: half.length }))
    expect(decos.some((d) => d.value === 'FrontmatterStripWidget')).toBe(false)
    expect(hidden(makeState(half, { at: half.length }))).toEqual([])
  })
})

describe('the decoration set itself', () => {
  it('is sorted and non-empty for a real note', () => {
    const { decorations: set } = buildPreview(makeState('# Head\n\n- one\n', { at: 30 }))
    expect(set.size).toBeGreaterThan(0)
  })
})
