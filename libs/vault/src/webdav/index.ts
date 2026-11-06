/** The WebDAV (Nextcloud Files) VaultAdapter (nextcloud-build NC2). */
export { DEFAULT_POLL_MS, WebDavVaultAdapter, type WalkStats, type WebDavAdapterOptions } from './adapter.js'
export { httpError, pathSegments, REFUSED_WRITE_STATUSES, WebDavPathError } from './errors.js'
export {
  DAV_PROPS,
  DAV_XMLNS,
  foreignReason,
  hrefToPath,
  parseMultistatus,
  parseXml,
  PROPFIND_BODY,
  type DavEntry,
  type XmlElement,
} from './propfind.js'
export {
  diffTables,
  walkTree,
  WalkRaceError,
  type DirRec,
  type FileRec,
  type HeldVanishes,
  type WalkDeps,
  type WalkTable,
} from './walk.js'
