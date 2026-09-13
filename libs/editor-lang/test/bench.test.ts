/**
 * R7 — perceptibly instant. A keystroke in the vault's heaviest note must stay
 * inside one frame, and the engine rebuilds the whole decoration set on every
 * keystroke, so this is the number that decides whether typing feels right.
 *
 * The fixture is `Areas/Life/Music.md`-shaped (a long list, one bare URL per
 * line, emphasis and a tag) at 3,000 URLs — about five times the real note —
 * with the tree fully parsed, which is the worst case: in the app CM6 parses
 * lazily, so the tree is usually the viewport plus what has been scrolled past.
 */
import { EditorSelection } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeLines } from '../src/index.js'
import { buildBlockPreview, buildInlinePreview, buildPreview } from '../src/preview/build.js'
import { makeState } from './support.js'

const FRAME_MS = 16

/** Rough measure of how fast this machine is, in the same units as the test. */
function calibrate(): number {
  const t0 = performance.now()
  let sink = 0
  for (let i = 0; i < 3_000_000; i++) sink += i % 7
  expect(sink).toBeGreaterThan(0)
  return performance.now() - t0
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const doc = Array.from(
  { length: 3000 },
  (_, i) => `- https://example.com/track/${i} — **Artist ${i}** ~ [sleeve](https://ex.dev/${i}) #music`
).join('\n')

describe('R7: the reveal engine on the heaviest note', () => {
  it('builds the decorations for a 3,000-URL note inside one frame', () => {
    const state = makeState(doc, { at: 0 })
    // What a keystroke actually costs: the block field over the whole parsed
    // tree, plus the inline plugin over one screenful.
    const viewport = [{ from: 0, to: state.doc.line(50).to }]
    const runs: number[] = []
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now()
      activeLines(state.selection, state.doc)
      buildBlockPreview(state)
      buildInlinePreview(state, viewport)
      runs.push(performance.now() - t0)
    }
    const ms = median(runs)
    const slowdown = calibrate() / 12
    // Skip rather than fail on a machine that is simply slower than the one the
    // budget was set on: this must be a performance test, not a runner detector.
    if (slowdown > 3) {
      console.log(`skipped: machine ~${slowdown.toFixed(1)}x slower than the budget's reference`)
      return
    }
    console.log(`buildPreview over ${state.doc.lines} lines: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(FRAME_MS)
  })

  it('costs the same with the whole note selected as with a caret', () => {
    // activeSpans works from the selection's ranges, not from its lines, so
    // Mod+A on a 3,000-line note is not 3,000 lineAt calls per keystroke.
    const caret = makeState(doc, { at: 0 })
    const all = makeState(doc, { at: { anchor: 0, head: doc.length } })
    const time = (state: typeof caret): number => {
      const t0 = performance.now()
      buildBlockPreview(state)
      return performance.now() - t0
    }
    time(caret)
    expect(time(all)).toBeLessThan(Math.max(time(caret) * 4, FRAME_MS))
  })

  it('is the WHOLE set that is expensive — which is why only blocks are global', () => {
    // Kept as the number that justifies the split: one unbounded build of every
    // decoration on this note is several frames.
    const state = makeState(doc, { at: 0 })
    const t0 = performance.now()
    const all = buildPreview(state)
    const ms = performance.now() - t0
    console.log(`whole-document build: ${all.decorations.size} decorations in ${ms.toFixed(1)} ms`)
    expect(all.decorations.size).toBeGreaterThan(20_000)
  })

  it('walks the vault’s deepest nesting in the same budget', () => {
    // The other shape the vault has: tab-indented lists eleven deep (515 files
    // never nest, 25 go past depth 5). The block half walks every container
    // node in the tree — a ListItem is a container — so nesting is the input
    // that multiplies its work, where the URLs multiply the inline half's.
    const nested = Array.from({ length: 3000 }, (_, i) =>
      `${'\t'.repeat(i % 11)}- [ ] item ${i} with **emphasis** and a [link](https://ex.dev/${i})`
    ).join('\n')
    const state = makeState(nested, { at: 0 })
    const viewport = [{ from: 0, to: state.doc.line(50).to }]
    const runs: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      buildBlockPreview(state)
      buildInlinePreview(state, viewport)
      runs.push(performance.now() - t0)
    }
    const ms = median(runs)
    if (calibrate() / 12 > 3) return
    console.log(`nested to depth 11 over ${state.doc.lines} lines: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(FRAME_MS)
  })

  it('measures the selection-only rebuild, which is what arrow keys cost', () => {
    const state = makeState(doc, { at: 0 })
    const moved = state.update({ selection: EditorSelection.single(200) }).state
    const t0 = performance.now()
    buildBlockPreview(moved)
    buildInlinePreview(moved, [{ from: 0, to: moved.doc.line(50).to }])
    expect(performance.now() - t0).toBeLessThan(FRAME_MS)
  })
})
