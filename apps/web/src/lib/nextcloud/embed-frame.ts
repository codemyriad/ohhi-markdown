/**
 * What the embedded page's registered script does (nextcloud-build decision
 * 1), as functions a test can drive without a real Nextcloud page. The
 * script itself is `src/embed.ts`, built into ONE classic IIFE by
 * `vite.embed.config.ts`: AppAPI's page CSP is `script-src-elem
 * 'strict-dynamic' 'nonce-…'`, so only the registered script carries the
 * nonce and anything it loaded dynamically would be refused. It therefore
 * loads nothing — it fills the page with an `<iframe>` of the ordinary web
 * build, which the container serves with OUR CSP.
 */
import { NEXTCLOUD_UI_PREFIX } from '../host.js'

/** Where the container serves the web build (`--base /exapps/ohhi/ui/`). */
export const EMBED_FRAME_PATH = `${NEXTCLOUD_UI_PREFIX}index.html`

/** The only launch parameters the shell takes from the embedding page (`host-boot.ts`'s `NcLaunch`). */
export const FRAME_PARAMS = ['fileIds', 'open'] as const

/**
 * The iframe's address: the web build plus the launch parameters from the
 * page's query (`?fileIds=` from Files, `?open=`) — those two only. Anything
 * else on the page's URL (`mode=`, `relay=`, …) is not the embedding page's
 * to set for the shell.
 */
export function frameSrc(search: string): string {
  const from = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const to = new URLSearchParams()
  for (const key of FRAME_PARAMS) {
    const value = from.get(key)
    if (value !== null) to.set(key, value)
  }
  const q = to.toString()
  return q ? `${EMBED_FRAME_PATH}?${q}` : EMBED_FRAME_PATH
}

/**
 * The innermost `#content`: AppAPI's embedded page nests a second
 * `<div id="content">` inside `#content.app-app_api`. The LEAF — one holding
 * no further `#content` — is the app's container; else the last match, else
 * `<body>` (Cassini's `ensureShadowAppRoot`, the same rule).
 */
export function mountTarget(doc: Document): HTMLElement {
  const all = Array.from(doc.querySelectorAll<HTMLElement>('#content'))
  return all.filter((el) => el.querySelector('#content') === null).pop() ?? all[all.length - 1] ?? doc.body
}

/**
 * Nextcloud styles every `#content` as the app panel (fixed, header offset,
 * container margins): an ID selector matches BOTH nested divs, so the inner
 * one re-applies the chrome inside the outer's — a second header gap and a
 * cut-off bottom (Cassini D-517). The inner one should simply fill the outer,
 * which is position:fixed and so a containing block. A no-op unless the
 * target really is a nested `#content`.
 */
export function fillNestedContent(doc: Document, target: HTMLElement): boolean {
  const all = Array.from(doc.querySelectorAll<HTMLElement>('#content'))
  if (all.length < 2 || target === all[0] || target.id !== 'content') return false
  const s = target.style
  s.position = 'absolute'
  s.inset = '0'
  s.margin = '0'
  s.width = 'auto'
  s.height = 'auto'
  s.borderRadius = '0'
  s.overflow = 'hidden'
  return true
}

/** Fill the embedded page with the shell's iframe. Idempotent; returns the frame. */
export function mountFrame(doc: Document, search: string): HTMLIFrameElement {
  const existing = doc.getElementById('ohhi-frame')
  if (existing instanceof HTMLIFrameElement) return existing
  const target = mountTarget(doc)
  fillNestedContent(doc, target)
  const frame = doc.createElement('iframe')
  frame.id = 'ohhi-frame'
  frame.src = frameSrc(search)
  frame.setAttribute('style', 'border:0;width:100%;height:100%;display:block')
  frame.setAttribute('allow', 'clipboard-read; clipboard-write')
  frame.title = 'Oh Hi'
  target.replaceChildren(frame)
  return frame
}
