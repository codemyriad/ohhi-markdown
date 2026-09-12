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
 * - `ignoreEvent` lets mousedown/click through to the editor so the view-level
 *   handlers in clicks.ts see them; everything else stays inside the widget.
 * - No colour and no layout here: every class is styled in libs/editor/theme.ts
 *   through --ed-* tokens (golden rule 7).
 */
import { WidgetType } from '@codemirror/view'
import type { ReadHost, ReadLabels } from '../read-host.js'
import { renderInline, type InlinePiece } from './inline-dom.js'

function interactive(event: Event): boolean {
  return event.type === 'mousedown' || event.type === 'click'
}

abstract class ReadWidget extends WidgetType {
  override ignoreEvent(event: Event): boolean {
    return !interactive(event)
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

/** `- ` off the active region. Indentation is untouched text, so tab-size places it. */
export class BulletWidget extends ReadWidget {
  override eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'cm-bullet'
    dot.textContent = '•'
    return dot
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

/** A fence's opening line (language badge) or closing line (cap). */
export class FenceWidget extends ReadWidget {
  constructor(readonly lang: string | null) {
    super()
  }

  override eq(other: FenceWidget): boolean {
    return other.lang === this.lang
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = this.lang === null ? 'cm-fence-line cm-fence-cap' : 'cm-fence-line cm-fence-open'
    if (this.lang !== null && this.lang !== '') {
      const badge = document.createElement('span')
      badge.className = 'cm-fence-lang'
      badge.textContent = this.lang
      wrap.appendChild(badge)
    }
    return wrap
  }
}

/**
 * `![[picture.png]]`. The bytes come from the host's adapter — binaries live on
 * disk and never in a Y.Text, so a device that has not got the file says so
 * rather than drawing a broken image (D2f stays in Later).
 */
export class EmbedWidget extends ReadWidget {
  private url: string | null = null
  private dead = false

  constructor(
    readonly name: string,
    readonly block: boolean,
    private readonly host: ReadHost
  ) {
    super()
  }

  override eq(other: EmbedWidget): boolean {
    return other.name === this.name && other.block === this.block
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement(this.block ? 'figure' : 'span')
    wrap.className = this.block ? 'cm-embed cm-embed-block' : 'cm-embed'
    const missing = (): void => {
      wrap.classList.add('cm-embed-missing')
      wrap.textContent = `${this.name} — ${this.host.labels.missingAttachment}`
    }
    void this.host.readAttachment(this.name).then(
      (blob) => {
        // The view may have moved on while the adapter was reading.
        if (this.dead) return
        if (!blob) return missing()
        this.url = URL.createObjectURL(blob)
        const img = document.createElement('img')
        img.src = this.url
        img.alt = this.name
        wrap.appendChild(img)
      },
      // A host that rejects has not got the file either: same answer, and never
      // an unhandled rejection out of a decoration rebuild.
      () => {
        if (!this.dead) missing()
      }
    )
    return wrap
  }

  override destroy(): void {
    this.dead = true
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
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
      for (const tag of this.tags) {
        const chip = document.createElement('span')
        chip.className = 'cm-tag'
        chip.dataset.tag = tag
        chip.textContent = `#${tag}`
        wrap.appendChild(chip)
      }
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
  cells: InlinePiece[][]
}

/**
 * A GFM table, rendered in Reading only (Fork 3-A). The cells are extracted
 * from the syntax tree when the decoration is built, so this draws the same
 * inline constructs the editor does — there is no second markdown parser.
 */
export class TableWidget extends ReadWidget {
  constructor(
    readonly rows: TableRowData[],
    /** The block's source text: cheap, exact identity for `eq`. */
    readonly source: string
  ) {
    super()
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-table'
    const head = document.createElement('thead')
    const body = document.createElement('tbody')
    for (const row of this.rows) {
      const tr = document.createElement('tr')
      for (const cell of row.cells) {
        const td = document.createElement(row.header ? 'th' : 'td')
        td.appendChild(renderInline(cell))
        tr.appendChild(td)
      }
      ;(row.header ? head : body).appendChild(tr)
    }
    if (head.childNodes.length) table.appendChild(head)
    if (body.childNodes.length) table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }
}
