/**
 * Locale boot for the shell — the client half of Edible's `+layout.ts` load,
 * in the shape its non-SvelteKit `menu-embed` bundle uses: detect, load the
 * root dictionary and the app's namespace, then `setLocale`. `main.ts` awaits
 * this before mounting, so no component ever renders the fallback proxy.
 *
 * One locale ships today; `detectLocale` already narrows the navigator's
 * languages to what `locales` lists, so adding `fr/` is a dictionary and a
 * regenerate, not a boot change. A persisted preference (Edible's
 * `localePreferenceStore`) belongs in `config.ts` beside the theme when there
 * is something to prefer.
 */
import { setLocale } from '@ohhi/i18n/i18n-svelte'
import { detectLocale } from '@ohhi/i18n/i18n-util'
import { loadLocaleAsync, loadNamespaceAsync } from '@ohhi/i18n/i18n-util.async'
import type { Locales } from '@ohhi/i18n'
import { navigatorDetector } from 'typesafe-i18n/detectors'

export async function initI18n(): Promise<Locales> {
  const locale = detectLocale(navigatorDetector)
  await loadLocaleAsync(locale)
  await loadNamespaceAsync(locale, 'web')
  setLocale(locale)
  return locale
}
