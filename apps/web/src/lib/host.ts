/**
 * Which host the shell is running in, decided from the environment and never
 * from a global a page could forge (nextcloud-build decision 1):
 *
 *   - `tauri`     — the desktop shell (`window.__TAURI_INTERNALS__`, platform.ts)
 *   - `nextcloud` — the web build served by the Oh Hi ExApp inside an iframe on
 *                   AppAPI's embedded page, at `/exapps/ohhi/ui/`; the relay is
 *                   the same container's WebSocket and the API sits beside it
 *   - `browser`   — anything else (the hosted web app, `vite dev`, Playwright)
 *
 * Also the per-user storage namespace (decision 16): inside Nextcloud every
 * account on the instance shares one browser origin, so `localStorage` keys
 * and OPFS ids carry the Nextcloud uid. Outside Nextcloud the namespace is ''
 * and every key is exactly what it was.
 */
import { isTauri } from './platform.js'

export type HostKind = 'browser' | 'tauri' | 'nextcloud'

export interface HostDesc {
  kind: HostKind
  /** The ExApp's JSON API base (`/exapps/ohhi/api`), Nextcloud only. */
  apiBase?: string
  /** The relay this host MUST use (the ExApp's `/ws`), Nextcloud only. */
  relayUrl?: string
}

/** The ExApp id, fixed by `appinfo/info.xml`; the UI is served under it. */
export const NEXTCLOUD_APP_ID = 'ohhi'
export const NEXTCLOUD_UI_PREFIX = `/exapps/${NEXTCLOUD_APP_ID}/ui/`

type LocationLike = Pick<Location, 'pathname' | 'protocol' | 'host'>

export function detectHost(loc: LocationLike | null = typeof location !== 'undefined' ? location : null): HostDesc {
  if (isTauri()) return { kind: 'tauri' }
  if (loc && loc.pathname.startsWith(NEXTCLOUD_UI_PREFIX)) {
    const scheme = loc.protocol === 'https:' ? 'wss' : 'ws'
    return {
      kind: 'nextcloud',
      apiBase: `/exapps/${NEXTCLOUD_APP_ID}/api`,
      relayUrl: `${scheme}://${loc.host}/exapps/${NEXTCLOUD_APP_ID}/ws`,
    }
  }
  return { kind: 'browser' }
}

let namespace = ''

/** '' outside Nextcloud; the Nextcloud uid inside, once the host learned it. */
export function storageNamespace(): string {
  return namespace
}

/** Set once at boot, BEFORE the first config read, by the Nextcloud host. */
export function setStorageNamespace(ns: string): void {
  namespace = ns
}

/** A `localStorage` key under the current namespace (identity outside Nextcloud). */
export function nsKey(key: string): string {
  return namespace ? `nc:${namespace}:${key}` : key
}

/** An OPFS directory id under the current namespace (identity outside Nextcloud). */
export function nsId(id: string): string {
  return namespace ? `nc-${namespace}--${id}` : id
}
