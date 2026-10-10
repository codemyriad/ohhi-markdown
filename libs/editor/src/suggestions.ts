/**
 * Suggestions in the document, drawn (writing-harness shaping B7, Fork 4-B):
 * an agent's proposed edit shown IN the note as track changes — the text it
 * would replace struck through, the text it proposes inserted beside it —
 * while the document itself stays exactly as it is. Nothing rendered here
 * enters the document: the strike is a mark, the proposal a widget (the
 * `libs/editor-lang/src/preview` rule).
 *
 * Never `unifiedMergeView` over the live doc: its frozen `original` would
 * absorb a peer's edit into "the agent's chunk", and rejecting it would
 * revert the peer (`plans/research/harness-in-doc-editing.md` §2). The
 * records — and the accept/reject that changes the text — belong to the host
 * (`@ohhi/workspace`'s `SuggestionStore`); this module only draws them and
 * routes the keys.
 *
 * Flow: the host hands records RESOLVED to offsets (`current()`), and calls
 * back on every change (`subscribe`); the field maps them through local
 * changes between pushes, so a mark never lags a keystroke. The push is a
 * microtask later, because the host hears of a change from inside the
 * editor's own update (the Y binding writes during it).
 *
 * Long proposals are diffed inside the range (`@codemirror/merge`'s
 * `presentableDiff`, the diff routine only): just the changed words are
 * struck and inserted, not the whole paragraph. Classes `ed-suggest-del` /
 * `ed-suggest-add` / `ed-suggest-stale` are painted from the band-B tokens
 * `--ed-suggest-del` / `-add` / `-stale` (golden rule 7). Everything sits in
 * `suggestionsCompartment`, so a host turns it on and off without a rebuild.
 */
import { presentableDiff } from '@codemirror/merge'
import { Compartment, Facet, Prec, StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** One suggestion as the editor draws it: a record resolved against the text now. */
export interface EditorSuggestion {
  id: string
  from: number
  to: number
  baseText: string
  proposedText: string
  status: 'pending' | 'stale'
  /** Who proposed it (the run's name), for the widget's title. */
  name: string
}

/** What the editor asks of its host. One per view: it knows the view's note. */
export interface SuggestionsHost {
  /** The note's suggestions now, resolved to offsets. */
  current(): readonly EditorSuggestion[]
  /** Called after any change to the note's text or suggestions; returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
  accept(id: string): void
  reject(id: string): void
  /**
   * This view took the focus — the one a shell command (`ai.accept-all`)
   * acts on. Called once at creation with `focused` false, then on each focus.
   */
  focus?(view: EditorView, focused: boolean): void
  /** This view is going away. */
  detach?(view: EditorView): void
}

/** Replace the view's suggestions (the host's push). */
export const setSuggestions = StateEffect.define<readonly EditorSuggestion[]>()

const hostFacet = Facet.define<SuggestionsHost, SuggestionsHost | null>({
  combine: (values) => values[0] ?? null,
})

/** Both edges inside the document, never inside out. */
function clamp(list: readonly EditorSuggestion[], length: number): EditorSuggestion[] {
  return list
    .map((s) => {
      const from = Math.max(0, Math.min(s.from, length))
      return { ...s, from, to: Math.max(from, Math.min(s.to, length)) }
    })
    .sort((a, b) => a.from - b.from)
}

/** The suggestions on screen, mapped through every change until the next push. */
export const suggestionField = StateField.define<readonly EditorSuggestion[]>({
  create: (state) => clamp(state.facet(hostFacet)?.current() ?? [], state.doc.length),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestions)) return clamp(e.value, tr.newDoc.length)
    if (!tr.docChanged || value.length === 0) return value
    return value.map((s) => {
      // The same rule as the anchors (`@ohhi/workspace` anchors.ts): an
      // insert at either edge stays outside, and an insertion point moves
      // with the character after it.
      const from = tr.changes.mapPos(s.from, 1)
      const to = s.from === s.to ? from : Math.max(from, tr.changes.mapPos(s.to, -1))
      return { ...s, from, to }
    })
  },
  provide: (field) => EditorView.decorations.from(field, (list) => buildDecorations(list)),
})

/** Both sides at least this long → diff inside the range rather than strike it whole. */
export const INTRA_DIFF_MIN = 24

/** The proposed text, drawn as an insertion. Never part of the document. */
class ProposedWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly stale: boolean,
    readonly id: string,
    readonly name: string
  ) {
    super()
  }

  override eq(other: ProposedWidget): boolean {
    return other.text === this.text && other.stale === this.stale && other.id === this.id && other.name === this.name
  }

  toDOM(): HTMLElement {
    const el = document.createElement('ins')
    el.className = this.stale ? 'ed-suggest-add ed-suggest-stale' : 'ed-suggest-add'
    el.dataset.suggestion = this.id
    el.title = this.name
    el.textContent = this.text
    return el
  }

  override ignoreEvent(): boolean {
    return false
  }
}

function strike(from: number, to: number, s: EditorSuggestion): Range<Decoration> {
  return Decoration.mark({
    tagName: 'del',
    class: s.status === 'stale' ? 'ed-suggest-del ed-suggest-stale' : 'ed-suggest-del',
    attributes: { 'data-suggestion': s.id, title: s.name },
  }).range(from, to)
}

function insert(at: number, text: string, s: EditorSuggestion): Range<Decoration> {
  return Decoration.widget({ widget: new ProposedWidget(text, s.status === 'stale', s.id, s.name), side: 1 }).range(at)
}

/**
 * The decorations for a list of suggestions: the base struck, the proposal
 * inserted after it — or, for a long pending one, only the changed spans of
 * each. Pure (it builds objects, no DOM), so it is unit-tested in node.
 */
export function buildDecorations(list: readonly EditorSuggestion[]): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const s of list) {
    const long =
      s.status === 'pending' &&
      s.to - s.from === s.baseText.length &&
      s.baseText.length >= INTRA_DIFF_MIN &&
      s.proposedText.length >= INTRA_DIFF_MIN
    if (long) {
      for (const c of presentableDiff(s.baseText, s.proposedText)) {
        if (c.toA > c.fromA) out.push(strike(s.from + c.fromA, s.from + c.toA, s))
        if (c.toB > c.fromB) out.push(insert(s.from + c.toA, s.proposedText.slice(c.fromB, c.toB), s))
      }
      continue
    }
    if (s.to > s.from) out.push(strike(s.from, s.to, s))
    if (s.proposedText) out.push(insert(s.to, s.proposedText, s))
  }
  return Decoration.set(out, true)
}

/** The suggestion under `pos` (edges included), or null. */
export function suggestionAt(state: EditorState, pos: number): EditorSuggestion | null {
  for (const s of state.field(suggestionField, false) ?? []) if (s.from <= pos && pos <= s.to) return s
  return null
}

/** Every suggestion the view is drawing. */
export function suggestionsIn(state: EditorState): readonly EditorSuggestion[] {
  return state.field(suggestionField, false) ?? []
}

function atCaret(act: 'accept' | 'reject'): Command {
  return (view) => {
    const host = view.state.facet(hostFacet)
    const s = suggestionAt(view.state, view.state.selection.main.head)
    if (!host || !s) return false
    if (act === 'accept') host.accept(s.id)
    else host.reject(s.id)
    return true
  }
}

/** `Mod-Enter`: accept the suggestion under the caret (false — the key falls through — when none). */
export const acceptSuggestionAtCaret: Command = atCaret('accept')
/** `Mod-Backspace`: reject the suggestion under the caret (false when none). */
export const rejectSuggestionAtCaret: Command = atCaret('reject')

/** Subscribes the view to its host and pushes each change a microtask later. */
const pushPlugin = ViewPlugin.define((view) => {
  const host = view.state.facet(hostFacet)
  let dead = false
  let queued = false
  const push = (): void => {
    if (queued || dead) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (dead || !host) return
      view.dispatch({ effects: setSuggestions.of(host.current()) })
    })
  }
  const off = host?.subscribe(push) ?? (() => {})
  host?.focus?.(view, false)
  return {
    update(u: ViewUpdate) {
      if (u.focusChanged && u.view.hasFocus) host?.focus?.(u.view, true)
    },
    destroy() {
      dead = true
      off()
      host?.detach?.(view)
    },
  }
})

const suggestionsTheme = EditorView.theme({
  '.ed-suggest-del': {
    color: 'var(--ed-suggest-del)',
    textDecoration: 'line-through',
    textDecorationColor: 'var(--ed-suggest-del)',
  },
  '.ed-suggest-add': {
    color: 'var(--ed-suggest-add)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--ed-suggest-add)',
    textUnderlineOffset: '0.2em',
    whiteSpace: 'pre-wrap',
  },
  '.ed-suggest-stale, .ed-suggest-del.ed-suggest-stale, .ed-suggest-add.ed-suggest-stale': {
    color: 'var(--ed-suggest-stale)',
    textDecorationColor: 'var(--ed-suggest-stale)',
    textDecorationStyle: 'dashed',
  },
})

/** The host's compartment: `suggestionsCompartment.of(suggestions(host))`, reconfigured to `[]` to turn it off. */
export const suggestionsCompartment = new Compartment()

/** Suggestions drawn in this view, from `host`, with the accept/reject keys. */
export function suggestions(host: SuggestionsHost): Extension {
  return [
    hostFacet.of(host),
    suggestionField,
    pushPlugin,
    Prec.high(
      keymap.of([
        { key: 'Mod-Enter', run: acceptSuggestionAtCaret },
        { key: 'Mod-Backspace', run: rejectSuggestionAtCaret },
      ])
    ),
    suggestionsTheme,
  ]
}
