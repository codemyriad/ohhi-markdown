/**
 * The Nextcloud host's boot (nextcloud-build decisions 1, 4, 16): run by
 * `main.ts` BEFORE the first config read, because every `localStorage` key
 * and OPFS id in this host carries the Nextcloud uid and the uid is only
 * known once `GET /api/me` answered.
 *
 * Outside Nextcloud this does nothing and answers null. Inside it, it learns
 * who is signed in, sets the storage namespace, and reads the launch
 * parameters the embedded page passed through (`?fileIds=` from the Files
 * menu, `?open=` for a note). The result is kept here for `App.svelte`.
 */
import { detectHost, setStorageNamespace, type HostDesc } from '../host.js'
import { createNcApi, ncErrorText, parseFileId, type NcApi, type NcMe } from './api.js'

/** What the Files menu or a link asked for at launch. */
export interface NcLaunch {
  /** The first of `?fileIds=` — a folder's Nextcloud file id. */
  fileId: number | null
  /** `?open=` — a vault-relative note path to select once the vault is open. */
  open: string | null
}

export interface NcHost {
  api: NcApi
  /** Who is signed in; null when `/api/me` failed (`error` says why). */
  me: NcMe | null
  error: string | null
  launch: NcLaunch
}

/**
 * The namespace used when the uid could not be learned: never a real uid
 * (Nextcloud uids cannot contain `?`), so nothing this boot writes lands in
 * the un-namespaced keys another user of the same origin would read.
 */
export const UNKNOWN_NAMESPACE = '?'

/** `?fileIds=12,13&open=a/b.md` → the launch; anything malformed reads as absent. */
export function parseLaunch(search: string): NcLaunch {
  const q = new URLSearchParams(search)
  const fileId = parseFileId((q.get('fileIds') ?? q.get('fileId') ?? '').split(',')[0] ?? '')
  const rawOpen = q.get('open')?.trim() ?? ''
  // Vault-relative only: no leading slash, no `..`/`.` segments, no backslash.
  const segments = rawOpen.split('/')
  const open =
    rawOpen && !rawOpen.startsWith('/') && !rawOpen.includes('\\') && segments.every((s) => s && s !== '.' && s !== '..')
      ? rawOpen
      : null
  return { fileId, open }
}

let current: NcHost | null = null

/** The Nextcloud host as booted, or null in any other host. */
export function nextcloudHost(): NcHost | null {
  return current
}

/** Run once, before the first config read. Null outside Nextcloud. */
export async function prepareNextcloudHost(
  host: HostDesc = detectHost(),
  search: string = typeof location !== 'undefined' ? location.search : '',
  fetchFn?: typeof fetch
): Promise<NcHost | null> {
  if (host.kind !== 'nextcloud' || !host.apiBase) return null
  const api = createNcApi(host.apiBase, fetchFn)
  const launch = parseLaunch(search)
  try {
    const me = await api.me()
    if (!me || typeof me.uid !== 'string' || me.uid === '') throw new Error('no uid')
    setStorageNamespace(me.uid)
    current = { api, me: { uid: me.uid, displayName: me.displayName || me.uid }, error: null, launch }
  } catch (err) {
    setStorageNamespace(UNKNOWN_NAMESPACE)
    current = { api, me: null, error: ncErrorText(err), launch }
  }
  return current
}

/** Tests only: forget the booted host. */
export function resetNextcloudHost(): void {
  current = null
}
