import type { FormattersInitializer } from 'typesafe-i18n'
import type { Formatters, Locales } from './i18n-types.js'

/**
 * Per-locale formatters, referenced from a dictionary as `{value|name}`.
 * None are needed yet; add them here (Edible's `listAnd` / `listOr` are the
 * model) and `rushx generate` types them.
 */
export const initFormatters: FormattersInitializer<Locales, Formatters> = (_locale: Locales) => {
  const formatters: Formatters = {}
  return formatters
}
