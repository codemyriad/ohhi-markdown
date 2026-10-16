/**
 * *Get the desktop app* (docs/public-deploy.md): the build's `downloads.json`
 * (`DOWNLOADS_URL` — dist.ohhi.md for the public flavour, the team host's
 * `/updates/` for the team one; scripts/downloads-manifest.mjs writes it),
 * read tolerantly, and the file that fits the computer the page runs on.
 *
 * Pure: the manifest, the navigator facts and the URL are arguments.
 * Offered only in a browser, and only when the build names a list — the
 * desktop app updates itself, and a build without a list has nowhere to send
 * anyone.
 */

export type DownloadOs = 'macos' | 'linux' | 'android' | 'windows' | 'ios'
export type DownloadKind = 'dmg' | 'appimage' | 'deb' | 'apk'

export interface DownloadFile {
  os: DownloadOs
  kind: DownloadKind
  arch: string
  name: string
  url: string
  /** Bytes; 0 when the manifest did not say. */
  size: number
  sha256: string
}

export interface DownloadsManifest {
  version: string
  /** ISO date of the release ('' when absent). */
  date: string
  files: DownloadFile[]
}

const KINDS: Readonly<Record<DownloadKind, DownloadOs>> = { dmg: 'macos', appimage: 'linux', deb: 'linux', apk: 'android' }

/** The order a computer's files are offered in: the first is the one to pick (the AppImage updates itself; the .deb does not). */
const PREFERENCE: readonly DownloadKind[] = ['dmg', 'appimage', 'deb', 'apk']

/**
 * A `downloads.json` as the app reads it, or null when it is not one. An
 * entry that is not a known kind with an `https:` URL is dropped, never the
 * whole list; a list with nothing usable left is null.
 */
export function parseDownloads(raw: unknown): DownloadsManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.schema !== 1 || typeof m.version !== 'string' || !m.version || !Array.isArray(m.files)) return null
  const files: DownloadFile[] = []
  for (const entry of m.files) {
    if (!entry || typeof entry !== 'object') continue
    const f = entry as Record<string, unknown>
    const kind = f.kind as DownloadKind
    if (!(kind in KINDS) || typeof f.url !== 'string' || typeof f.name !== 'string') continue
    if (!/^https:\/\/[^/\s]+\/\S+$/i.test(f.url)) continue
    files.push({
      os: KINDS[kind],
      kind,
      arch: typeof f.arch === 'string' ? f.arch : 'universal',
      name: f.name,
      url: f.url,
      size: typeof f.size === 'number' && f.size > 0 ? f.size : 0,
      sha256: typeof f.sha256 === 'string' ? f.sha256 : '',
    })
  }
  files.sort((a, b) => PREFERENCE.indexOf(a.kind) - PREFERENCE.indexOf(b.kind))
  return files.length ? { version: m.version, date: typeof m.date === 'string' ? m.date : '', files } : null
}

/** What the page can tell about the computer it runs on (`navigator`, or a test's stand-in). */
export interface NavigatorFacts {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  userAgentData?: { platform?: string } | null
}

/**
 * The visitor's OS, or null when it is none of ours. Android before Linux
 * (its user agent says both), iOS and iPadOS before macOS (an iPad asks for
 * the desktop site as "Macintosh" — with a touch screen no Mac has).
 */
export function detectOs(nav: NavigatorFacts): DownloadOs | null {
  const ua = nav.userAgent ?? ''
  const hint = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''}`.toLowerCase()
  if (/android/i.test(ua) || hint.includes('android')) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/macintosh|mac os x/i.test(ua) || hint.includes('mac')) return (nav.maxTouchPoints ?? 0) > 1 ? 'ios' : 'macos'
  if (/windows/i.test(ua) || hint.includes('win')) return 'windows'
  if (/linux|x11|cros/i.test(ua) || hint.includes('linux')) return 'linux'
  return null
}

/** The file to offer this OS first (null: nothing for it), and every other file. */
export function pickDownload(manifest: DownloadsManifest, os: DownloadOs | null): { primary: DownloadFile | null; others: DownloadFile[] } {
  const primary = (os && manifest.files.find((f) => f.os === os)) || null
  return { primary, others: manifest.files.filter((f) => f !== primary) }
}

/** Whether this build offers *Get the desktop app* at all: a browser, and a list to read. */
export function offersDesktopDownload(desktop: boolean, url: string): boolean {
  return !desktop && url !== ''
}
