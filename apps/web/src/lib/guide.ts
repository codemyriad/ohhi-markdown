/**
 * Where the guide pages live, and how one opens (first-run-shaping E4, Fork
 * 4-A): one entry point every surface that links to a guide goes through, so
 * the welcome, the join page, the relay card and the Help menu never
 * disagree about where "the guide" is.
 *
 * The pages are `docs/guide/*.md`, rendered by `scripts/build-guide.mjs` into
 * `public/guide/<page>.html`, which Vite copies into the build: served beside
 * the app on the team host (Caddy's `try_files` finds them before the SPA
 * fallback), and bundled into the desktop app with the rest of `dist/`.
 *
 * Opening one:
 *  - in a browser, a new tab (`noopener`, so the page holds no handle on the app);
 *  - on the desktop, a second Tauri window on the bundled copy — no opener
 *    plugin and `frame-src 'none'` in both policies, so neither the system
 *    browser nor an iframe. The main window's capability carries
 *    `core:webview:allow-create-webview-window` and `core:window:allow-set-focus`
 *    (`apps/desktop/src-tauri/capabilities/default.json`); the guide window
 *    itself is granted nothing (it runs no script). One window per page:
 *    asking again focuses it.
 */
import { getLL } from '@ohhi/i18n'
import { isTauri } from './platform.js'

export type GuidePage = 'start' | 'sharing' | 'recovery' | 'import' | 'relay' | 'customise' | 'agents' | 'changes'

/** Every page, in the guide's nav order (`scripts/build-guide.mjs` PAGE_ORDER says the same). */
export const GUIDE_PAGES: readonly GuidePage[] = [
  'start',
  'sharing',
  'recovery',
  'import',
  'relay',
  'customise',
  'agents',
  'changes',
]

/** The guide page's href, relative to the app's own origin. */
export function guideHref(page: GuidePage): string {
  return `/guide/${page}.html`
}

/** The window label a desktop guide page opens in (Tauri labels: `a-zA-Z-/:_`). */
export function guideWindowLabel(page: GuidePage): string {
  return `guide-${page}`
}

export interface GuideOpeners {
  desktop(): boolean
  /** A browser tab. */
  openTab(href: string): void
  /** A Tauri window on the bundled page. */
  openWindow(label: string, href: string, title: string): Promise<void>
}

async function openTauriWindow(label: string, href: string, title: string): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.setFocus()
    return
  }
  // A relative url resolves against the app's own origin: the bundled copy
  // on a release build, Vite's public/ under `tauri dev`.
  const url = /^https:/.test(href) ? href : href.replace(/^\//, '')
  const win = new WebviewWindow(label, { url, title, width: 760, height: 820 })
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve())
    void win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
  })
}

const DEFAULT_OPENERS: GuideOpeners = {
  desktop: isTauri,
  openTab: (href) => void window.open(href, '_blank', 'noopener'),
  openWindow: openTauriWindow,
}

export interface OpenGuideOptions {
  /**
   * Desktop only: read the page from this host (the team host, `TEAM_HOST`)
   * instead of the bundled copy. The update toast's *What changed* uses it:
   * the bundled page describes the RUNNING build, and the host serves the
   * release the update came from (ohhi-pull swaps the web app before it
   * publishes the update manifest). Off the host's network the window shows
   * the webview's own error page.
   */
  host?: string
  openers?: GuideOpeners
}

/** Open a guide page the platform's way (above). */
export async function openGuide(page: GuidePage, opts: OpenGuideOptions = {}): Promise<void> {
  const openers = opts.openers ?? DEFAULT_OPENERS
  const href = guideHref(page)
  if (!openers.desktop()) {
    openers.openTab(href)
    return
  }
  const url = opts.host ? `https://${opts.host}${href}` : href
  try {
    await openers.openWindow(guideWindowLabel(page), url, getLL().web.help.window_title())
  } catch (err) {
    console.info('[ohhi] guide window could not open', err)
  }
}
