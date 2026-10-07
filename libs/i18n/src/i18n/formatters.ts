import type { FormattersInitializer } from 'typesafe-i18n'
import type { Formatters, Locales } from './i18n-types.js'

/**
 * Per-locale formatters, referenced from a dictionary as `{value|name}`.
 * Add them here (Edible's `listAnd` / `listOr` are the
 * model) and `rushx generate` types them.
 */
export const initFormatters: FormattersInitializer<Locales, Formatters> = (locale: Locales) => {
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const formatters: Formatters = {
    /** A whole number with the locale's digit grouping: `2301` → "2,301". */
    int: (value: number) => grouped.format(value),
  }
  return formatters
}
