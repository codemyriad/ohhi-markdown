/**
 * The code card's edges (editor-usability E3): the opening fence as a header
 * bar — the language chip on the left, copy on the right — and the closing
 * fence as a thin bottom cap. The card itself is the body lines' classes
 * (`cm-live-code` plus `cm-code-first` / `cm-code-last` where a fence is raw),
 * so the header, the lines and the cap read as one box with no seams.
 *
 * The same rules as widgets.ts: DOM in `toDOM` only, `eq` over what the DOM
 * is made of, no colour here. The two buttons are the widget's own (they
 * claim their press, so the caret does not move and the bar is not torn down
 * under the pointer); a press anywhere else on the bar goes to the editor,
 * which puts the caret on the fence line and shows it as text.
 */
import type { EditorView } from '@codemirror/view'
import type { CodeLabels } from '../read-host.js'
import { codeBlockText, openFenceLanguage } from './fence-edit.js'
import { icon } from './icons.js'
import { claim, ownsEvent, ReadWidget } from './widgets.js'

const COPIED_MS = 1500

/** A fence's opening line (`lang` is its info string) or, with `lang` null, its closing line. */
export class FenceWidget extends ReadWidget {
  constructor(
    readonly lang: string | null,
    readonly labels: CodeLabels | null = null,
    /** Reading has no caret to put in the info string: the chip is a label there. */
    readonly editable = true
  ) {
    super()
  }

  override eq(other: FenceWidget): boolean {
    return other.lang === this.lang && other.editable === this.editable && other.labels === this.labels
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    if (this.lang === null || !this.labels) {
      wrap.className = 'cm-fence-line cm-fence-cap'
      wrap.setAttribute('aria-hidden', 'true')
      return wrap
    }
    const labels = this.labels
    wrap.className = 'cm-fence-line cm-fence-open'
    // The info string's first word is the language; the rest (`title=…`) is not shown.
    const lang = (this.lang.trim().split(/\s+/)[0] ?? '').toLowerCase()
    const shown = lang || labels.plain
    const chip = document.createElement(this.editable ? 'button' : 'span')
    chip.className = 'cm-fence-chip'
    const name = document.createElement('span')
    name.className = 'cm-fence-lang'
    name.textContent = shown
    chip.appendChild(name)
    if (chip instanceof HTMLButtonElement) {
      chip.type = 'button'
      chip.setAttribute('aria-label', labels.language(shown))
      chip.appendChild(icon('chevron-down'))
      claim(chip, () => openFenceLanguage(view, view.posAtDOM(wrap)))
    }
    wrap.appendChild(chip)

    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'cm-fence-copy'
    copy.setAttribute('aria-label', labels.copy)
    copy.appendChild(icon('copy'))
    let reset: ReturnType<typeof setTimeout> | undefined
    claim(copy, () => {
      const text = codeBlockText(view.state, view.posAtDOM(wrap))
      if (text === null) return
      copyText(text).then(
        () => {
          copy.replaceChildren(icon('check'))
          copy.classList.add('cm-fence-copied')
          copy.setAttribute('aria-label', labels.copied)
          clearTimeout(reset)
          reset = setTimeout(() => {
            copy.replaceChildren(icon('copy'))
            copy.classList.remove('cm-fence-copied')
            copy.setAttribute('aria-label', labels.copy)
          }, COPIED_MS)
        },
        (err: unknown) => console.warn('[editor] copying the code block failed', err)
      )
    })
    wrap.appendChild(copy)
    return wrap
  }

  override ignoreEvent(event: Event): boolean {
    return ownsEvent(event, 'button') || super.ignoreEvent(event)
  }
}

/** The clipboard, or a rejection to warn about — never a throw out of a click. */
function copyText(text: string): Promise<void> {
  try {
    if (!navigator.clipboard) return Promise.reject(new Error('no clipboard'))
    return navigator.clipboard.writeText(text)
  } catch (err) {
    return Promise.reject(err)
  }
}
