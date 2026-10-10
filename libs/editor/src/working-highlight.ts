/**
 * The agent's working highlight (writing-harness-shaping B10): a soft mark
 * over the ranges an agent says it is on — the `working` field of its
 * awareness state (`@ohhi/workspace`'s `agent-presence.ts`) — so a person
 * watching a shared note sees WHERE the agent is about to write before the
 * suggestion arrives ("the range Claude is on").
 *
 * The caret and name tag are not drawn here: the agent's awareness state is
 * an ordinary peer to y-codemirror.next, which draws them as it draws any
 * person's. This module only shades the ranges it is handed — `setWorking`
 * with `{from, to, name}` (the shell resolves the relative positions against
 * the doc) — and maps them through edits between two sends, like the
 * comment marks (`comments.ts`).
 *
 * The colour is the presence-band token `--ed-agent-working-bg` (libs/ui,
 * docs/theming.md) — presence, never a sync colour.
 */
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view'

/** One range an agent is working on, resolved to offsets in this doc. */
export interface WorkingRange {
  from: number
  to: number
  /** The agent's announced name (`<name> (agent)`), for the mark's title. */
  name: string
}

/** Where the ranges come from: read on every push, re-pushed on `subscribe`'s signal. */
export interface WorkingHost {
  current(): WorkingRange[]
  /** Called whenever the ranges may have changed (an awareness change); returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}

/** Replace the drawn ranges (clamped to the document). */
export const setWorking = StateEffect.define<WorkingRange[]>()

interface WorkingState {
  ranges: WorkingRange[]
  marks: DecorationSet
}

function clamp(ranges: readonly WorkingRange[], length: number): WorkingRange[] {
  return ranges
    .map((r) => {
      const from = Math.max(0, Math.min(Math.min(r.from, r.to), length))
      return { ...r, from, to: Math.max(from, Math.min(Math.max(r.from, r.to), length)) }
    })
    .sort((a, b) => a.from - b.from || a.to - b.to)
}

function marksFor(ranges: readonly WorkingRange[]): DecorationSet {
  const marks: Range<Decoration>[] = []
  for (const r of ranges) {
    if (r.to <= r.from) continue // an insertion point: the agent's caret says it
    marks.push(Decoration.mark({ class: 'ed-agent-working', attributes: { title: r.name, 'data-agent': r.name } }).range(r.from, r.to))
  }
  return Decoration.set(marks, true)
}

export const workingField = StateField.define<WorkingState>({
  create: () => ({ ranges: [], marks: Decoration.none }),
  update(value, tr) {
    let { ranges } = value
    let rebuilt = false
    if (tr.docChanged && ranges.length > 0) {
      ranges = ranges.map((r) => {
        const from = tr.changes.mapPos(r.from, 1)
        return { ...r, from, to: Math.max(from, tr.changes.mapPos(r.to, -1)) }
      })
      rebuilt = true
    }
    for (const e of tr.effects) {
      if (e.is(setWorking)) {
        ranges = clamp(e.value, tr.newDoc.length)
        rebuilt = true
      }
    }
    return rebuilt ? { ranges, marks: marksFor(ranges) } : value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.marks),
})

/** The drawn ranges, in document order. */
export function workingRanges(state: EditorState): readonly WorkingRange[] {
  return state.field(workingField, false)?.ranges ?? []
}

const workingTheme = EditorView.baseTheme({
  '.ed-agent-working': { backgroundColor: 'var(--ed-agent-working-bg)', borderRadius: '2px' },
})

/** Subscribes the view to its host and pushes each change a microtask later (never inside an update). */
function pushPlugin(host: WorkingHost): Extension {
  return ViewPlugin.define((view) => {
    let dead = false
    let queued = false
    const push = (): void => {
      if (queued || dead) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (dead) return
        view.dispatch({ effects: setWorking.of(host.current()) })
      })
    }
    const off = host.subscribe(push)
    push()
    return {
      destroy() {
        dead = true
        off()
      },
    }
  })
}

/**
 * The extension: the field, its marks and the theme — plus, with a `host`,
 * a plugin that keeps the ranges current. Install once per view (a stable
 * value in the host's extension array); without a host, feed it `setWorking`.
 */
export function workingHighlight(host: WorkingHost | null = null): Extension {
  return [workingField, workingTheme, ...(host ? [pushPlugin(host)] : [])]
}
