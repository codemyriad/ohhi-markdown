export {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type FileRow,
  type MountEntryInfo,
  type MountEvents,
  type RelayConfig,
  type SyncRecordFields,
} from './types.js'
export { connectDoc, whenSynced, type ConnectDocOptions, type DocConnection } from './providers.js'
export {
  MountSession,
  type DocInspection,
  type MountSessionConfig,
  type MountStats,
} from './mount-session.js'
export { MountRegistry, type MountHandle, type ResolvedPath } from './registry.js'
export { absorbMount, recoverMounts } from './vault-boot.js'
export { carveFolder, type CarveOptions } from './carve.js'
export { joinMount, type JoinMountOptions } from './join.js'
export { unmountMount, unshareMount, type UnshareOptions } from './unshare.js'
