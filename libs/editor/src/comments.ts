/**
 * Comment threads on the editing surface (writing-harness-shaping B8): a
 * mark over each anchored passage (`ed-comment`, `ed-comment-resolved`), a
 * gutter marker on the line a thread starts, and one *active* thread drawn
 * stronger while its bubble is open.
 *
 * The host owns the records and resolves their anchors (`@ohhi/workspace`'s
 * `ThreadStore`); this module only draws what it is handed — `setThreads`
 * with `{id, from, to, resolved}` ranges, re-sent whenever the records
 * change. Between two sends the ranges are mapped through every edit, so a
 * passage under the caret keeps its highlight while you type.
 *
 * Colours are the two band-B tokens `--ed-comment-bg` and
 * `--ed-comment-resolved-bg` (libs/ui, docs/theming.md), read through
 * `var()` — never a literal in a CM6 theme object.
 */
import { Compartment, EditorState, Facet, RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view'

/** One thread's passage, as the host resolved it. */
export interface CommentRange {
  id: string
  from: number
  to: number
  resolved: boolean
}

/** What a gutter marker asks of the host. */
export interface CommentsHost {
  /** Open the thread's bubble, hung off the marker's element. */
  open(threadId: string, anchor: HTMLElement): void
  /** The gutter marker's accessible name for a thread. */
  label(range: CommentRange): string
}

/** Replace the drawn threads (clamped to the document). */
export const setThreads = StateEffect.define<CommentRange[]>()
/** Draw one thread as active (its bubble is open), or none. */
export const setActiveThread = StateEffect.define<string | null>()

interface CommentsState {
  ranges: CommentRange[]
  active: string | null
  marks: DecorationSet
}

function clamp(ranges: readonly CommentRange[], length: number): CommentRange[] {
  return ranges
    .map((r) => {
      const from = Math.max(0, Math.min(r.from, length))
      return { ...r, from, to: Math.max(from, Math.min(r.to, length)) }
    })
    .sort((a, b) => a.from - b.from || a.to - b.to)
}

function marksFor(ranges: readonly CommentRange[], active: string | null): DecorationSet {
  const marks: Range<Decoration>[] = []
  for (const r of ranges) {
    if (r.to <= r.from) continue // a point comment has a gutter marker, no mark
    const cls = `${r.resolved ? 'ed-comment-resolved' : 'ed-comment'}${r.id === active ? ' ed-comment-active' : ''}`
    marks.push(Decoration.mark({ class: cls, attributes: { 'data-thread': r.id } }).range(r.from, r.to))
  }
  return Decoration.set(marks, true)
}

export const commentsField = StateField.define<CommentsState>({
  create: () => ({ ranges: [], active: null, marks: Decoration.none }),
  update(value, tr) {
    let { ranges, active } = value
    let rebuilt = false
    if (tr.docChanged && ranges.length > 0) {
      // Follow the edit until the host re-sends: start sticks right of an
      // insert at it, end left — an insert at either edge lands outside, as
      // the live anchors do (`anchors.ts`).
      ranges = ranges.map((r) => {
        const from = tr.changes.mapPos(r.from, 1)
        return { ...r, from, to: Math.max(from, tr.changes.mapPos(r.to, -1)) }
      })
      rebuilt = true
    }
    for (const e of tr.effects) {
      if (e.is(setThreads)) {
        ranges = clamp(e.value, tr.newDoc.length)
        rebuilt = true
      } else if (e.is(setActiveThread)) {
        active = e.value
        rebuilt = true
      }
    }
    return rebuilt ? { ranges, active, marks: marksFor(ranges, active) } : value
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.marks),
})

/** The drawn ranges, in document order. */
export function commentRanges(state: EditorState): readonly CommentRange[] {
  return state.field(commentsField, false)?.ranges ?? []
}

/** The active thread's id, or null. */
export function activeThread(state: EditorState): string | null {
  return state.field(commentsField, false)?.active ?? null
}

/** The open thread (or, failing one, any) whose passage covers `pos`. */
export function threadAt(state: EditorState, pos: number): CommentRange | null {
  const hits = commentRanges(state).filter((r) => r.from <= pos && pos <= r.to)
  return hits.find((r) => !r.resolved) ?? hits[0] ?? null
}

class ThreadMarker extends GutterMarker {
  constructor(
    readonly ranges: CommentRange[],
    readonly host: CommentsHost | null
  ) {
    super()
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof ThreadMarker &&
      other.ranges.length === this.ranges.length &&
      other.ranges.every((r, i) => r.id === this.ranges[i].id && r.resolved === this.ranges[i].resolved)
    )
  }

  override toDOM(): Node {
    const first = this.ranges[0]
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `ed-comment-marker${this.ranges.every((r) => r.resolved) ? ' ed-comment-marker-resolved' : ''}`
    button.dataset.testid = `comment-marker:${first.id}`
    button.setAttribute('aria-label', this.host?.label(first) ?? first.id)
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', (e) => {
      e.preventDefault()
      this.host?.open(first.id, button)
    })
    return button
  }
}

function markersOf(state: EditorState, host: CommentsHost | null): RangeSet<GutterMarker> {
  const byLine = new Map<number, CommentRange[]>()
  for (const r of commentRanges(state)) {
    const line = state.doc.lineAt(r.from).from
    const list = byLine.get(line) ?? []
    list.push(r)
    byLine.set(line, list)
  }
  return RangeSet.of(
    [...byLine].map(([line, list]) => new ThreadMarker(list, host).range(line)),
    true
  )
}

const commentsTheme = EditorView.baseTheme({
  '.ed-comment': { backgroundColor: 'var(--ed-comment-bg)', borderRadius: '2px' },
  '.ed-comment-resolved': { backgroundColor: 'var(--ed-comment-resolved-bg)', borderRadius: '2px' },
  '.ed-comment-active': { boxShadow: 'inset 0 -2px 0 var(--ed-caret)' },
  '.ed-comment-gutter': { width: '14px' },
  '.ed-comment-marker': {
    display: 'block',
    width: '8px',
    height: '8px',
    margin: '0.55em 3px 0',
    padding: '0',
    border: 'none',
    borderRadius: '50%',
    backgroundColor: 'var(--ed-caret)',
    cursor: 'pointer',
  },
  '.ed-comment-marker-resolved': { backgroundColor: 'var(--ed-gutter-fg)' },
})

/**
 * The extension: the field, the marks, the gutter and the theme. Install it
 * once per view (a stable value in the host's extension array); feed it with
 * `setThreads` / `setActiveThread`.
 *
 * The gutter exists only while the note has threads: an empty gutter would
 * still add a `.cm-gutters` column and shift every line of a note with no
 * comments. A `setThreads` that crosses between none and some reconfigures it
 * in the same transaction (a transaction extender — never a second dispatch).
 */
/** Set while the comment gutter is installed (what `hasCommentGutter` reads). */
const gutterShown = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })

/** Is the comment gutter installed (the note has threads)? */
export const hasCommentGutter = (state: EditorState): boolean => state.facet(gutterShown)

export function commentsExtension(host: CommentsHost | null = null): Extension {
  const slot = new Compartment()
  const shown = [
    gutterShown.of(true),
    gutter({
      class: 'ed-comment-gutter',
      markers: (view) => markersOf(view.state, host),
    }),
  ]
  return [
    commentsField,
    slot.of([]),
    EditorState.transactionExtender.of((tr) => {
      let next: CommentRange[] | null = null
      for (const e of tr.effects) if (e.is(setThreads)) next = e.value
      if (next === null) return null
      const had = (tr.startState.field(commentsField, false)?.ranges.length ?? 0) > 0
      const has = next.length > 0
      return had === has ? null : { effects: slot.reconfigure(has ? shown : []) }
    }),
    commentsTheme,
  ]
}
