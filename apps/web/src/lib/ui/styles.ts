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

/*
 * Settings' type scale and rhythm (QA round 1, slice QA4 — the "tighten-up"
 * of the Settings Explorations II artifact). One scale for every section:
 * hierarchy from size and weight, and ONE muted ink (`MUTED`, the contrast
 * floor) instead of the 70 % and 80 % tints side by side. Settings first;
 * the rest of the shell (Inspector, Log, dock) moves in its own pass.
 *
 * Rhythm on an 8 px grid: 4 inside a control, 8 between related things, 12
 * under an eyebrow row, 28 between groups (`GROUP`), 22 / 28 pane padding.
 * Rows are 36 px, separated by a 1 px base-200 rule, the first base-300.
 * Nothing at 14 px.
 */

/** The one muted ink: hints, meta lines, captions, inactive nav rows. */
export const MUTED = 'text-base-content/70'

/** A section's title: 18 / 1.25, 600, content. */
export const TITLE = 'text-[18px] leading-[1.25] font-semibold tracking-[-0.01em] text-base-content'

/** The one lede under a section's title: 13 / 1.5, muted, at most 60 characters a line. */
export const LEDE = `max-w-[60ch] text-[13px] leading-normal ${MUTED}`

/** A group's eyebrow: 11, 600, uppercase, .06em, muted. */
export const EYEBROW = `text-[11px] font-semibold tracking-[0.06em] uppercase ${MUTED}`

/** A group: 28 px above it. */
export const GROUP = 'mt-7'

/** The eyebrow's row: 28 px, its actions on the same baseline (push them right with `ms-auto`). */
export const GROUP_ROW = 'mb-1 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1'

/** A row: 36 px, one baseline, a base-200 rule above (the first one base-300). Add the grid columns. */
export const ROW = 'min-h-9 items-center gap-x-3 border-t border-base-200 py-1 first:border-base-300'

/** A row's label: 600 for a thing (a provider, a skill)… */
export const ROW_THING = 'text-[13px] font-semibold text-base-content'
/** …500 for a setting. */
export const ROW_SETTING = 'text-[13px] font-medium text-base-content'

/** Meta, hint, caption: 12 / 1.45, muted. */
export const META = `text-xs leading-[1.45] ${MUTED}`

/** A chip: 11, 500, 20 px, a 1 px base-300 pill; a state shows as a 6 px dot inside. */
export const CHIP =
  'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-base-300 px-[7px] text-[11px] font-medium whitespace-nowrap text-base-content'

/** The neutral button: 12, 500, 26 px, a 1 px base-300 border, 6 px radius. */
export const BUTTON =
  'inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-xs font-medium whitespace-nowrap text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'

/** The small one (22 px), for a row's actions. */
export const BUTTON_SM =
  'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-100 px-2 text-[11.5px] font-medium whitespace-nowrap text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'

/** The one primary button a page may have. */
export const BUTTON_PRIMARY =
  'inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium whitespace-nowrap text-primary-content hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50'

/** A pressed option in a row of choices (a segmented control's on state is the tint, not a solid block). */
export const CHOICE =
  'inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary'
export const CHOICE_ON = 'border-primary bg-primary/12 text-base-content'
export const CHOICE_OFF = 'border-base-300 text-base-content hover:bg-base-200'

/** A link-styled verb (a group's help, *Read the guide*). */
export const LINK =
  'text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
