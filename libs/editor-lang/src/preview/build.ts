/**
 * The reveal engine (read-shaping.md B2 and its construct table).
 *
 * A walk over the syntax tree turns markup into decorations:
 *
 * - markers are HIDDEN with `Decoration.replace` when the construct they belong
 *   to does not meet the active region, and are ordinary text when it does;
 * - whole lines that become something else (a rule, a fence's edges, an embed,
 *   the frontmatter strip, a Reading table) are replaced by a block widget;
 * - everything else is a class — styling never hides anything, so it applies in
 *   Source mode too, exactly as Obsidian's Source view styles a heading.
 *
 * The result is collected into two buckets — block decorations and everything
 * else — because CM6 takes them from different places and they have different
 * costs; preview/index.ts explains that split. The RULES live here once, so the
 * two halves cannot disagree about what is rendered.
 *
 * Nothing here enters the document: the Y.Text, the undo manager and
 * `git diff` never see a decoration (R2.2).
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Line, Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet, type WidgetType } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { FM_CLOSE, FM_MAX_LINES, FM_OPEN } from '../frontmatter-block.js'
import {
  FALLBACK_CALLOUT_LABELS,
  FALLBACK_CODE_LABELS,
  previewMode,
  readHost,
  type ReadHost,
  type ViewMode,
} from '../read-host.js'
import { splitWikiLink } from '../wikilink.js'
import { wikiLinkHost } from '../wikilink-view.js'
import { activeSpans, inActiveRegion, markerSelected, type Span } from './active-lines.js'
import * as cls from './classes.js'
import { extractInline } from './inline-dom.js'
import { calloutCollapsed, parseCalloutHeader, type CalloutType } from './callout.js'
import { calloutFolds } from './callout-fold.js'
import { calloutClass, CalloutFoldedWidget, CalloutHeaderWidget } from './callout-widgets.js'
import { FenceWidget } from './code-widgets.js'
import { IMAGE_FILE, imageParts, imageSource, notLoadedTitle, RemoteImageWidget } from './image.js'
import { alignOf, splitRow } from './table-ops.js'
import { provisionalBullet, SETEXT_PROVISIONAL } from './setext.js'
import {
  BulletWidget,
  CheckboxWidget,
  CollectionEmbedWidget,
  EmbedWidget,
  FrontmatterStripWidget,
  PropertiesFormWidget,
  RuleWidget,
  TableWidget,
  type TableRowData,
} from './widgets.js'

export interface PreviewDecorations {
  decorations: DecorationSet
  /**
   * The replaced ranges, and only those — handed to `EditorView.atomicRanges`
   * so the caret can never come to rest inside text it cannot see (R2.2).
   */
  hidden: DecorationSet
}

const HIDE = Decoration.replace({})
const line = (cls: string): Decoration => Decoration.line({ class: cls })
const mark = (cls: string): Decoration => Decoration.mark({ class: cls })

const HEADING_LINE = [1, 2, 3, 4, 5, 6].map((n) => line(`cm-live-h${n}`))
const QUOTE_LINE = line('cm-live-quote')
/** A revealed `> ` run at a line's start, hung left so the text does not move (E2). */
const QUOTE_HANG = mark('cm-quote-hang')
/** A checked task's text: muted and struck (fork C1, `--ed-task-done-*`). */
const TASK_DONE = mark('cm-task-done')
const SETEXT_PLAIN = line(SETEXT_PROVISIONAL)
const CODE_LINE = line('cm-live-code')
/** The code card's top and bottom edges, on a fence line shown as text (E3). */
const CODE_FIRST = line('cm-code-first')
const CODE_LAST = line('cm-code-last')
/** A callout's lines (E3): the box and its type's colour, plus its edges. */
const CALLOUT_LINE = new Map<CalloutType, Decoration>()
const calloutLine = (type: CalloutType): Decoration => {
  let deco = CALLOUT_LINE.get(type)
  if (!deco) CALLOUT_LINE.set(type, (deco = line(calloutClass(type))))
  return deco
}
const CALLOUT_HEAD = line('cm-callout-head cm-callout-first')
const CALLOUT_LAST = line('cm-callout-last')
const FRONTMATTER_LINE = line('cm-live-frontmatter')
const TABLE_HEAD_LINE = line('cm-table-head')
const LIST_NUM = mark('cm-list-num')
/**
 * A list line, by nesting depth (0 = top level). The depth is a custom
 * property the theme turns into both the indent (`--ed-list-indent` per level)
 * and the depth guides — computed from the tree, never from the DOM. Built on
 * first use and kept: the vault nests eleven deep, and a Decoration is reused.
 */
const LIST_LINE: Decoration[] = []
const listLine = (depth: number): Decoration =>
  (LIST_LINE[depth] ??= Decoration.line({
    class: cls.LIST_LINE,
    attributes: { style: `--cm-list-depth: ${depth}` },
  }))
const HTML_MARK = mark('cm-html')
const BLOCK_ID = mark('cm-block-id')
const TABLE_PIPE = mark('cm-table-pipe')
// The names shared with the widget DOM live in classes.ts; these are the
// decoration objects built from them, once, because a Decoration is reused.
const INLINE_CODE = mark(cls.INLINE_CODE)
const MD_LINK = mark(cls.MD_LINK)
const URL_MARK = mark(cls.BARE_URL)
const WIKILINK = mark(cls.WIKILINK)
const WIKILINK_UNRESOLVED = mark(cls.WIKILINK_UNRESOLVED)
const RAW_WIKILINK = mark(cls.RAW_WIKILINK)
const RAW_WIKILINK_UNRESOLVED = mark(cls.RAW_WIKILINK_UNRESOLVED)

const EMPHASIS = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'Highlight'])
const HTML = new Set(['HTMLBlock', 'HTMLTag', 'Comment', 'CommentBlock', 'ProcessingInstruction'])
/** `^abc123` at the end of a block. Dim, never resolved (D8). */
const BLOCK_ID_RE = /(?:^|\s)(\^[A-Za-z0-9-]+)[ \t]*$/
/** A collection file (bases-shaping A6) — `isCollectionPath` in @ohhi/collections. */
const COLLECTION = /\.base$/i

/**
 * Every decoration for the whole document. The one-shot form: what the tests
 * assert against, and the definition the two bounded builds below must add up
 * to (`split is exhaustive` in preview.test.ts).
 */
export function buildPreview(state: EditorState): PreviewDecorations {
  return new Builder(state).run('all')
}

/**
 * The BLOCK decorations only — a rule, a fence's edges, an embed on its own
 * line, the frontmatter strip, a Reading table. These change the editor's
 * vertical layout, so CM6 will only take them from a state field, which cannot
 * know the viewport; the walk is over the whole parsed tree and therefore skips
 * everything that cannot contain one (R7: the inline nodes are the bulk).
 */
export function buildBlockPreview(state: EditorState): PreviewDecorations {
  return new Builder(state, { blocksOnly: true }).run('block')
}

/** Everything else, over the ranges the view can actually show. */
export function buildInlinePreview(
  state: EditorState,
  ranges: readonly { from: number; to: number }[]
): PreviewDecorations {
  return new Builder(state, { ranges }).run('inline')
}

interface BuilderOptions {
  /** Restrict the walk to these ranges (the viewport). Default: the document. */
  ranges?: readonly { from: number; to: number }[]
  /** Visit only what can produce a block decoration. */
  blocksOnly?: boolean
}

/** Containers a block construct can be nested inside. */
const CONTAINERS = new Set([
  'Document',
  'BulletList',
  'OrderedList',
  'ListItem',
  'Blockquote',
])

class Builder {
  private readonly inline: Range<Decoration>[] = []
  private readonly inlineHidden: Range<Decoration>[] = []
  private readonly block: Range<Decoration>[] = []
  private readonly blockHidden: Range<Decoration>[] = []
  /** End of the frontmatter block drawn from the text, when the tree is stale. */
  private skipTo = 0
  /** The range the walk is over right now — list lines are clamped to it. */
  private range: { from: number; to: number } = { from: 0, to: 0 }
  private readonly spans: Span[]
  private readonly mode: ViewMode
  /**
   * May the host-mounted widgets write? Reading turns `EditorView.editable`
   * off (libs/editor's mode extensions) and so does a read-only host: the
   * properties form and an embedded collection then show text, as every
   * other surface in Reading does — the X1 checkbox stays the one exception.
   */
  private readonly editable: boolean
  private readonly host: ReadHost
  private readonly doc: EditorState['doc']

  constructor(
    private readonly state: EditorState,
    private readonly opts: BuilderOptions = {}
  ) {
    this.mode = state.facet(previewMode)
    this.editable = this.mode !== 'reading' && state.facet(EditorView.editable)
    this.host = state.facet(readHost)
    this.doc = state.doc
    // Reading has no caret, so it has no active region: everything renders.
    this.spans = this.mode === 'reading' ? [] : activeSpans(state.selection, state.doc)
  }

  run(scope: 'all' | 'block' | 'inline'): PreviewDecorations {
    const tree = syntaxTree(this.state)
    this.skipTo = this.restoreFrontmatter(tree)
    const enter = (node: SyntaxNodeRef): boolean | void => {
      // Nodes the tree is stale about (see restoreFrontmatter) are not
      // decorated at all: the block above them is drawn from the text.
      if (node.from < this.skipTo && node.to <= this.skipTo) return false
      return this.opts.blocksOnly ? this.enterBlock(node) : this.enter(node)
    }
    if (this.opts.ranges) {
      for (const range of this.opts.ranges) {
        this.range = range
        tree.iterate({ from: range.from, to: range.to, enter })
      }
    } else {
      this.range = { from: 0, to: this.doc.length }
      tree.iterate({ enter })
    }
    const deco = scope === 'block' ? this.block : scope === 'inline' ? this.inline : [...this.block, ...this.inline]
    const hides =
      scope === 'block'
        ? this.blockHidden
        : scope === 'inline'
          ? this.inlineHidden
          : [...this.blockHidden, ...this.inlineHidden]
    return {
      decorations: Decoration.set(deco, true),
      hidden: Decoration.set(hides, true),
    }
  }

  // --- the walk ------------------------------------------------------------

  /**
   * The block-only walk: descend into containers, look at a paragraph only when
   * it holds an embed, and stop at everything else. On the vault's heaviest note
   * that is ~6,000 node visits instead of ~36,000.
   */
  private enterBlock(node: SyntaxNodeRef): boolean | void {
    switch (node.name) {
      case 'Frontmatter':
        return this.frontmatterRange(node.from, node.to)
      case 'HorizontalRule':
        return this.rule(node)
      case 'FencedCode':
        return this.fence(node)
      case 'Table':
        return this.table(node)
      case 'WikiLinkEmbed':
        return this.embed(node)
      case 'Image':
        return this.image(node)
      case 'Paragraph':
      case 'Task':
        // `![` covers both embeds: `![[x.png]]` and `![alt](x.png)` (E5).
        return this.doc.sliceString(node.from, node.to).includes('![') ? undefined : false
      case 'Blockquote':
        // A callout's title row and fold are blocks (E3); its contents may hold more.
        this.callout(node)
        return undefined
      default:
        return CONTAINERS.has(node.name) ? undefined : false
    }
  }

  private enter(node: SyntaxNodeRef): boolean | void {
    const name = node.name
    if (name.startsWith('ATXHeading')) return this.heading(node)
    if (EMPHASIS.has(name)) return this.emphasis(node)
    if (HTML.has(name)) {
      this.mark(node.from, node.to, HTML_MARK)
      return false
    }
    switch (name) {
      case 'Frontmatter':
        return this.frontmatterRange(node.from, node.to)
      case 'HeaderMark':
        return this.headerMark(node)
      case 'SetextHeading2':
        return this.setext(node)
      case 'Blockquote':
        if (this.callout(node)) return undefined
        return this.eachLine(node.from, node.to, (l) => this.line(l, QUOTE_LINE))
      case 'QuoteMark':
        return this.quoteMark(node)
      case 'HorizontalRule':
        return this.rule(node)
      case 'FencedCode':
        return this.fence(node)
      case 'ListItem':
        return this.listItem(node)
      case 'ListMark':
        return this.listMark(node)
      case 'TaskMarker':
        return this.task(node)
      case 'InlineCode':
        return this.inlineCode(node)
      case 'Link':
        return this.link(node)
      case 'URL':
        return this.url(node)
      case 'WikiLink':
        return this.wikiLink(node)
      case 'WikiLinkEmbed':
        return this.embed(node)
      case 'Image':
        return this.image(node)
      case 'Tag':
        return this.tag(node)
      case 'Table':
        return this.table(node)
      case 'TableDelimiter':
        return this.mark(node.from, node.to, TABLE_PIPE)
      case 'TableHeader':
        return this.line(this.doc.lineAt(node.from), TABLE_HEAD_LINE)
      case 'Paragraph':
      case 'Task':
        return this.blockId(node)
      default:
        return undefined
    }
  }

  // --- constructs ----------------------------------------------------------

  private frontmatterRange(from: number, to: number): boolean {
    const info = this.host.frontmatter?.(
      this.doc.sliceString(0, Math.min(to + 1, this.doc.length))
    )
    if (!this.revealed(from, to) && info?.present) {
      const first = this.doc.lineAt(from)
      const last = this.doc.lineAt(to)
      // A row of a collection gets the properties form (Fork 3-B) — when the
      // block is one the patcher can write into; a block outside the flat
      // subset keeps the strip and its badge, because a form over values it
      // cannot write would be a promise the patcher refuses. (A row-note
      // with no block at all reaches neither: there is nothing to add keys
      // from yet, and a form over nothing would have to invent a block.)
      // A change of membership swaps the widget class, so CM6 redraws the
      // element: a cell editor open at that moment loses its draft.
      const form = info.supported && this.host.inCollection?.() === true && !!this.host.mountProperties
      this.replaceBlock(
        first,
        last,
        form
          ? new PropertiesFormWidget(this.doc.sliceString(first.from, last.to), this.editable, this.host)
          : new FrontmatterStripWidget(info.tags, info.entries.length, info.supported, this.host.labels, this.mode !== 'reading')
      )
      return false
    }
    // Caret inside, Source mode, or no reader configured: the YAML itself,
    // fenced so you can see you have crossed into a structured region.
    this.eachLine(from, to, (l) => this.line(l, FRONTMATTER_LINE))
    return false
  }

  /**
   * Draw the frontmatter block the TEXT says is there, when the tree does not.
   *
   * The block parser only ever runs at offset 0, and lezer's incremental parse
   * reuses the fragment that starts at offset 0 after a deletion there — so a
   * block that has just been restored (delete the blank line that broke it,
   * R4.1.1) is still parsed as a rule and a setext heading, for good. The text
   * is the authority on what a note is; when the two disagree it wins, and the
   * stale nodes inside the block are left undecorated rather than drawn as the
   * markdown they are not.
   *
   * Returns the end of the block it drew, or 0 — the common path, where the
   * tree is right, costs one line read.
   */
  private restoreFrontmatter(tree: Tree): number {
    if (!this.host.frontmatter || this.doc.lines < 2) return 0
    if (!FM_OPEN.test(this.doc.line(1).text)) return 0
    const first = tree.resolveInner(0, 1)
    if (first.name === 'Frontmatter' || first.parent?.name === 'Frontmatter') return 0
    // The same bounded scan for the closing delimiter the grammar makes, so a
    // block the parser would refuse is not drawn here either.
    const last = Math.min(this.doc.lines, 1 + FM_MAX_LINES)
    for (let n = 2; n <= last; n++) {
      const line = this.doc.line(n)
      if (!FM_CLOSE.test(line.text)) continue
      this.frontmatterRange(0, line.to)
      return line.to
    }
    return 0
  }

  private heading(node: SyntaxNodeRef): void {
    const level = Number(node.name.slice(-1))
    if (level >= 1 && level <= 6) this.line(this.doc.lineAt(node.from), HEADING_LINE[level - 1])
  }

  private headerMark(node: SyntaxNodeRef): void {
    const parent = node.node.parent
    // A setext heading's underline is also a HeaderMark; the vault has none,
    // and hiding a whole line of `===` would leave an unexplained blank.
    if (!parent || !parent.name.startsWith('ATXHeading')) return
    if (this.revealed(parent.from, parent.to)) return
    this.replace(node.from, this.skipSpace(node.to, parent.to))
  }

  /**
   * Fork D1: a paragraph over a lone `-` the caret is on is a bullet being
   * typed, not a heading (setext.ts). Its lines keep the body style — the
   * line class resets the heading tokens the HighlightStyle reads — and in
   * Live the `-` is drawn as a faint bullet where the real one will sit. With
   * a space typed after the dash only the dash is drawn, as an empty item's
   * is, so the next keystroke (which makes it a real list) does not move it.
   */
  private setext(node: SyntaxNodeRef): void {
    if (this.mode === 'reading') return
    const dash = node.node.getChild('HeaderMark')
    if (!dash) return
    const under = this.doc.lineAt(dash.from)
    const head = this.state.selection.main.head
    const mark = this.doc.sliceString(dash.from, dash.to)
    const rest = this.doc.sliceString(dash.to, under.to)
    if (!provisionalBullet(mark, rest, head >= under.from && head <= under.to)) return
    this.eachLine(node.from, node.to, (l) => this.line(l, SETEXT_PLAIN))
    if (this.mode === 'live') this.replace(dash.from, dash.to, new BulletWidget(under.to > dash.to, true))
  }

  /**
   * Off the caret's line the `> ` is hidden. On it, a revealed run at the
   * line's start is marked to HANG (theme.ts sets it out of the flow, left of
   * the text), so the words do not move. Live only, and only with text after
   * it: a line that is nothing but `>` keeps its height.
   */
  private quoteMark(node: SyntaxNodeRef): void {
    const l = this.doc.lineAt(node.from)
    if (!this.revealed(node.from, node.to)) {
      this.replace(node.from, this.skipSpace(node.to, l.to, 1))
      return
    }
    if (this.mode !== 'live') return
    if (this.doc.sliceString(l.from, node.from).trim() !== '') return
    const run = /^(?:>[ \t]?)+/.exec(this.doc.sliceString(node.from, l.to))
    if (!run || this.doc.sliceString(node.from + run[0].length, l.to).trim() === '') return
    this.mark(node.from, node.from + run[0].length, QUOTE_HANG)
  }

  private rule(node: SyntaxNodeRef): void {
    if (this.revealed(node.from, node.to)) return
    const l = this.doc.lineAt(node.from)
    this.replaceBlock(l, l, new RuleWidget())
  }

  /**
   * A fence is one card (E3): the opening line a header bar (language chip,
   * copy), the closing line a thin cap, the lines between the card's body.
   * Each fence line goes back to text only while the caret is on THAT line —
   * a caret in the code leaves both edges drawn — and a raw edge keeps the
   * card's border and radius through `cm-code-first` / `cm-code-last`.
   */
  private fence(node: SyntaxNodeRef): boolean {
    const first = this.doc.lineAt(node.from)
    const last = this.doc.lineAt(node.to)
    // An unclosed fence has no closing line to cap.
    const lastChild = node.node.lastChild
    const closed =
      last.number > first.number && lastChild?.name === 'CodeMark' && lastChild.from >= last.from
    const openReplaced = !this.revealed(first.from, first.to)
    const closeReplaced = closed && !this.revealed(last.from, last.to)
    if (openReplaced) {
      const info = node.node.getChild('CodeInfo')
      this.replaceBlock(
        first,
        first,
        new FenceWidget(
          info ? this.doc.sliceString(info.from, info.to) : '',
          this.host.labels.code ?? FALLBACK_CODE_LABELS,
          this.mode !== 'reading'
        )
      )
    }
    if (closeReplaced) this.replaceBlock(last, last, new FenceWidget(null))
    this.eachLine(node.from, node.to, (l) => {
      if ((l.number === first.number && openReplaced) || (l.number === last.number && closeReplaced)) return
      this.line(l, CODE_LINE)
      if (l.number === first.number) this.line(l, CODE_FIRST)
      if (l.number === last.number) this.line(l, CODE_LAST)
    })
    // Contents are highlighted by the nested language parser, not by us.
    return false
  }

  /**
   * `> [!type]± Title` (E3, callout.ts): a tinted box over the whole
   * blockquote. Off the caret the header line is a title row (icon, title,
   * chevron when it folds); on it, the line is text in the title's style.
   * Body lines keep the box when the caret is on them — only their `> ` is
   * the quote rule's to reveal. A collapsed body (the `-` marker, or the
   * chevron — view state, never an edit) is one block replace, unless the
   * selection is inside it, which it would otherwise hide.
   *
   * True when the blockquote is a callout: the caller then skips the quote's
   * own line style, which a callout replaces.
   */
  private callout(node: SyntaxNodeRef): boolean {
    // One box, never boxes in boxes: inside a quote, `> > [!x]` is quote text.
    for (let up = node.node.parent; up; up = up.parent) if (up.name === 'Blockquote') return false
    const head = this.doc.lineAt(node.from)
    const header = parseCalloutHeader(this.doc.sliceString(node.from, head.to))
    if (!header) return false
    const last = this.doc.lineAt(node.to)
    const hasBody = last.number > head.number
    const bodyFrom = hasBody ? this.doc.line(head.number + 1).from : head.to
    const choice = this.state.field(calloutFolds, false)?.get(head.from)
    const folded =
      hasBody &&
      this.mode !== 'source' &&
      calloutCollapsed(header, choice) &&
      !inActiveRegion(this.spans, bodyFrom, last.to)
    const closesAtHead = !hasBody || folded
    const box = calloutLine(header.type)
    if (this.revealed(head.from, head.to)) {
      this.line(head, box)
      this.line(head, CALLOUT_HEAD)
      if (closesAtHead) this.line(head, CALLOUT_LAST)
    } else {
      this.replaceBlock(
        head,
        head,
        new CalloutHeaderWidget(
          header.type,
          header.title,
          header.fold === null ? null : folded,
          closesAtHead,
          this.host.labels.callout ?? FALLBACK_CALLOUT_LABELS
        )
      )
    }
    if (!hasBody) return true
    if (folded) {
      this.replaceBlock(this.doc.line(head.number + 1), last, new CalloutFoldedWidget())
      return true
    }
    this.eachLine(bodyFrom, last.to, (l) => {
      this.line(l, box)
      if (l.number === last.number) this.line(l, CALLOUT_LAST)
    })
    return true
  }

  /**
   * The lines of one list item get its depth (Live and Reading): the indent
   * per level and the depth guides are the theme's, drawn from this one number.
   * A line belongs to the innermost item it starts in, so the lines of a nested
   * list are left to that list's own items.
   */
  private listItem(node: SyntaxNodeRef): void {
    if (this.mode === 'source') return
    let depth = 0
    for (let up = node.node.parent; up; up = up.parent) if (up.name === 'ListItem') depth++
    const nested: [number, number][] = []
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'BulletList' || child.name === 'OrderedList') {
        nested.push([this.doc.lineAt(child.from).number, this.doc.lineAt(child.to).number])
      }
    }
    const from = Math.max(node.from, this.range.from)
    const to = Math.min(node.to, this.range.to)
    if (to < from) return
    const deco = listLine(depth)
    const last = this.doc.lineAt(to).number
    for (let n = this.doc.lineAt(from).number; n <= last; n++) {
      if (nested.some(([a, b]) => n >= a && n <= b)) continue
      this.line(this.doc.line(n), deco)
    }
  }

  /**
   * A bullet's `- ` is drawn as the bullet the moment it is a marker — on the
   * caret's line too (Obsidian's rule; Chris, 2026-10-06: "the space live
   * previews it"). It goes back to text only while the selection is ON it:
   * the caret inside it or immediately before it, or a selection over it —
   * i.e. while someone is editing the marker itself. A caret anywhere after it
   * keeps the bullet. Incomplete (`-` with no space yet) is text; ordered
   * numbers stay text in every mode (they are styled, not replaced).
   */
  private listMark(node: SyntaxNodeRef): void {
    const item = node.node.parent
    const list = item?.parent
    if (list?.name === 'OrderedList') {
      this.mark(node.from, node.to, LIST_NUM)
      return
    }
    if (this.mode === 'source') return
    const to = this.skipSpace(node.to, this.doc.lineAt(node.from).to)
    if (to === node.to) return
    if (this.mode === 'live' && markerSelected(this.state.selection, node.from, to)) return
    // A task's marker IS its checkbox; a bullet beside it is Obsidian's rule
    // and the mock's, and two glyphs where there was one reads as a bug.
    const task = item?.getChild('Task')
    if (task) return this.replace(node.from, to)
    // An item with nothing after its marker yet (just opened by Enter, or
    // `- ` just typed): only the `-` is drawn and the space stays TEXT. With
    // the whole `- ` replaced the line would end in the widget, leaving the
    // caret no text node to sit in after it — Firefox then normalises the DOM
    // caret into the indent BEFORE the widget, CM6 reads that back as a user
    // selection, the marker turns raw and typing lands in front of the `-`
    // (Chris, 2026-10-06: "the caret is placed before the bullet" from the
    // first nested level down). The `open` box is narrower by the space, so
    // the first keystroke does not shift the line.
    const open = to === this.doc.lineAt(node.from).to
    this.replace(node.from, open ? node.to : to, new BulletWidget(open))
  }

  private task(node: SyntaxNodeRef): void {
    if (this.mode === 'source') return
    const done = this.doc.sliceString(node.from + 1, node.to - 1).toLowerCase() === 'x'
    const parent = node.node.parent
    // Fork C1: a done task's text is muted and struck — whatever the caret
    // is doing, since it is the task's state and not a marker.
    if (done && parent) this.mark(this.skipSpace(node.to, parent.to), parent.to, TASK_DONE)
    // The widget stays on the active line — a checkbox is not a marker you
    // edit — unless the selection is actually inside the brackets.
    if (this.selectionInside(node.from, node.to)) return
    const lineEnd = this.doc.lineAt(node.from).to
    const label = this.doc.sliceString(node.to, Math.min(parent ? parent.to : lineEnd, lineEnd)).trim()
    // A task you have just opened has no text, and a checkbox with no
    // accessible name is an axe violation as well as a screen-reader dead end.
    this.replace(node.from, node.to, new CheckboxWidget(done, label || this.host.labels.task))
  }

  private inlineCode(node: SyntaxNodeRef): boolean {
    const open = node.node.firstChild
    const close = node.node.lastChild
    const from = open?.name === 'CodeMark' ? open.to : node.from
    const to = close?.name === 'CodeMark' ? close.from : node.to
    this.mark(from, to, INLINE_CODE)
    if (!this.revealed(node.from, node.to)) {
      if (open?.name === 'CodeMark') this.replace(open.from, open.to)
      if (close?.name === 'CodeMark' && close.from !== open?.from) this.replace(close.from, close.to)
    }
    return false
  }

  private emphasis(node: SyntaxNodeRef): void {
    if (this.revealed(node.from, node.to)) return
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name.endsWith('Mark')) this.replace(child.from, child.to)
    }
  }

  private link(node: SyntaxNodeRef): void {
    if (this.revealed(node.from, node.to)) return
    const marks: SyntaxNode[] = []
    for (let child = node.node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'LinkMark') marks.push(child)
    }
    const open = marks[0]
    const close = marks.find((m) => m.from > node.from && this.doc.sliceString(m.from, m.to) === ']')
    if (!open || !close) return
    this.replace(node.from, open.to)
    this.replace(close.from, node.to)
    this.mark(open.to, close.from, MD_LINK)
  }

  private url(node: SyntaxNodeRef): void {
    const parent = node.node.parent
    // Inside `[text](url)` the URL is markup, and `link()` has hidden it.
    if (parent && (parent.name === 'Link' || parent.name === 'Image')) return
    this.mark(node.from, node.to, URL_MARK)
  }

  /**
   * A wikilink, rendered OR raw — one owner for both, because a second plugin
   * marking the target left a rendered link as a span inside a span (R1).
   * Rendered: the brackets go, the label carries the pointer. Raw: only the
   * target is coloured, and a plain click still edits it.
   */
  private wikiLink(node: SyntaxNodeRef): boolean {
    if (this.revealed(node.from, node.to)) return this.rawWikiLink(node)
    const alias = node.node.getChild('WikiLinkAlias')
    const labelFrom = alias ? alias.from : node.from + 2
    const labelTo = alias ? alias.to : node.to - 2
    if (labelTo <= labelFrom) return false
    const resolved = this.resolves(node.node.getChild('WikiLinkTarget'))
    this.replace(node.from, labelFrom)
    this.mark(labelFrom, labelTo, resolved ? WIKILINK : WIKILINK_UNRESOLVED)
    this.replace(labelTo, node.to)
    return false
  }

  /**
   * Resolved reads differently from unresolved because 12% of this vault's
   * targets point at nothing, and that is intent rather than noise.
   */
  private rawWikiLink(node: SyntaxNodeRef): false {
    const target = node.node.getChild('WikiLinkTarget')
    if (target) {
      const deco = this.resolves(target) ? RAW_WIKILINK : RAW_WIKILINK_UNRESOLVED
      this.mark(target.from, target.to, deco)
    }
    return false
  }

  /** Is there a note behind this target? Asked once per link, by both forms. */
  private resolves(target: SyntaxNode | null): boolean {
    if (!target) return false
    const name = this.doc.sliceString(target.from, target.to).trim()
    return this.state.facet(wikiLinkHost).resolve(name) !== null
  }

  /**
   * `![alt](src)` (E5). A local picture is the `![[ ]]` widget with the alt as
   * its alt text; a remote one is a click-to-load placeholder, never a fetch on
   * open — or, when the host cannot load remote images, a link whose tooltip
   * says the picture was not loaded. Anything else (`data:`, a PDF, a
   * reference image) is left as the text it is.
   */
  private image(node: SyntaxNodeRef): boolean | void {
    if (this.revealed(node.from, node.to)) return undefined
    const parts = imageParts(node.node, (from, to) => this.doc.sliceString(from, to))
    if (!parts) return undefined
    const kind = imageSource(parts.src)
    if (kind === 'none') return undefined
    if (kind === 'remote' && !this.host.loadRemoteImage) {
      if (parts.altTo <= parts.altFrom) return undefined
      const title = notLoadedTitle(this.host, parts.src)
      this.replace(node.from, parts.altFrom)
      this.mark(parts.altFrom, parts.altTo, Decoration.mark({ class: cls.MD_LINK, attributes: { title } }))
      this.replace(parts.altTo, node.to)
      return false
    }
    const widget =
      kind === 'local'
        ? (block: boolean) => new EmbedWidget(parts.src, block, this.host, parts.alt, 'markdown')
        : (block: boolean) => new RemoteImageWidget(parts.src, parts.alt, block, this.host)
    const l = this.doc.lineAt(node.from)
    if (l.text.trim() === this.doc.sliceString(node.from, node.to).trim()) {
      this.replaceBlock(l, l, widget(true))
    } else {
      this.replace(node.from, node.to, widget(false))
    }
    return false
  }

  private embed(node: SyntaxNodeRef): boolean {
    if (this.revealed(node.from, node.to)) return this.rawWikiLink(node)
    const inner = this.doc.sliceString(node.from + 3, node.to - 2)
    const name = (inner.split('|')[0] ?? '').trim()
    if (COLLECTION.test(splitWikiLink(inner).target)) return this.collectionEmbed(node, inner)
    // Only a picture is drawn. `![[note]]` (transclusion) and `![[paper.pdf]]`
    // are markup this renderer has no picture for, and an <img> over bytes
    // that are not an image is a broken image, while a *missing attachment*
    // placeholder over a file that is right there is a lie. Both stay as the
    // text they are. (The vault's 14 embeds are all .png; the media types for
    // the same set live in apps/web's `attachmentType`.)
    if (!IMAGE_FILE.test(name)) return this.rawWikiLink(node)
    const l = this.doc.lineAt(node.from)
    // An embed on a line of its own becomes a block; one inside a sentence
    // stays in the sentence, because a block widget may not split a line.
    if (l.text.trim() === this.doc.sliceString(node.from, node.to).trim()) {
      this.replaceBlock(l, l, new EmbedWidget(name, true, this.host))
    } else {
      this.replace(node.from, node.to, new EmbedWidget(name, false, this.host))
    }
    return false
  }

  /**
   * `![[X.base]]` / `![[X.base#View]]` (bases-shaping A6): the collection's
   * view, mounted by the host, on a line of its own only — a table has no
   * place inside a sentence, so an inline one stays as its text, as does
   * every one when the host cannot mount a collection (a bare editor).
   */
  private collectionEmbed(node: SyntaxNodeRef, inner: string): boolean {
    if (!this.host.mountCollection || !this.host.resolveCollection) return this.rawWikiLink(node)
    const l = this.doc.lineAt(node.from)
    if (l.text.trim() !== this.doc.sliceString(node.from, node.to).trim()) return this.rawWikiLink(node)
    const { target, anchor } = splitWikiLink(inner)
    this.replaceBlock(l, l, new CollectionEmbedWidget(target, anchor, this.host.resolveCollection(target), this.editable, this.host))
    return false
  }

  private tag(node: SyntaxNodeRef): void {
    // A chip in every mode: it hides nothing, it is what a tag looks like.
    this.mark(
      node.from,
      node.to,
      Decoration.mark({
        class: cls.TAG,
        attributes: { 'data-tag': this.doc.sliceString(node.from + 1, node.to) },
      })
    )
  }

  /**
   * A table is a grid in Reading, and in Live while the selection is outside
   * it (E4, fork B2); the caret entering it — a click on a cell, an arrow key
   * — shows the source, aligned and with the pipes dimmed. Source mode is
   * always the text.
   *
   * The Live grid is deliberately NOT an atomic range, unlike every other
   * replacement: the moment the caret lands inside the table's range the
   * table is active and its text is back, so the caret is never in text the
   * reader cannot see — and an atomic table could never be reached from the
   * keyboard at all (an arrow key would hop the whole block).
   */
  private table(node: SyntaxNodeRef): boolean | void {
    if (this.mode === 'source') return undefined
    if (this.mode === 'live' && this.revealed(node.from, node.to)) return undefined
    const delimiterRow = node.node.getChild('TableDelimiter')
    const aligns = delimiterRow
      ? splitRow(this.doc.sliceString(delimiterRow.from, delimiterRow.to)).map((c) => alignOf(c.text))
      : []
    const rows: TableRowData[] = []
    for (let row = node.node.firstChild; row; row = row.nextSibling) {
      if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue
      // A cell's column is the number of pipes before it, less the row's own
      // opening pipe — the tree has no node for an EMPTY cell, so counting
      // the cells would slide everything after one to the left.
      const opens = row.firstChild?.name === 'TableDelimiter' && row.firstChild.from === row.from
      const cells: TableRowData['cells'] = []
      let pipes = 0
      for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
        if (cell.name === 'TableDelimiter') pipes++
        else if (cell.name === 'TableCell') cells[pipes - (opens ? 1 : 0)] = extractInline(this.state, cell)
      }
      rows.push({ header: row.name === 'TableHeader', cells })
    }
    if (!rows.length) return undefined
    // Every row as wide as the header (GFM): short rows end in empty cells,
    // and cells past the header's last column are not part of the table.
    const width = Math.max(aligns.length, rows[0].cells.length, 1)
    for (const row of rows) {
      row.cells.length = width
      for (let c = 0; c < width; c++) row.cells[c] ??= []
    }
    const first = this.doc.lineAt(node.from)
    const last = this.doc.lineAt(node.to)
    const widget = new TableWidget(rows, this.doc.sliceString(node.from, node.to), aligns, this.mode === 'live')
    if (this.mode === 'reading') {
      this.replaceBlock(first, last, widget)
    } else {
      this.block.push(Decoration.replace({ widget, block: true }).range(first.from, last.to))
    }
    return false
  }

  private blockId(node: SyntaxNodeRef): void {
    const l = this.doc.lineAt(node.to)
    const m = BLOCK_ID_RE.exec(l.text)
    if (!m) return
    const at = l.from + l.text.lastIndexOf(m[1])
    this.mark(at, at + m[1].length, BLOCK_ID)
  }

  // --- primitives ----------------------------------------------------------

  /** Does this construct keep its markers? Source keeps everything. */
  private revealed(from: number, to: number): boolean {
    return this.mode === 'source' || inActiveRegion(this.spans, from, to)
  }

  private selectionInside(from: number, to: number): boolean {
    return this.state.selection.ranges.some((r) => r.to > from && r.from < to)
  }

  private skipSpace(from: number, limit: number, max = Infinity): number {
    let to = from
    while (to < limit && to - from < max && /[ \t]/.test(this.doc.sliceString(to, to + 1))) to++
    return to
  }

  private eachLine(from: number, to: number, run: (l: Line) => void): void {
    const last = this.doc.lineAt(to).number
    for (let n = this.doc.lineAt(from).number; n <= last; n++) run(this.doc.line(n))
  }

  private line(l: Line, deco: Decoration): void {
    this.inline.push(deco.range(l.from))
  }

  private mark(from: number, to: number, deco: Decoration): void {
    if (to > from) this.inline.push(deco.range(from, to))
  }

  /** Hide a range, optionally drawing something in its place. */
  private replace(from: number, to: number, widget?: WidgetType): void {
    if (to <= from) return
    const deco = widget ? Decoration.replace({ widget }) : HIDE
    this.inline.push(deco.range(from, to))
    this.inlineHidden.push(deco.range(from, to))
  }

  /** Replace whole lines with a block widget (rules, fences, embeds, strips). */
  private replaceBlock(first: Line, last: Line, widget: WidgetType): void {
    const deco = Decoration.replace({ widget, block: true })
    this.block.push(deco.range(first.from, last.to))
    this.blockHidden.push(deco.range(first.from, last.to))
  }
}
