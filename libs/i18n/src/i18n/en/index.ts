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
  app_name: 'Editor',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  saved: 'Saved',
  working: 'Working…',
}

const en = {
  common,
} satisfies BaseTranslation

export default en
