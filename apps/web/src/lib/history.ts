/**
 * How the History rail section prints a pre-image (W3).
 *
 * The journal records bytes and a time — nothing about who or why — so these
 * two functions are the whole presentation layer, and they are pure so the
 * section stays a renderer (the `tree-status.ts` / `share-status.ts` shape).
 * "Now" is a parameter, not a `Date.now()` call: golden rule 5 reaches this
 * far, and "was that today?" is exactly the kind of thing a test must pin.
 */
import { getLL } from '@editor/i18n'

/**
 * `14:37` for a version from today, `10 Sep 14:37` for an older one.
 *
 * Formatted by `Intl` in the viewer's own locale rather than through the
 * dictionary: a month name here is locale DATA (the same reason a filename's
 * date is not a key), and `Intl` already follows the locale `detectLocale`
 * picked.
 */
export function formatStamp(at: number, now: number): string {
  const then = new Date(at)
  const today = new Date(now)
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate()
  if (sameDay) return time
  return `${then.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

/**
 * A version's size in the smallest honest unit. A 0-byte pre-image is real —
 * it is what `createFile` journals for a note that did not exist yet — so it
 * counts as bytes rather than being hidden.
 */
export function formatSize(size: number): string {
  const t = getLL().web.history
  if (size < 1024) return t.bytes({ count: size })
  return t.kilobytes({ size: (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) })
}
