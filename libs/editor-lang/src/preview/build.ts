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
import { Decoration, type DecorationSet, type WidgetType } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common'
import { previewMode, readHost, type ReadHost, type ViewMode } from '../read-host.js'
import { wikiLinkHost } from '../wikilink-view.js'
import { activeSpans, inActiveRegion, type Span } from './active-lines.js'
import { extractInline } from './inline-dom.js'
import {
  BulletWidget,
  CheckboxWidget,
  EmbedWidget,
  FenceWidget,
  FrontmatterStripWidget,
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
const CODE_LINE = line('cm-live-code')
const FRONTMATTER_LINE = line('cm-live-frontmatter')
const TABLE_HEAD_LINE = line('cm-table-head')
const LIST_NUM = mark('cm-list-num')
const INLINE_CODE = mark('cm-inline-code')
const MD_LINK = mark('cm-md-link cm-live-link')
const URL_MARK = mark('cm-url cm-live-link')
const HTML_MARK = mark('cm-html')
const BLOCK_ID = mark('cm-block-id')
const TABLE_PIPE = mark('cm-table-pipe')
const WIKILINK = mark('cm-wikilink cm-live-link')
const WIKILINK_UNRESOLVED = mark('cm-wikilink-unresolved cm-live-link')

const EMPHASIS = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'Highlight'])
const HTML = new Set(['HTMLBlock', 'HTMLTag', 'Comment', 'CommentBlock', 'ProcessingInstruction'])
/** `^abc123` at the end of a block. Dim, never resolved (D8). */
const BLOCK_ID_RE = /(?:^|\s)(\^[A-Za-z0-9-]+)[ \t]*$/
/** The frontmatter delimiters and the scan bound — frontmatter-block.ts's rule. */
const FM_OPEN = /^-{3}\s*$/
const FM_CLOSE = /^(?:-{3}|\.{3})\s*$/
const FM_MAX_LINES = 64
/** Embeddable pictures — the set `attachmentType` in apps/web can name. */
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

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
  private readonly spans: Span[]
  private readonly mode: ViewMode
  private readonly host: ReadHost
  private readonly doc: EditorState['doc']

  constructor(
    private readonly state: EditorState,
    private readonly opts: BuilderOptions = {}
  ) {
    this.mode = state.facet(previewMode)
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
      for (const { from, to } of this.opts.ranges) tree.iterate({ from, to, enter })
    } else {
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
        return this.frontmatter(node)
      case 'HorizontalRule':
        return this.rule(node)
      case 'FencedCode':
        return this.fence(node)
      case 'Table':
        return this.table(node)
      case 'WikiLinkEmbed':
        return this.embed(node)
      case 'Paragraph':
      case 'Task':
        return this.doc.sliceString(node.from, node.to).includes('![[') ? undefined : false
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
        return this.frontmatter(node)
      case 'HeaderMark':
        return this.headerMark(node)
      case 'Blockquote':
        return this.eachLine(node.from, node.to, (l) => this.line(l, QUOTE_LINE))
      case 'QuoteMark':
        return this.quoteMark(node)
      case 'HorizontalRule':
        return this.rule(node)
      case 'FencedCode':
        return this.fence(node)
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

  private frontmatter(node: SyntaxNodeRef): boolean {
    return this.frontmatterRange(node.from, node.to)
  }

  private frontmatterRange(from: number, to: number): boolean {
    const info = this.host.frontmatter?.(
      this.doc.sliceString(0, Math.min(to + 1, this.doc.length))
    )
    if (!this.revealed(from, to) && info?.present) {
      this.replaceBlock(
        this.doc.lineAt(from),
        this.doc.lineAt(to),
        new FrontmatterStripWidget(
          info.tags,
          info.entries.length,
          info.supported,
          this.host.labels,
          this.mode !== 'reading'
        )
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

  private quoteMark(node: SyntaxNodeRef): void {
    if (this.revealed(node.from, node.to)) return
    this.replace(node.from, this.skipSpace(node.to, this.doc.lineAt(node.from).to, 1))
  }

  private rule(node: SyntaxNodeRef): void {
    if (this.revealed(node.from, node.to)) return
    const l = this.doc.lineAt(node.from)
    this.replaceBlock(l, l, new RuleWidget())
  }

  private fence(node: SyntaxNodeRef): boolean {
    const first = this.doc.lineAt(node.from)
    const last = this.doc.lineAt(node.to)
    let openReplaced = false
    let closeReplaced = false
    if (!this.revealed(node.from, node.to)) {
      const info = node.node.getChild('CodeInfo')
      this.replaceBlock(
        first,
        first,
        new FenceWidget(info ? this.doc.sliceString(info.from, info.to) : '')
      )
      openReplaced = true
      // An unclosed fence has no closing line to cap.
      const lastChild = node.node.lastChild
      if (last.number > first.number && lastChild?.name === 'CodeMark' && lastChild.from >= last.from) {
        this.replaceBlock(last, last, new FenceWidget(null))
        closeReplaced = true
      }
    }
    this.eachLine(node.from, node.to, (l) => {
      if ((l.number === first.number && openReplaced) || (l.number === last.number && closeReplaced)) return
      this.line(l, CODE_LINE)
    })
    // Contents are highlighted by the nested language parser, not by us.
    return false
  }

  private listMark(node: SyntaxNodeRef): void {
    const item = node.node.parent
    const list = item?.parent
    if (list?.name === 'OrderedList') {
      this.mark(node.from, node.to, LIST_NUM)
      return
    }
    if (this.revealed(node.from, node.to)) return
    const to = this.skipSpace(node.to, this.doc.lineAt(node.from).to)
    if (to === node.to) return
    // A task's marker IS its checkbox; a bullet beside it is Obsidian's rule
    // and the mock's, and two glyphs where there was one reads as a bug.
    const task = item?.getChild('Task')
    this.replace(node.from, to, task ? undefined : new BulletWidget())
  }

  private task(node: SyntaxNodeRef): void {
    if (this.mode === 'source') return
    // The widget stays on the active line — a checkbox is not a marker you
    // edit — unless the selection is actually inside the brackets.
    if (this.selectionInside(node.from, node.to)) return
    const done = this.doc.sliceString(node.from + 1, node.to - 1).toLowerCase() === 'x'
    const lineEnd = this.doc.lineAt(node.from).to
    const parent = node.node.parent
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

  private wikiLink(node: SyntaxNodeRef): boolean {
    if (this.revealed(node.from, node.to)) return false
    const alias = node.node.getChild('WikiLinkAlias')
    const target = node.node.getChild('WikiLinkTarget')
    const labelFrom = alias ? alias.from : node.from + 2
    const labelTo = alias ? alias.to : node.to - 2
    if (labelTo <= labelFrom) return false
    const name = target ? this.doc.sliceString(target.from, target.to).trim() : ''
    const resolved = this.state.facet(wikiLinkHost).resolve(name) !== null
    this.replace(node.from, labelFrom)
    this.mark(labelFrom, labelTo, resolved ? WIKILINK : WIKILINK_UNRESOLVED)
    this.replace(labelTo, node.to)
    return false
  }

  private embed(node: SyntaxNodeRef): boolean {
    if (this.revealed(node.from, node.to)) return false
    const inner = this.doc.sliceString(node.from + 3, node.to - 2)
    const name = (inner.split('|')[0] ?? '').trim()
    // Only a picture is drawn. `![[note]]` (transclusion) and `![[paper.pdf]]`
    // are markup this renderer has no picture for, and an <img> over bytes
    // that are not an image is a broken image, while a *missing attachment*
    // placeholder over a file that is right there is a lie. Both stay as the
    // text they are. (The vault's 14 embeds are all .png; the media types for
    // the same set live in apps/web's `attachmentType`.)
    if (!IMAGE.test(name)) return false
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

  private tag(node: SyntaxNodeRef): void {
    // A chip in every mode: it hides nothing, it is what a tag looks like.
    this.mark(
      node.from,
      node.to,
      Decoration.mark({
        class: 'cm-tag',
        attributes: { 'data-tag': this.doc.sliceString(node.from + 1, node.to) },
      })
    )
  }

  private table(node: SyntaxNodeRef): boolean | void {
    if (this.mode !== 'reading') return undefined
    const rows: TableRowData[] = []
    for (let row = node.node.firstChild; row; row = row.nextSibling) {
      if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue
      const cells = []
      for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
        if (cell.name === 'TableCell') cells.push(extractInline(this.state, cell))
      }
      rows.push({ header: row.name === 'TableHeader', cells })
    }
    if (!rows.length) return undefined
    this.replaceBlock(
      this.doc.lineAt(node.from),
      this.doc.lineAt(node.to),
      new TableWidget(rows, this.doc.sliceString(node.from, node.to))
    )
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
