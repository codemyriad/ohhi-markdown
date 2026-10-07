/**
 * The ink of a peer's caret label (the name tag over a remote caret).
 *
 * The label's FILL is the sender's colour, written inline by y-codemirror.next
 * from the awareness `user.color` hex — the sender's theme's
 * `--ed-presence-N`, which this view cannot name by slot (the two ends may be
 * on different themes). So the ink cannot be a single `--ed-peer-label-fg`:
 * white on a light nord-dark slot is 1.6:1. It is chosen by luminance here, a
 * pure function over the fill, and `peerLabelInk()` writes it onto each label
 * — the theme's `--ed-peer-label-fg` stays the default for a fill it cannot
 * parse.
 */
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'

/** The two inks: the contract's light one and the near-black the dark themes' presence inks use. */
export const LIGHT_INK = '#ffffff'
export const DARK_INK = '#0b0e13'

type Rgb = readonly [number, number, number]

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, or `rgb()/rgba()` (how a browser reports an inline colour) → 0–255 channels. */
export function parseColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v)
  if (hex) {
    const h = hex[1]!
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6)
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb
  }
  const rgb = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(v)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * The ink for a label filled with `fill`: whichever of the two inks reads
 * better on it, or null when the fill is not a colour this can parse (the
 * theme's `--ed-peer-label-fg` then stands).
 */
export function labelInk(fill: string): string | null {
  const rgb = parseColor(fill)
  if (!rgb) return null
  const light = contrast(rgb, parseColor(LIGHT_INK)!)
  const dark = contrast(rgb, parseColor(DARK_INK)!)
  return light >= dark ? LIGHT_INK : DARK_INK
}

/**
 * Writes `labelInk` onto every remote caret label after CM6 has drawn it. The
 * fill lives on the caret (`.cm-ySelectionCaret`'s inline background, which
 * the label inherits), so that is what is read; a label is only touched when
 * its ink would change.
 */
export function peerLabelInk() {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        this.schedule()
      }
      update(u: ViewUpdate): void {
        if (u.transactions.length || u.viewportChanged) this.schedule()
      }
      schedule(): void {
        this.view.requestMeasure({
          key: this,
          read: () => null,
          write: () => {
            for (const info of this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-ySelectionInfo')) {
              const fill = (info.parentElement as HTMLElement | null)?.style.backgroundColor ?? ''
              const ink = labelInk(fill)
              // Compared on a data attribute: the browser reports `style.color` as rgb().
              if (!ink || info.dataset.ink === ink) continue
              info.dataset.ink = ink
              info.style.color = ink
            }
          },
        })
      }
    }
  )
}
