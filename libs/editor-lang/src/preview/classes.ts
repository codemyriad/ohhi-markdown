/**
 * What a rendered construct is called, in one table: `build.ts` decorates the
 * note's own text with these, `inline-dom.ts` and `widgets.ts` build DOM with
 * them for the lines a widget replaces. A chip in a table cell that drifted
 * from a chip in a paragraph would be two things to `clicks.ts` and to the
 * theme. `cm-live-link` (the pointer) marks the RENDERED forms only — where
 * the brackets are still text, a plain click places the caret.
 */
export const TAG = 'cm-tag'
export const INLINE_CODE = 'cm-inline-code'
export const HIGHLIGHT = 'cm-highlight'
export const MD_LINK = 'cm-md-link cm-live-link'
export const BARE_URL = 'cm-url cm-live-link'
export const WIKILINK = 'cm-wikilink cm-live-link'
export const WIKILINK_UNRESOLVED = 'cm-wikilink-unresolved cm-live-link'
export const RAW_WIKILINK = 'cm-wikilink'
export const RAW_WIKILINK_UNRESOLVED = 'cm-wikilink-unresolved'
/** A list item's line; carries `--cm-list-depth` for the indent and the guides. */
export const LIST_LINE = 'cm-list-line'
