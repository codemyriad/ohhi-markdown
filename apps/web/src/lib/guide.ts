/**
 * Where the guide pages live (first-run-shaping E4, Fork 4-A): one entry
 * point every surface that links to a guide goes through, so the welcome,
 * the join page, the relay card and the Help menu never disagree about where
 * "the guide" is.
 *
 * The pages are `docs/guide/*.md`, rendered into the web build at
 * `guide/<page>.html` and served beside the app on the team host; the
 * desktop bundles the same files, so a relative path reaches them on both.
 * The Help slice (E1–E4) owns this module and may refine how a page is
 * OPENED (a new tab in a browser, an in-app frame on the desktop); the href
 * itself stays this.
 */
export type GuidePage = 'start' | 'sharing' | 'recovery' | 'import' | 'relay' | 'changes'

/** The guide page's href, relative to the app's own origin. */
export function guideHref(page: GuidePage): string {
  return `/guide/${page}.html`
}
