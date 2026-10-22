/**
 * HTTP status → the typed errors of `types.ts` (nextcloud-build decision 9).
 * Every error names the VAULT-RELATIVE path, never the URL: a WebDAV URL with
 * a path never reaches a log (decision 15).
 */
import { WebDavError, WriteRefusedError } from '../types.js'

/**
 * Statuses a write is refused with for a reason that may clear later — a lock,
 * a lost permission, a full quota, a forbidden name (decision 8).
 */
export const REFUSED_WRITE_STATUSES: ReadonlySet<number> = new Set([400, 403, 423, 507])

/** The error for an unexpected status. `write` selects the refusal class. */
export function httpError(method: string, path: string, status: number, write: boolean): WebDavError {
  if (write && REFUSED_WRITE_STATUSES.has(status)) return new WriteRefusedError(status, method, path)
  return new WebDavError(status, method, path)
}

/** A path that would leave the base collection (decision 12). Never sent. */
export class WebDavPathError extends Error {
  override readonly name = 'WebDavPathError'
  constructor(readonly path: string) {
    super(`webdav: path escapes the vault: ${JSON.stringify(path)}`)
  }
}

/**
 * A vault-relative path's segments, refusing any that could leave the base
 * once joined into a URL: empty (`a//b`), `.`, `..`, or one holding NUL.
 * Every WebDAV URL built from a path — the adapter's and the ExApp's own
 * client's — goes through here (decision 12).
 */
export function pathSegments(path: string): string[] {
  const segs = path.split('/')
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || s.includes('\0')) throw new WebDavPathError(path)
  }
  return segs
}
