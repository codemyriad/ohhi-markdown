/**
 * The desktop downloads list, fetched once per page on first need (Settings ›
 * About, the browser-storage note) — never at launch, and never in the
 * desktop app or a build without `DOWNLOADS_URL` (`offersDesktopDownload`).
 *
 * The request carries no cookies and no referrer; a list that does not
 * answer, or answers with something that is not one, is `failed`, and the
 * surfaces say so (About) or stay quiet (the note).
 */
import { DOWNLOADS_URL } from './config.js'
import { detectOs, offersDesktopDownload, parseDownloads, pickDownload, type DownloadFile, type DownloadsManifest } from './downloads.js'
import { isTauri } from './platform.js'

export type DownloadsStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface DesktopDownloadsHost {
  url: string
  desktop(): boolean
  fetch?: typeof fetch
  navigator?: () => Parameters<typeof detectOs>[0]
}

export function createDesktopDownloads(host: DesktopDownloadsHost) {
  let status = $state<DownloadsStatus>('idle')
  let manifest = $state<DownloadsManifest | null>(null)
  const nav = host.navigator ?? (() => globalThis.navigator)

  const pick = $derived(manifest ? pickDownload(manifest, detectOs(nav())) : { primary: null, others: [] as DownloadFile[] })

  return {
    /** Offered at all in this build, here (a browser with a list to read). */
    offered(): boolean {
      return offersDesktopDownload(host.desktop(), host.url)
    },
    get status(): DownloadsStatus {
      return status
    },
    get manifest(): DownloadsManifest | null {
      return manifest
    },
    /** The file for this computer (null: none fits it) and the rest. */
    get pick() {
      return pick
    },
    /** Fetch the list, once; a failed fetch may be retried by calling again. */
    load(): Promise<void> {
      if (!this.offered() || status === 'loading' || status === 'ready') return Promise.resolve()
      status = 'loading'
      const get = host.fetch ?? globalThis.fetch.bind(globalThis)
      return get(host.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          manifest = parseDownloads(json)
          status = manifest ? 'ready' : 'failed'
        })
        .catch(() => {
          status = 'failed'
        })
    },
  }
}

export type DesktopDownloads = ReturnType<typeof createDesktopDownloads>

/** The page's one list. */
export const desktopDownloads = createDesktopDownloads({ url: DOWNLOADS_URL, desktop: isTauri })
