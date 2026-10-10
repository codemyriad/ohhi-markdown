/**
 * The class strings the shell's surfaces share — one heading style, one card
 * shape, one neutral button (shell-polish rule 4). Five components had each
 * re-derived them locally, which is how "the same thing everywhere" stops
 * being the same thing.
 *
 * Each constant is the SHARED core only; a caller adds its own padding, size
 * and weight, because those are what differ between a rail and a full page.
 *
 * **Design tokens only in here.** `scripts/check-design-tokens.sh` greps
 * `.svelte` files, so a raw palette utility written in this module would slip
 * past the gate unseen (docs/theming.md).
 */

/** A section heading: hierarchy from size, weight and case — never from fading. */
export const HEADING = 'text-[11px] font-semibold tracking-wide text-base-content/70 uppercase'

/** The same heading at the size rule 4 gives a definition list's `dt`. */
export const FACT = 'text-[10px] font-semibold tracking-wide text-base-content/70 uppercase'

/** A bordered container: related controls grouped by a box, not by more rules. */
export const CARD = 'rounded-lg border border-base-300 bg-base-100'

/** The non-accent verb — one accent per surface, so the rest are outlines. */
export const OUTLINE_BUTTON =
  'rounded border border-base-300 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'

/**
 * A key glyph in a `<kbd>`: the same chip the editor's link popover footer
 * draws (`.cm-link-footer kbd` in libs/editor's theme.ts), so a key looks
 * like one key wherever the app names it.
 */
export const KBD =
  'inline-block min-w-[14px] rounded-[3px] border border-base-300 bg-base-100 px-1 text-center font-ed-ui text-[10px] leading-[14px] text-base-content'
