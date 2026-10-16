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
 * revert the peer (the `harness-in-doc-editing` research note §2). The
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
 *
 * The controls (QA round 1, *Oh hi Suggestion Explorations* D, built as A):
 * an Accept / Reject pair drawn right after a proposal — on the CURRENT one
 * always (the one under the caret, else the next after it, else the first),
 * on any other while the pointer is over it — and a gutter mark per
 * proposal (a dot, numbered when the note holds more than one) that moves
 * the caret to it. The pair is a widget like the proposal: never in the
 * document, never takes the caret. A press puts the caret in the proposal
 * and hands the verb to the host (`decide`), which the app routes through
 * its command registry — so a button, a key and a palette row are one path.
 * Their words are the host's (`labels`); without them nothing is drawn.
 */
import { presentableDiff } from '@codemirror/merge'
import {
  Compartment,
  EditorState,
  Facet,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  WidgetType,
  type Command,
  type DecorationSet,
} from '@codemirror/view'
import { hostPush } from './host-push.js'

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
   * A press on the pair, with the caret already put in the proposal. The
   * app runs its registry command here (`ai.accept-suggestion`), so the
   * button and the key are one path; absent, `accept` / `reject` run.
   */
  decide?(act: 'accept' | 'reject', id: string): void
  /** The controls' words. Absent → no pair and no gutter mark are drawn. */
  labels?(): SuggestionLabels
}

/** What the controls say: the host's strings (the app's dictionary), never this package's. */
export interface SuggestionLabels {
  accept: string
  reject: string
  /** The keys, as the person presses them here ('' when unbound): a hint on the button. */
  acceptKeys: string
  rejectKeys: string
  /** The pair's group name, e.g. "Suggestion by Tighten". */
  pair(s: EditorSuggestion): string
  /** A gutter mark's name, e.g. "Suggestion 2 of 3, by Tighten". */
  marker(s: EditorSuggestion, n: number, total: number): string
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

/**
 * The current suggestion: the one under the caret, else the next one after
 * it, else the first. The one whose pair is always drawn.
 */
export function currentSuggestion(state: EditorState): EditorSuggestion | null {
  const list = suggestionsIn(state)
  const head = state.selection.main.head
  return suggestionAt(state, head) ?? list.find((s) => s.from > head) ?? list[0] ?? null
}

/** The suggestion `dir` steps to from the caret: after (1) or before (-1) it, wrapping round. */
export function suggestionStep(state: EditorState, dir: 1 | -1): EditorSuggestion | null {
  const list = suggestionsIn(state)
  if (list.length === 0) return null
  const head = state.selection.main.head
  const here = suggestionAt(state, head)
  if (here) {
    const i = list.findIndex((s) => s.id === here.id)
    return list[(i + dir + list.length) % list.length] ?? null
  }
  if (dir === 1) return list.find((s) => s.from > head) ?? list[0]
  return [...list].reverse().find((s) => s.to < head) ?? list[list.length - 1]
}

/**
 * Put the caret at a suggestion's start and scroll it to the middle of the
 * view; `focus` also gives the view the keyboard. False when the view draws
 * no such suggestion.
 */
export function revealSuggestion(view: EditorView, id: string, opts: { focus?: boolean } = {}): boolean {
  const s = suggestionsIn(view.state).find((x) => x.id === id)
  if (!s) return false
  view.dispatch({ selection: { anchor: s.from }, effects: EditorView.scrollIntoView(s.from, { y: 'center' }) })
  if (opts.focus) view.focus()
  return true
}

/** Move the caret to the next (1) or previous (-1) suggestion: the one it landed on, or null when there is none. */
export function stepSuggestion(view: EditorView, dir: 1 | -1, opts: { focus?: boolean } = {}): EditorSuggestion | null {
  const to = suggestionStep(view.state, dir)
  return to && revealSuggestion(view, to.id, opts) ? to : null
}

/** The suggestion the pointer is over (its proposal, its struck text or its pair), or null. */
const setHovered = StateEffect.define<string | null>()
const hoverField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHovered)) return e.value
    return value
  },
})

/** The pair after one proposal: two named buttons, each with its key as a hint. */
class PairWidget extends WidgetType {
  constructor(
    readonly s: EditorSuggestion,
    readonly current: boolean,
    readonly labels: SuggestionLabels
  ) {
    super()
  }

  override eq(other: PairWidget): boolean {
    return (
      other.s.id === this.s.id &&
      other.s.status === this.s.status &&
      other.current === this.current &&
      other.labels.accept === this.labels.accept &&
      other.labels.reject === this.labels.reject &&
      other.labels.acceptKeys === this.labels.acceptKeys &&
      other.labels.rejectKeys === this.labels.rejectKeys &&
      other.labels.pair(other.s) === this.labels.pair(this.s)
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span')
    el.className = this.current ? 'ed-suggest-pair ed-suggest-pair-current' : 'ed-suggest-pair'
    el.contentEditable = 'false'
    el.dataset.suggestion = this.s.id
    el.dataset.testid = 'suggestion-pair'
    el.setAttribute('role', 'group')
    el.setAttribute('aria-label', this.labels.pair(this.s))
    // A stale proposal can only be dropped: accepting it would revert what changed.
    if (this.s.status === 'pending') el.append(this.button(view, 'accept'))
    el.append(this.button(view, 'reject'))
    return el
  }

  private button(view: EditorView, act: 'accept' | 'reject'): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `ed-suggest-${act}`
    b.dataset.testid = `suggestion-${act}`
    b.textContent = act === 'accept' ? this.labels.accept : this.labels.reject
    const keys = act === 'accept' ? this.labels.acceptKeys : this.labels.rejectKeys
    if (keys) {
      const kbd = document.createElement('kbd')
      kbd.setAttribute('aria-hidden', 'true')
      kbd.textContent = keys
      b.append(kbd)
    }
    // The press never moves CodeMirror's selection or focus by itself.
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      decideFrom(view, act, this.s.id)
    })
    return b
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/** A press on a pair: the caret into the proposal, then the host's verb. */
function decideFrom(view: EditorView, act: 'accept' | 'reject', id: string): void {
  const host = view.state.facet(hostFacet)
  if (!host || !revealSuggestion(view, id, { focus: true })) return
  if (host.decide) host.decide(act, id)
  else if (act === 'accept') host.accept(id)
  else host.reject(id)
}

/** The pairs: the current proposal's, and the hovered one's. Pure over the state. */
export function pairDecorations(state: EditorState): DecorationSet {
  const labels = state.facet(hostFacet)?.labels?.()
  if (!labels) return Decoration.none
  const current = currentSuggestion(state)
  const hovered = state.field(hoverField, false) ?? null
  const out: Range<Decoration>[] = []
  for (const s of suggestionsIn(state)) {
    const isCurrent = s.id === current?.id
    if (!isCurrent && s.id !== hovered) continue
    out.push(Decoration.widget({ widget: new PairWidget(s, isCurrent, labels), side: 2 }).range(s.to))
  }
  return Decoration.set(out, true)
}

const pairs = EditorView.decorations.compute([suggestionField, hoverField, 'selection', hostFacet], pairDecorations)

/** Hovering a proposal (or its pair) draws its pair; leaving it takes the pair away. */
const hoverHandlers = EditorView.domEventHandlers({
  mouseover(e, view) {
    const hit = (e.target as Element | null)?.closest?.('[data-suggestion]') as HTMLElement | null
    const id = hit?.dataset.suggestion ?? null
    if (id !== view.state.field(hoverField, false)) view.dispatch({ effects: setHovered.of(id) })
    return false
  },
  mouseleave(_e, view) {
    if (view.state.field(hoverField, false)) view.dispatch({ effects: setHovered.of(null) })
    return false
  },
})

/** A proposal's mark in the gutter: a dot, or its number when the note holds more than one. */
class SuggestionMarker extends GutterMarker {
  constructor(
    readonly id: string,
    readonly n: number,
    readonly total: number,
    readonly current: boolean,
    readonly label: string
  ) {
    super()
  }

  override eq(other: GutterMarker): boolean {
    return (
      other instanceof SuggestionMarker &&
      other.id === this.id &&
      other.n === this.n &&
      other.total === this.total &&
      other.current === this.current &&
      other.label === this.label
    )
  }

  override toDOM(view: EditorView): Node {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = this.current ? 'ed-suggest-marker ed-suggest-marker-current' : 'ed-suggest-marker'
    b.dataset.testid = `suggestion-marker:${this.id}`
    b.setAttribute('aria-label', this.label)
    // CodeMirror's gutters are aria-hidden: a pointer's shortcut, out of the
    // tab order. The keyboard steps with ai.next-suggestion / previous.
    b.tabIndex = -1
    b.textContent = this.total > 1 ? String(this.n) : ''
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', (e) => {
      e.preventDefault()
      revealSuggestion(view, this.id, { focus: true })
    })
    return b
  }
}

/** One mark per line, for the first proposal starting on it. Pure over the state. */
export function suggestionMarkers(state: EditorState): RangeSet<GutterMarker> {
  const labels = state.facet(hostFacet)?.labels?.()
  const list = suggestionsIn(state)
  if (!labels || list.length === 0) return RangeSet.empty
  const current = currentSuggestion(state)
  const seen = new Set<number>()
  const out: Range<GutterMarker>[] = []
  list.forEach((s, i) => {
    const line = state.doc.lineAt(s.from).from
    if (seen.has(line)) return
    seen.add(line)
    out.push(new SuggestionMarker(s.id, i + 1, list.length, s.id === current?.id, labels.marker(s, i + 1, list.length)).range(line))
  })
  return RangeSet.of(out, true)
}

/** Set while the suggestion gutter is installed. */
const gutterShown = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) })

/** Is the suggestion gutter installed (the note holds suggestions)? */
export const hasSuggestionGutter = (state: EditorState): boolean => state.facet(gutterShown)

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

/**
 * Keeps the field current: the host's suggestions, pushed a microtask after
 * each change — and once at creation, so a note opened with proposals in it
 * gets its gutter.
 */
const pushPlugin = hostPush((view) => view.state.facet(hostFacet), setSuggestions, { initial: true })

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

/**
 * Suggestions drawn in this view, from `host`: the keys, the pair on the
 * current proposal and the gutter marks.
 *
 * The gutter exists only while the note holds suggestions (an empty one
 * would still shift every line): a push that crosses between none and some
 * reconfigures it in the same transaction — the comments gutter's rule.
 */
export function suggestions(host: SuggestionsHost): Extension {
  const slot = new Compartment()
  const shown = [gutterShown.of(true), gutter({ class: 'ed-suggest-gutter', markers: (view) => suggestionMarkers(view.state) })]
  return [
    hostFacet.of(host),
    suggestionField,
    hoverField,
    pairs,
    hoverHandlers,
    slot.of([]),
    EditorState.transactionExtender.of((tr) => {
      let next: readonly EditorSuggestion[] | null = null
      for (const e of tr.effects) if (e.is(setSuggestions)) next = e.value
      if (next === null) return null
      const had = tr.startState.facet(gutterShown)
      const has = next.length > 0 && !!host.labels
      return had === has ? null : { effects: slot.reconfigure(has ? shown : []) }
    }),
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
