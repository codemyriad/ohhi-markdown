/**
 * The formatting commands (quiet-shell F4, foundations Stage 3): pure CM6
 * `Command`s over the markdown the editor already parses. The toolbar, the
 * palette and the keys are all views of `FORMAT_COMMANDS`; nothing here knows
 * about any of them.
 *
 * Every command is ONE transaction (`changeByRange`), so one undo step takes
 * it back, and every command is plain text in, plain text out — the peer sees
 * an ordinary edit and `git diff` shows the asterisks. Never a reserialize:
 * only the markers a command adds or removes change.
 *
 * Rules shared by all of them:
 * - a read-only view (Reading) answers false, so the key falls through;
 * - a range inside a fenced or indented code block (or the frontmatter) is
 *   left alone, and a command that changed nothing answers false;
 * - each selection range is handled on its own (multi-cursor).
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type Text,
} from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'

type Tree = ReturnType<typeof syntaxTree>
type Node = ReturnType<Tree['resolveInner']>

/** Nodes whose text is literal: no command may add markup inside them. */
const LITERAL = new Set(['FencedCode', 'CodeBlock', 'Frontmatter'])

/** How long a command may spend finishing the parse around its ranges. */
const PARSE_BUDGET_MS = 50

function treeOf(state: EditorState, upto: number): Tree {
  return ensureSyntaxTree(state, upto, PARSE_BUDGET_MS) ?? syntaxTree(state)
}

/** True when [from, to] touches a literal block (inclusive at both ends). */
function inLiteral(tree: Tree, from: number, to: number): boolean {
  let hit = false
  tree.iterate({
    from,
    to,
    enter(node) {
      if (hit) return false
      if (LITERAL.has(node.name) && node.from <= to && node.to >= from) hit = true
      return !hit
    },
  })
  return hit
}

/**
 * Run `fn` per selection range in one transaction. `fn` answers the changes
 * (in start-document coordinates) and the new range (in the coordinates after
 * ITS changes), or null to leave the range alone. False when nothing changed.
 */
function perRange(
  view: EditorView,
  fn: (
    range: SelectionRange,
    state: EditorState,
    tree: Tree
  ) => { changes: ChangeSpec[]; range: SelectionRange } | null,
  userEvent = 'input.format'
): boolean {
  const { state } = view
  if (state.readOnly) return false
  const tree = treeOf(state, Math.min(state.doc.length, state.selection.ranges.at(-1)!.to + 1))
  let changed = false
  const spec = state.changeByRange((range) => {
    const out = fn(range, state, tree)
    if (!out || out.changes.length === 0) return { range }
    changed = true
    return out
  })
  if (!changed) return false
  view.dispatch(state.update(spec, { scrollIntoView: true, userEvent }))
  return true
}

// ---------------------------------------------------------------------------
// Inline toggles
// ---------------------------------------------------------------------------

interface InlineSpec {
  /** The marker written when wrapping. */
  mark: string
  /** The syntax node the marker makes. */
  node: string
  /** The node name of its marks, when the grammar names them. */
  markNode: string
}

const STRONG: InlineSpec = { mark: '**', node: 'StrongEmphasis', markNode: 'EmphasisMark' }
const EMPHASIS: InlineSpec = { mark: '*', node: 'Emphasis', markNode: 'EmphasisMark' }
const STRIKE: InlineSpec = { mark: '~~', node: 'Strikethrough', markNode: 'StrikethroughMark' }
const CODE: InlineSpec = { mark: '`', node: 'InlineCode', markNode: 'CodeMark' }

/**
 * Where the content of a line starts: past any quote markers, indent, list
 * marker and task box, and a heading's hashes. Inline markup goes after it —
 * `**- item**` is not bold, `- **item**` is.
 */
const LINE_LEAD =
  /^(?:[ \t]{0,3}>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[[ xX]\](?:[ \t]+|$))?)?(?:#{1,6}(?:[ \t]+|$))?/

/** The nearest ancestor-or-self of `spec.node` that contains [from, to]. */
function enclosing(tree: Tree, spec: InlineSpec, from: number, to: number): Node | null {
  for (const side of [1, -1] as const) {
    let node: Node | null = tree.resolveInner(from, side)
    for (; node; node = node.parent) {
      if (node.name === spec.node && node.from <= from && node.to >= to) return node
    }
  }
  return null
}

/** The opening and closing marker spans of a node, from its mark children. */
function markSpans(node: Node, spec: InlineSpec): [number, number, number, number] {
  const first = node.firstChild
  const last = node.lastChild
  const open =
    first && first.name === spec.markNode && first.from === node.from
      ? first.to
      : node.from + spec.mark.length
  const close =
    last && last.name === spec.markNode && last.to === node.to && last.from >= open
      ? last.from
      : node.to - spec.mark.length
  return [node.from, open, close, node.to]
}

/** The whole run of `ch` starting at `pos` going `dir`. */
function runLength(doc: Text, pos: number, ch: string, dir: 1 | -1): number {
  let n = 0
  for (let p = pos; dir > 0 ? p < doc.length : p > 0; p += dir) {
    const c = doc.sliceString(dir > 0 ? p : p - 1, dir > 0 ? p + 1 : p)
    if (c !== ch) break
    n++
  }
  return n
}

/**
 * The text fallback when the tree has no node (`** x **` is not emphasis to
 * CommonMark, but it is what a toggle-off should still remove): the marker
 * exactly — not a longer run of the same character — on both sides of the
 * segment, outside it or as its own first and last characters.
 */
function textWrapped(
  doc: Text,
  spec: InlineSpec,
  from: number,
  to: number
): [number, number, number, number] | null {
  const m = spec.mark
  const ch = m[0]
  const n = m.length
  if (runLength(doc, from, ch, -1) === n && runLength(doc, to, ch, 1) === n) {
    return [from - n, from, to, to + n]
  }
  if (
    to - from >= 2 * n + 1 &&
    runLength(doc, from, ch, 1) === n &&
    runLength(doc, to, ch, -1) === n
  ) {
    return [from, from + n, to - n, to]
  }
  return null
}

/** The segments of a range an inline toggle acts on: one per touched line. */
function segments(state: EditorState, range: SelectionRange): { from: number; to: number }[] {
  const { doc } = state
  if (range.empty) {
    const word = state.wordAt(range.head)
    return [word ? { from: word.from, to: word.to } : { from: range.head, to: range.head }]
  }
  const first = doc.lineAt(range.from)
  const last = doc.lineAt(range.to)
  if (first.number === last.number) {
    // Trim, so the marker hugs the text: `**word **` is not bold.
    const text = doc.sliceString(range.from, range.to)
    const lead = text.length - text.trimStart().length
    const trail = text.length - text.trimEnd().length
    if (lead === text.length) return []
    return [{ from: range.from + lead, to: range.to - trail }]
  }
  // Across lines (two paragraphs, a list): each line is wrapped on its own,
  // since emphasis cannot cross a block boundary and `**a\n\nb**` renders as
  // literal asterisks.
  const out: { from: number; to: number }[] = []
  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n)
    const lead = LINE_LEAD.exec(line.text)?.[0].length ?? 0
    let from = Math.max(line.from + lead, range.from)
    let to = Math.min(line.to, range.to)
    while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++
    while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--
    if (from < to) out.push({ from, to })
  }
  return out
}

/** The backtick fence that can hold `text` without closing early. */
function codeWrap(text: string): [string, string] {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(longest + 1)
  const pad = longest > 0 && (text.startsWith('`') || text.endsWith('`')) ? ' ' : ''
  return [fence + pad, pad + fence]
}

function toggleInline(spec: InlineSpec): Command {
  return (view) =>
    perRange(view, (range, state, tree) => {
      const { doc } = state
      if (inLiteral(tree, range.from, range.to)) return null
      const segs = segments(state, range)
      if (segs.length === 0) return null

      // Collapsed and nowhere near a word: an empty pair, caret inside.
      if (range.empty && segs[0].from === segs[0].to && !enclosing(tree, spec, range.head, range.head)) {
        const fallback = textWrapped(doc, spec, range.head, range.head)
        if (!fallback) {
          const [open, close] = spec === CODE ? ['`', '`'] : [spec.mark, spec.mark]
          return {
            changes: [{ from: range.head, insert: open + close }],
            range: EditorSelection.cursor(range.head + open.length),
          }
        }
      }

      const wrapped = segs.map((s) => {
        // A caret anywhere in a node (or on a word inside one) unwraps that
        // node; so does a selection inside it, or exactly over it.
        const at = range.empty ? { from: range.head, to: range.head } : s
        const node = enclosing(tree, spec, at.from, at.to)
        if (node) return markSpans(node, spec)
        // The fallback also tries the selection as made, before trimming:
        // `**‹ x ›**` is exactly the case the tree cannot see.
        const untrimmed =
          segs.length === 1 && !range.empty && (s.from !== range.from || s.to !== range.to)
            ? textWrapped(doc, spec, range.from, range.to)
            : null
        return untrimmed ?? textWrapped(doc, spec, s.from, s.to)
      })

      const changes: ChangeSpec[] = []
      if (wrapped.every((w) => w !== null)) {
        const seen = new Set<number>()
        for (const w of wrapped as [number, number, number, number][]) {
          if (seen.has(w[0])) continue
          seen.add(w[0])
          let [outerFrom, innerFrom, innerTo, outerTo] = w
          // A padded code span (`` ` x ` ``) gives back its padding too.
          if (spec === CODE && innerTo - innerFrom > 2) {
            const inner = doc.sliceString(innerFrom, innerTo)
            if (inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
              innerFrom++
              innerTo--
            }
          }
          changes.push({ from: outerFrom, to: innerFrom }, { from: innerTo, to: outerTo })
        }
      } else {
        segs.forEach((s, i) => {
          if (wrapped[i]) return
          const [open, close] =
            spec === CODE ? codeWrap(doc.sliceString(s.from, s.to)) : [spec.mark, spec.mark]
          changes.push({ from: s.from, insert: open }, { from: s.to, insert: close })
        })
      }
      const set = state.changes(changes)
      if (range.empty) {
        // Stay on the word: at its start the caret moves past the new marker.
        const word = segs[0]
        const assoc = range.head === word.from && word.from !== word.to ? 1 : -1
        return { changes, range: EditorSelection.cursor(set.mapPos(range.head, assoc)) }
      }
      // The selection keeps covering the text, never the markers.
      const from = set.mapPos(range.from, 1)
      const to = Math.max(from, set.mapPos(range.to, -1))
      return { changes, range: EditorSelection.range(range.anchor <= range.head ? from : to, range.anchor <= range.head ? to : from) }
    })
}

export const toggleBold: Command = toggleInline(STRONG)
export const toggleItalic: Command = toggleInline(EMPHASIS)
export const toggleStrike: Command = toggleInline(STRIKE)
export const toggleInlineCode: Command = toggleInline(CODE)

// ---------------------------------------------------------------------------
// Line commands
// ---------------------------------------------------------------------------

/**
 * One line, taken apart: quote markers, indent, list marker, task box,
 * heading hashes, then the text. Each part keeps its own spacing so a change
 * to one rewrites only that part.
 */
interface LineParts {
  /** `> > ` — every quote level, with its spacing. */
  quote: string
  indent: string
  /** `- ` / `1. ` with its trailing space; '' when not a list item. */
  list: string
  /** `[ ] ` with its trailing space; '' when no box. */
  task: string
  /** `## ` with its trailing space; '' when not an ATX heading. */
  heading: string
  level: number
}

const PARTS =
  /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$))?((?:\[[ xX]\])(?:[ \t]+|$))?((#{1,6})(?:[ \t]+|$))?/

function parts(text: string): LineParts {
  const m = PARTS.exec(text)!
  const list = m[3] ?? ''
  return {
    quote: m[1],
    indent: m[2],
    list,
    // A box only counts as a task box after a list marker.
    task: list ? (m[4] ?? '') : '',
    heading: !list || m[4] === undefined ? (m[5] ?? '') : '',
    level: (!list || m[4] === undefined) && m[6] ? m[6].length : 0,
  }
}

const isBullet = (p: LineParts): boolean => /^[-*+]/.test(p.list)
const isOrdered = (p: LineParts): boolean => /^\d/.test(p.list)

/**
 * Run a per-line edit over every line a range touches, skipping lines inside
 * literal blocks and lines another range already took (two carets on one line
 * must not add two markers). Blank lines are skipped unless the range is that
 * one line — a list over two paragraphs must not bullet the gap between them
 * — or `blanks` says they matter (a quote has to cover the gap, or it is two
 * quotes).
 */
function lineCommand(
  decide: (lines: { text: string; parts: LineParts }[]) => ((p: LineParts, i: number, text: string) => string | null),
  opts: { blanks?: boolean } = {}
): Command {
  return (view) => {
    const taken = new Set<number>()
    return perRange(view, (range, state, tree) => {
      const { doc } = state
      const first = doc.lineAt(range.from).number
      let last = doc.lineAt(range.to).number
      // A selection that ends at the very start of a line does not take it.
      if (!range.empty && last > first && doc.line(last).from === range.to) last--
      const lines = []
      for (let n = first; n <= last; n++) {
        const line = doc.line(n)
        if (taken.has(n)) continue
        if (inLiteral(tree, line.from, line.to)) continue
        const blank = line.text.trim() === ''
        if (blank && first !== last && !opts.blanks) continue
        taken.add(n)
        lines.push({ line, text: line.text, parts: parts(line.text), blank })
      }
      if (lines.length === 0) return null
      const nonBlank = lines.filter((l) => !l.blank)
      const rewrite = decide(nonBlank.length > 0 ? nonBlank : lines)
      const changes: ChangeSpec[] = []
      let i = 0
      for (const l of lines) {
        const next = rewrite(l.parts, l.blank && nonBlank.length > 0 ? -1 : i++, l.text)
        if (next === null || next === l.text) continue
        // Rewrite only the prefix that changed: the shared tail stays
        // untouched bytes, and a remote cursor in it stays put.
        let keep = 0
        while (
          keep < next.length &&
          keep < l.text.length &&
          next[next.length - 1 - keep] === l.text[l.text.length - 1 - keep]
        )
          keep++
        let lead = 0
        while (lead < next.length - keep && lead < l.text.length - keep && next[lead] === l.text[lead]) lead++
        changes.push({
          from: l.line.from + lead,
          to: l.line.from + l.text.length - keep,
          insert: next.slice(lead, next.length - keep),
        })
      }
      if (changes.length === 0) return null
      const set = state.changes(changes)
      return {
        changes,
        range: range.empty
          ? EditorSelection.cursor(set.mapPos(range.head, 1))
          : EditorSelection.range(set.mapPos(range.anchor, range.anchor <= range.head ? -1 : 1), set.mapPos(range.head, range.anchor <= range.head ? 1 : -1)),
      }
    })
  }
}

/** The line rebuilt from its parts, with `body` as everything after them. */
function rebuild(p: LineParts, text: string, over: Partial<LineParts>): string {
  const q = { ...p, ...over }
  const body = text.slice(p.quote.length + p.indent.length + p.list.length + p.task.length + p.heading.length)
  return q.quote + q.indent + q.list + q.task + q.heading + body
}

type ListKind = 'bullet' | 'ordered' | 'task'

function hasList(p: LineParts, kind: ListKind): boolean {
  if (kind === 'task') return p.list !== '' && p.task !== ''
  return p.task === '' && (kind === 'bullet' ? isBullet(p) : isOrdered(p))
}

function toggleList(kind: ListKind): Command {
  return lineCommand((lines) => {
    const off = lines.every((l) => hasList(l.parts, kind))
    return (p, i, text) => {
      if (i < 0) return null
      if (off) return rebuild(p, text, { list: '', task: '' })
      if (hasList(p, kind)) return null
      switch (kind) {
        case 'bullet':
          return rebuild(p, text, { list: '- ', task: '' })
        case 'ordered':
          return rebuild(p, text, { list: `${i + 1}. `, task: '' })
        case 'task':
          // An existing marker is kept, so an ordered list stays numbered.
          return rebuild(p, text, { list: p.list ? p.list.replace(/[ \t]*$/, ' ') : '- ', task: '[ ] ' })
      }
    }
  })
}

export const toggleBulletList: Command = toggleList('bullet')
export const toggleOrderedList: Command = toggleList('ordered')
export const toggleTaskList: Command = toggleList('task')

/** `> ` on every selected line, or the outermost level off when all have one. */
export const toggleQuote: Command = lineCommand(
  (lines) => {
    const off = lines.every((l) => l.parts.quote !== '')
    return (p, _i, text) => {
      if (off) return text.replace(/^[ \t]{0,3}>[ \t]?/, '')
      if (p.quote !== '' && text.trim() !== '') return null
      // An empty line in the middle gets a bare `>`, so the quote is one block.
      return text.trim() === '' ? '>' : `> ${text}`
    }
  },
  { blanks: true }
)

function headingTo(p: LineParts, text: string, level: number): string {
  return rebuild(p, text, { heading: level > 0 ? `${'#'.repeat(level)} ` : '' })
}

/** Set every selected line to heading `level` (0 = paragraph). */
export function setHeading(level: number): Command {
  const n = Math.max(0, Math.min(6, Math.trunc(level)))
  return lineCommand(() => (p, _i, text) => (p.level === n ? null : headingTo(p, text, n)))
}

/**
 * Heading `level` as a toggle — what a toolbar's H1/H2/H3 does: on, or back
 * to a paragraph when every selected line is already that level.
 */
export function toggleHeading(level: number): Command {
  const n = Math.max(1, Math.min(6, Math.trunc(level)))
  return lineCommand((lines) => {
    const off = lines.every((l) => l.parts.level === n)
    return (p, _i, text) => headingTo(p, text, off ? 0 : n)
  })
}

/**
 * Paragraph → H1 → … → H6 → paragraph. The FIRST line decides the next level
 * and every selected line takes it, so a mixed selection ends up uniform.
 */
export const cycleHeading: Command = lineCommand((lines) => {
  const next = (lines[0].parts.level + 1) % 7
  return (p, _i, text) => headingTo(p, text, next)
})

// ---------------------------------------------------------------------------
// Inserts
// ---------------------------------------------------------------------------

const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i

/**
 * `[text](url)`, the selection as the text and `url` selected to type over.
 * A selection that is itself a URL goes in the parentheses instead, with the
 * caret in the empty brackets.
 */
export const insertLink: Command = (view) =>
  perRange(view, (range, state, tree) => {
    if (inLiteral(tree, range.from, range.to)) return null
    const sel = state.doc.sliceString(range.from, range.to)
    if (URL_LIKE.test(sel.trim())) {
      return {
        changes: [{ from: range.from, to: range.to, insert: `[](${sel.trim()})` }],
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    const urlAt = range.from + 1 + sel.length + 2
    return {
      changes: [{ from: range.from, to: range.to, insert: `[${sel}](url)` }],
      range: EditorSelection.range(urlAt, urlAt + 3),
    }
  })

/** `![alt](url)`, the selection as the alt text and `url` selected. */
export const insertImage: Command = (view) =>
  perRange(view, (range, state, tree) => {
    if (inLiteral(tree, range.from, range.to)) return null
    const sel = state.doc.sliceString(range.from, range.to)
    const urlAt = range.from + 2 + sel.length + 2
    return {
      changes: [{ from: range.from, to: range.to, insert: `![${sel}](url)` }],
      range: EditorSelection.range(urlAt, urlAt + 3),
    }
  })

/**
 * `[[…]]` around the selection (or empty), caret before the `]]`. Dispatched
 * as typing, so the wikilink completion source opens exactly as if `[[` had
 * been typed by hand.
 */
export const insertWikilink: Command = (view) =>
  perRange(
    view,
    (range, state, tree) => {
      if (inLiteral(tree, range.from, range.to)) return null
      const sel = state.doc.sliceString(range.from, range.to)
      return {
        changes: [{ from: range.from, to: range.to, insert: `[[${sel}]]` }],
        range: EditorSelection.cursor(range.from + 2 + sel.length),
      }
    },
    'input.type'
  )

const TABLE = ['|  |  |', '| --- | --- |', '|  |  |', '|  |  |']

/**
 * A 2-column table — header plus two rows — as its own block: after the
 * current line when it has text, with blank lines around it so neither the
 * paragraph above nor the one below is read into it. Caret in the first
 * header cell.
 */
export const insertTable: Command = (view) =>
  perRange(view, (range, state, tree) => {
    if (inLiteral(tree, range.from, range.to)) return null
    const { doc } = state
    const line = doc.lineAt(range.to)
    const blank = line.text.trim() === ''
    const at = blank ? line.from : line.to
    const before = blank ? (line.number > 1 && doc.line(line.number - 1).text.trim() !== '' ? '\n' : '') : '\n\n'
    const nextLine = blank ? line : line.number < doc.lines ? doc.line(line.number + 1) : null
    const needsAfter = blank
      ? line.number < doc.lines && doc.line(line.number + 1).text.trim() !== ''
      : nextLine !== null && nextLine.text.trim() !== ''
    const body = TABLE.join('\n')
    const insert = before + body + (needsAfter ? '\n' : '')
    return {
      changes: [{ from: at, to: blank ? line.to : at, insert }],
      range: EditorSelection.cursor(at + before.length + 2),
    }
  })

// ---------------------------------------------------------------------------
// The table every surface reads
// ---------------------------------------------------------------------------

export type FormatCommandId =
  | 'format.bold'
  | 'format.italic'
  | 'format.strike'
  | 'format.code'
  | 'format.heading-1'
  | 'format.heading-2'
  | 'format.heading-3'
  | 'format.paragraph'
  | 'format.list'
  | 'format.ordered-list'
  | 'format.task'
  | 'format.quote'
  | 'format.link'
  | 'format.wikilink'
  | 'format.table'
  | 'format.image'

export interface FormatCommand {
  id: FormatCommandId
  run: Command
  /**
   * Default binding in the shell registry's `Mod+Shift+K` form — Obsidian's
   * own defaults where it has one, unbound otherwise.
   */
  keys?: string
}

/** Ordered as a toolbar reads them: inline, block, insert. */
export const FORMAT_COMMANDS: readonly FormatCommand[] = [
  { id: 'format.bold', run: toggleBold, keys: 'Mod+b' },
  { id: 'format.italic', run: toggleItalic, keys: 'Mod+i' },
  { id: 'format.strike', run: toggleStrike },
  { id: 'format.code', run: toggleInlineCode },
  { id: 'format.heading-1', run: toggleHeading(1) },
  { id: 'format.heading-2', run: toggleHeading(2) },
  { id: 'format.heading-3', run: toggleHeading(3) },
  { id: 'format.paragraph', run: setHeading(0) },
  { id: 'format.list', run: toggleBulletList },
  { id: 'format.ordered-list', run: toggleOrderedList },
  { id: 'format.task', run: toggleTaskList },
  { id: 'format.quote', run: toggleQuote },
  { id: 'format.link', run: insertLink, keys: 'Mod+k' },
  { id: 'format.wikilink', run: insertWikilink },
  { id: 'format.table', run: insertTable },
  { id: 'format.image', run: insertImage },
]

/** Run a format command by id on a view; false when it did nothing. */
export function runFormat(view: EditorView, id: FormatCommandId): boolean {
  return FORMAT_COMMANDS.find((c) => c.id === id)?.run(view) ?? false
}

/**
 * The editor's rebindable keys: the format table plus `edit.toggle-checkbox`
 * (CM6's own `Mod-l`) and the list indent pair (`Tab` / `Shift+Tab` on a list
 * line — editor-only: a shell-registry Tab would capture focus navigation). A host's resolved keymap names them by these ids.
 */
export type EditorKeyId = FormatCommandId | 'edit.toggle-checkbox' | 'edit.indent-list' | 'edit.outdent-list'

/**
 * The bindings a host resolved for the editor's keys (quiet-shell F10): id →
 * chords in the shell registry's `Mod+Shift+K` form. An id that is absent keeps
 * its default (`FormatCommand.keys`); `[]` unbinds it, so a keymap file that
 * clears `format.bold` takes `Mod-b` out of the editor too, not only out of
 * the shell's capture-phase handler.
 */
export type FormatBindings = Partial<Record<EditorKeyId, readonly string[]>>

const IS_MAC = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? '')
const ARROWS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown'])

/**
 * `Mod+Shift+K` → CM6's `Mod-Shift-k`; `Mod+-` → `Mod--`. Null for an empty chord.
 *
 * Off a Mac, `Ctrl+Mod+X` is pressed as Ctrl+Alt+X (`Alt+X` on the arrows) —
 * the shell registry's `offMacChord` rule (`apps/web/src/lib/commands.ts`),
 * restated here because this package stands alone. Handing CM6 `Ctrl-Mod-x`
 * would fold to plain `Ctrl-x` and bind a different key than the shell does.
 */
export function cmKey(binding: string, mac = IS_MAC): string | null {
  const parts = binding.split('+').map((p) => p.trim())
  // `Mod++`: the key itself is a plus sign.
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(-2, 2, '+')
  }
  const key = parts.pop()
  if (!key) return null
  let mods = parts.filter(Boolean)
  const has = (m: string): boolean => mods.some((p) => p.toLowerCase() === m)
  if (!mac && has('ctrl') && has('mod')) {
    mods = mods.filter((p) => !['ctrl', 'mod', 'alt'].includes(p.toLowerCase()))
    mods.unshift(...(ARROWS.has(key.toLowerCase()) ? ['Alt'] : ['Ctrl', 'Alt']))
  }
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('-')
}

/** One rebindable editor key: its id, what it runs, its default chord. */
export interface EditorKey {
  id: EditorKeyId
  run: Command
  keys?: string
}

/**
 * Bound keys as a CM6 key table (`Mod+b` → `Mod-b`): each key's default,
 * with the host's resolved `bindings` over it (`[]` = no key at all).
 */
export function editorKeymap(
  keys: readonly EditorKey[],
  bindings: FormatBindings = {},
  mac = IS_MAC
): { key: string; run: Command }[] {
  const out: { key: string; run: Command }[] = []
  for (const c of keys) {
    const chords = Object.hasOwn(bindings, c.id) ? (bindings[c.id] ?? []) : c.keys ? [c.keys] : []
    for (const chord of chords) {
      const key = cmKey(chord, mac)
      if (key) out.push({ key, run: c.run })
    }
  }
  return out
}

/** The format commands as a CM6 key table, with the host's resolved `bindings` over the defaults. */
export function formatKeymap(bindings: FormatBindings = {}, mac = IS_MAC): { key: string; run: Command }[] {
  return editorKeymap(FORMAT_COMMANDS, bindings, mac)
}
