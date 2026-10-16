import type { BaseTranslation } from '../i18n-types.js'

/**
 * The ROOT dictionary: words every app in this repo shares. App-specific
 * copy lives in a namespace (`en/web/index.ts` for the shell) — the Edible
 * layout, so `$LL.common.cancel()` and `$LL.web.tree.menu.rename()` read the
 * same here as `$LL.common.*` / `$LL.builder.*` do there.
 *
 * Only `en` is hand-written. Other locales (when they arrive) extend it:
 * `extendDictionary(en, mergeTranslations(en, json))`.
 */
const common = {
  app_name: 'Oh Hi markdown',
  /**
   * The wordmark as the landing site draws it (`apps/site` `Base.astro`):
   * "Oh Hi" as ink on the highlighter, the voice dropping on "markdown" with
   * its "mark" leaning (the real 400 italic). The parts read as `app_name`
   * together; the splash is the first surface in the app to draw it (Chris,
   * 2026-10-16: "only there for now").
   */
  wordmark: {
    hi: 'Oh Hi',
    mark: 'mark',
    down: 'down',
  },
  cancel: 'Cancel',
  close: 'Close',
  working: 'Working…',
  /** The top of the vault where a folder is named: the link popover's create row, a move's destination list. */
  vault_root: 'Vault root',
  /** Key glyphs drawn in a `<kbd>` (the pane mode's keys, the link popover's footer). */
  keys: {
    enter: '↵',
    tab: 'Tab',
    escape: 'Esc',
    help: '?',
  },
}

const en = {
  common,
} satisfies BaseTranslation

export default en
