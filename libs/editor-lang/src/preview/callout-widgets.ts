/**
 * The callout's title row and its folded body (editor-usability E3). The same
 * rules as widgets.ts: DOM in `toDOM` only, `eq` over what the DOM is made of,
 * no colour here — `.cm-callout-type-*` picks the type's token in theme.ts.
 */
import { WidgetType, type EditorView } from '@codemirror/view'
import type { ReadLabels } from '../read-host.js'
import { CALLOUT_ICONS, type CalloutType } from './callout.js'
import { setCalloutFold } from './callout-fold.js'
import { icon } from './icons.js'

/** The classes every line of one callout shares: the box, and the type's colour. */
export function calloutClass(type: CalloutType): string {
  return `cm-callout cm-callout-type-${type}`
}

/**
 * `> [!type]± Title` off the caret: the type's icon and the title, in the
 * type's colour, plus a chevron when the callout folds. A click anywhere but
 * the chevron goes to the editor, which puts the caret on the line — and the
 * line goes back to its text, so the title is edited as text.
 */
export class CalloutHeaderWidget extends WidgetType {
  constructor(
    readonly type: CalloutType,
    readonly title: string,
    /** null: not foldable; otherwise whether the body is collapsed now. */
    readonly collapsed: boolean | null,
    /** Nothing below it in the box (an empty or a collapsed body): it takes the bottom radius. */
    readonly last: boolean,
    readonly labels: ReadLabels
  ) {
    super()
  }

  override eq(other: CalloutHeaderWidget): boolean {
    return (
      other.type === this.type &&
      other.title === this.title &&
      other.collapsed === this.collapsed &&
      other.last === this.last &&
      other.labels === this.labels
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = `${calloutClass(this.type)} cm-callout-head cm-callout-first${this.last ? ' cm-callout-last' : ''}`
    const mark = document.createElement('span')
    mark.className = 'cm-callout-icon'
    mark.appendChild(icon(CALLOUT_ICONS[this.type]))
    wrap.appendChild(mark)
    const title = document.createElement('span')
    title.className = 'cm-callout-title'
    title.textContent = this.title
    wrap.appendChild(title)
    if (this.collapsed !== null) {
      const collapsed = this.collapsed
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'cm-callout-fold'
      toggle.setAttribute('aria-expanded', String(!collapsed))
      toggle.setAttribute('aria-label', this.labels.toggleCallout(this.title))
      toggle.appendChild(icon('chevron-down'))
      // Claim the press so the caret does not move onto the header (which
      // would turn it back into text under the pointer); act on click, which
      // a keyboard Enter/Space also fires.
      toggle.addEventListener('mousedown', (e) => e.preventDefault())
      toggle.addEventListener('click', (e) => {
        e.preventDefault()
        const at = view.state.doc.lineAt(view.posAtDOM(wrap)).from
        view.dispatch({ effects: setCalloutFold.of({ at, collapsed: !collapsed }) })
      })
      wrap.appendChild(toggle)
    }
    return wrap
  }

  override ignoreEvent(event: Event): boolean {
    // The chevron is the widget's own; everything else is the editor's (a
    // press on the title places the caret on the line).
    if ((event.target as Element | null)?.closest?.('.cm-callout-fold')) return true
    return !(event.type === 'mousedown' || event.type === 'click')
  }
}

/** A collapsed body: nothing drawn, the box closes under the title row. */
export class CalloutFoldedWidget extends WidgetType {
  override eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = 'cm-callout-folded'
    el.setAttribute('aria-hidden', 'true')
    return el
  }
}
