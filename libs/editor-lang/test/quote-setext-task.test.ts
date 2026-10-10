/**
 * Quotes, setext and tasks at the decoration level (E2): the provisional
 * bullet on a lone `-` setext underline (fork D1), the hanging `> ` on a
 * quote's caret line, and a done task's muted, struck text (fork C1).
 */
import { describe, expect, it } from 'vitest'
import { provisionalBullet, SETEXT_PROVISIONAL } from '../src/preview/setext.js'
import { BulletWidget } from '../src/preview/widgets.js'
import { decorations, hidden, makeState } from './support.js'

describe('provisionalBullet (pure)', () => {
  it('is a lone dash, trailing spaces allowed, with the caret on its line', () => {
    expect(provisionalBullet('-', '', true)).toBe(true)
    expect(provisionalBullet('-', ' ', true)).toBe(true)
    expect(provisionalBullet('-', '  \t', true)).toBe(true)
  })

  it('is a heading with the caret elsewhere, or with more than one dash', () => {
    expect(provisionalBullet('-', '', false)).toBe(false)
    expect(provisionalBullet('--', '', true)).toBe(false)
    expect(provisionalBullet('---', '', true)).toBe(false)
    expect(provisionalBullet('=', '', true)).toBe(false)
  })
})

describe('a lone `-` under a paragraph (fork D1)', () => {
  const plainLines = (doc: string, at: number, mode: 'live' | 'source' | 'reading' = 'live') =>
    decorations(makeState(doc, { at, mode }))
      .filter((d) => d.kind === 'line' && d.value === SETEXT_PROVISIONAL)
      .map((d) => d.from)

  it('keeps the paragraph body-styled and draws a faint bullet while the caret is on the dash', () => {
    const doc = 'text\n-'
    const state = makeState(doc, { at: doc.length })
    const decos = decorations(state)
    expect(plainLines(doc, doc.length)).toEqual([0, 5])
    const bullet = decos.find((d) => d.value === 'BulletWidget')
    expect(bullet).toMatchObject({ from: 5, to: 6, text: '-' })
    expect(bullet?.widget).toMatchObject({ provisional: true, open: false })
    // Atomic, like every drawn marker.
    expect(hidden(state)).toContainEqual({ from: 5, to: 6 })
  })

  it('draws only the dash once its space is typed — the open form, as an empty item', () => {
    const doc = 'text\n- '
    const decos = decorations(makeState(doc, { at: doc.length }))
    const bullet = decos.find((d) => d.value === 'BulletWidget')
    expect(bullet).toMatchObject({ from: 5, to: 6 })
    expect(bullet?.widget).toMatchObject({ provisional: true, open: true })
  })

  it('covers every line of a multi-line paragraph', () => {
    const doc = 'one\ntwo\n-'
    expect(plainLines(doc, doc.length)).toEqual([0, 4, 8])
  })

  it('is the heading it parses as when the caret is off the underline', () => {
    const doc = 'text\n-\n\nafter'
    expect(plainLines(doc, doc.length)).toEqual([])
    expect(plainLines(doc, 2)).toEqual([])
    expect(decorations(makeState(doc, { at: 2 })).some((d) => d.value === 'BulletWidget')).toBe(false)
  })

  it('is a heading with `--` or `---`, caret on it or not', () => {
    for (const doc of ['text\n--', 'text\n---']) {
      expect(plainLines(doc, doc.length), doc).toEqual([])
      expect(decorations(makeState(doc, { at: doc.length })).some((d) => d.value === 'BulletWidget')).toBe(false)
    }
  })

  it('becomes a real bullet the moment the text arrives — same box, not faint', () => {
    const doc = 'text\n- x'
    const decos = decorations(makeState(doc, { at: doc.length }))
    expect(decos.some((d) => d.value === SETEXT_PROVISIONAL)).toBe(false)
    const bullet = decos.find((d) => d.value === 'BulletWidget')
    expect((bullet?.widget as BulletWidget).provisional).toBe(false)
  })

  it('resets the style in Source but draws nothing there; Reading has no caret', () => {
    const doc = 'text\n-'
    expect(plainLines(doc, doc.length, 'source')).toEqual([0, 5])
    expect(decorations(makeState(doc, { at: doc.length, mode: 'source' })).some((d) => d.value === 'BulletWidget')).toBe(false)
    expect(plainLines(doc, doc.length, 'reading')).toEqual([])
  })

  it('works inside a quote', () => {
    const doc = '> q\n> -'
    expect(plainLines(doc, doc.length)).toEqual([0, 4])
  })
})

describe('the revealed `> ` hangs (E2)', () => {
  const hangs = (doc: string, at: number, mode: 'live' | 'source' = 'live') =>
    decorations(makeState(doc, { at, mode }))
      .filter((d) => d.value === 'cm-quote-hang')
      .map((d) => d.text)

  it('marks the marker run on the caret\'s line, and only there', () => {
    const doc = '> one\n> two'
    expect(hangs(doc, 2)).toEqual(['> '])
    expect(hangs(doc, doc.length)).toEqual(['> '])
    // Off the line it is hidden instead, as before.
    expect(hidden(makeState(doc, { at: 2 }))).toContainEqual({ from: 6, to: 8 })
  })

  it('marks a nested run as one, so the markers do not stack', () => {
    expect(hangs('> > deep', 4)).toEqual(['> > '])
  })

  it('leaves a bare `>` line, a quote after a list marker, and Source in the flow', () => {
    expect(hangs('> one\n>', 7)).toEqual([])
    expect(hangs('- > q', 4)).toEqual([])
    expect(hangs('> one', 2, 'source')).toEqual([])
  })
})

describe('a done task (fork C1)', () => {
  const done = (doc: string, at = doc.length, mode: 'live' | 'reading' | 'source' = 'live') =>
    decorations(makeState(doc, { at, mode }))
      .filter((d) => d.value === 'cm-task-done')
      .map((d) => d.text)

  it('marks a checked task\'s text, in Live and Reading', () => {
    const doc = '- [x] shipped\n- [ ] open\n'
    expect(done(doc, 0)).toEqual(['shipped'])
    expect(done(doc, 0, 'reading')).toEqual(['shipped'])
    expect(done('- [X] caps\n', 0)).toEqual(['caps'])
  })

  it('stays marked with the caret in the brackets — it is the task\'s state', () => {
    expect(done('- [x] shipped\n', 3)).toEqual(['shipped'])
  })

  it('marks nothing in Source, on an open task, or on an empty done one', () => {
    expect(done('- [x] shipped\n', 0, 'source')).toEqual([])
    expect(done('- [ ] open\n', 0)).toEqual([])
    expect(done('- [x] \n', 0)).toEqual([])
  })
})
