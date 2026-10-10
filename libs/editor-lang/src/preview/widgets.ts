/**
 * The widgets Live and Reading draw in place of markup (read-shaping.md B2.1,
 * B2.3, Fork 5-C).
 *
 * Rules that hold for every widget here:
 *
 * - The DOM is built in `toDOM`, never in the constructor: a decoration set is
 *   rebuilt on every keystroke and selection move, so constructing widgets must
 *   cost nothing but an object (it also lets the whole engine be unit-tested in
 *   node, where there is no `document`).
 * - `eq` compares the values the DOM is made of, so CM6 keeps the existing
 *   element across rebuilds — without it an embed would re-read its file, and a
 *   checkbox would flicker, on every arrow key.
 * - `ignoreEvent` (`ReadWidget`'s) lets mousedown/click through to the editor
 *   so the view-level handlers in clicks.ts see them; everything else stays
 *   inside the widget. A button the widget owns is `claim`ed and named in its
 *   `ignoreEvent` through `ownsEvent`, so its press never reaches the editor.
 * - No colour and no layout here: every class is styled in libs/editor/theme.ts
 *   through --ed-* tokens (golden rule 7).
 */
import { WidgetType } from '@codemirror/view'
import type { ReadHost, ReadLabels } from '../read-host.js'
import { renderInline, tagChip, type InlinePiece } from './inline-dom.js'
import type { Align } from './table-ops.js'

/** Did the event happen inside one of the widget's own controls (`selector`)? */
export function ownsEvent(event: Event, selector: string): boolean {
  return !!(event.target as Element | null)?.closest?.(selector)
}

/** Every widget here: mousedown and click go to the editor (clicks.ts), all else stays in the widget. */
export abstract class ReadWidget extends WidgetType {
  override ignoreEvent(event: Event): boolean {
    return !(event.type === 'mousedown' || event.type === 'click')
  }
}

/**
 * A button the widget owns: its press never moves the caret or the focus (so
 * the widget is not torn down under the pointer), and its click — which a
 * keyboard Enter/Space fires too — runs `run`.
 */
export function claim(button: HTMLElement, run: () => void): void {
  button.addEventListener('mousedown', (e) => e.preventDefault())
  button.addEventListener('click', (e) => {
    e.preventDefault()
    run()
  })
}

/**
 * A widget that draws a picture from a `blob:` URL: the URL is revoked when
 * the widget goes, and `dead` tells an answer that arrives later (the adapter
 * read, a remote fetch) that there is no DOM left to fill.
 */
export abstract class BlobWidget extends ReadWidget {
  private url: string | null = null
  protected dead = false

  /** An `<img>` over the blob, its URL owned by this widget. */
  protected image(blob: Blob, alt: string): HTMLImageElement {
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = URL.createObjectURL(blob)
    const img = document.createElement('img')
    img.src = this.url
    img.alt = alt
    return img
  }

  override destroy(): void {
    this.dead = true
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
  }
}

/** `[ ]` / `[x]` — a real checkbox, because a real one is what a reader clicks. */
export class CheckboxWidget extends ReadWidget {
  constructor(
    readonly done: boolean,
    /** The task's own text: the checkbox's accessible name, free of i18n. */
    readonly label: string
  ) {
    super()
  }

  override eq(other: CheckboxWidget): boolean {
    return other.done === this.done && other.label === this.label
  }

  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task'
    box.checked = this.done
    box.setAttribute('aria-label', this.label)
    return box
  }
}

/**
 * `- `, drawn as a filled dot — everywhere but while the marker itself is being
 * edited. Indentation is untouched text, so the tab stop places it; the dot is
 * the theme's (a box `--ed-list-indent` wide, a circle in `--ed-bullet`), so it
 * has no glyph of its own and nothing for a screen reader to announce twice.
 */
export class BulletWidget extends ReadWidget {
  constructor(
    /** Only the `-` is replaced: the item is empty and its space is still text. */
    readonly open = false,
    /**
     * Drawn faint: a lone `-` under a paragraph, which parses as a setext
     * underline until the item's text arrives (fork D1, setext.ts).
     */
    readonly provisional = false
  ) {
    super()
  }

  override eq(other: BulletWidget): boolean {
    return other.open === this.open && other.provisional === this.provisional
  }

  toDOM(): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-bullet'
    if (this.open) box.classList.add('cm-bullet-open')
    if (this.provisional) box.classList.add('cm-bullet-provisional')
    box.setAttribute('aria-hidden', 'true')
    return box
  }
}

/** A `---` line, drawn as the rule it means. */
export class RuleWidget extends ReadWidget {
  override eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-live-rule'
    wrap.appendChild(document.createElement('hr'))
    return wrap
  }
}

/**
 * `![[picture.png]]`. The bytes come from the host's adapter — binaries live on
 * disk and never in a Y.Text, so a device that has not got the file says so
 * rather than drawing a broken image (D2f stays in Later).
 */
export class EmbedWidget extends BlobWidget {
  constructor(
    readonly name: string,
    readonly block: boolean,
    private readonly host: ReadHost,
    /** `![alt](src)`'s alt text (E5); a wikilink embed is named by its file. */
    readonly alt: string | null = null,
    /** Which syntax named the file: a markdown `src` is relative to the note. */
    readonly form: 'wikilink' | 'markdown' = 'wikilink'
  ) {
    super()
  }

  override eq(other: EmbedWidget): boolean {
    return (
      other.name === this.name &&
      other.block === this.block &&
      other.alt === this.alt &&
      other.form === this.form
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'figure' : 'span')
    wrap.className = this.block ? 'cm-embed cm-embed-block' : 'cm-embed'
    const missing = (): void => {
      wrap.classList.add('cm-embed-missing')
      wrap.textContent = `${this.name} — ${this.host.labels.missingAttachment}`
    }
    void this.host.readAttachment(this.name, this.form).then(
      (blob) => {
        // The view may have moved on while the adapter was reading.
        if (this.dead) return
        if (!blob) return missing()
        wrap.appendChild(this.image(blob, this.alt ?? this.name))
      },
      // A host that rejects has not got the file either: same answer, and never
      // an unhandled rejection out of a decoration rebuild.
      () => {
        if (!this.dead) missing()
      }
    )
    return wrap
  }
}

/**
 * The collapsed frontmatter block (Fork 5-C): the note's tags as chips, plus
 * how many properties are behind them. Clicking it puts the caret in the YAML —
 * the block is ordinary text, and this is only a way back into it (R4.1.1).
 */
export class FrontmatterStripWidget extends ReadWidget {
  constructor(
    readonly tags: readonly string[],
    readonly properties: number,
    readonly supported: boolean,
    readonly labels: ReadLabels,
    /** Reading has no caret to place, so the strip is not a click target there. */
    readonly editable: boolean
  ) {
    super()
  }

  override eq(other: FrontmatterStripWidget): boolean {
    return (
      other.properties === this.properties &&
      other.supported === this.supported &&
      other.editable === this.editable &&
      other.tags.length === this.tags.length &&
      other.tags.every((tag, i) => tag === this.tags[i])
    )
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-frontmatter-strip'
    if (this.supported) {
      // The same chip the body draws, so one click handler reaches both.
      for (const tag of this.tags) wrap.appendChild(tagChip(tag))
      const count = document.createElement('span')
      count.className = 'cm-frontmatter-count'
      count.textContent = this.labels.properties(this.properties)
      wrap.appendChild(count)
    } else {
      const badge = document.createElement('span')
      badge.className = 'cm-frontmatter-badge'
      badge.textContent = this.labels.frontmatterUnsupported
      wrap.appendChild(badge)
    }
    return wrap
  }
}

/** One row of a table, as the cells' inline content (already extracted). */
export interface TableRowData {
  header: boolean
  /** One entry per COLUMN — an empty cell is `[]`, so cell N is column N. */
  cells: InlinePiece[][]
}

/**
 * A GFM table drawn as a grid: in Reading, and in Live while the selection is
 * outside it (E4, fork B2 — the caret entering it shows the source). The
 * cells are extracted from the syntax tree when the decoration is built, so
 * this draws the same inline constructs the editor does — there is no second
 * markdown parser.
 *
 * Every cell carries `data-row` (the header is 0, the delimiter row is not
 * counted) and `data-col`, which is all clicks.ts needs to put the caret in
 * that cell's text; `editable` says whether a click may (Reading has no caret).
 */
export class TableWidget extends ReadWidget {
  constructor(
    readonly rows: TableRowData[],
    /** The block's source text: cheap, exact identity for `eq`. */
    readonly source: string,
    readonly aligns: readonly Align[] = [],
    readonly editable = false
  ) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.editable === this.editable
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = this.editable ? 'cm-table-wrap cm-table-grid' : 'cm-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-table'
    const head = document.createElement('thead')
    const body = document.createElement('tbody')
    this.rows.forEach((row, r) => {
      const tr = document.createElement('tr')
      row.cells.forEach((cell, c) => {
        const td = document.createElement(row.header ? 'th' : 'td')
        td.dataset.row = String(r)
        td.dataset.col = String(c)
        const align = this.aligns[c]
        if (align && align !== 'none') td.style.textAlign = align
        td.appendChild(renderInline(cell))
        tr.appendChild(td)
      })
      ;(row.header ? head : body).appendChild(tr)
    })
    if (head.childNodes.length) table.appendChild(head)
    if (body.childNodes.length) table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }
}
