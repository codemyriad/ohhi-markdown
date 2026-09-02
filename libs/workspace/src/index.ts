export {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type FileRow,
  type MountEvents,
  type RelayConfig,
  type SyncRecordFields,
} from './types.js'
export { connectDoc, whenSynced, type ConnectDocOptions, type DocConnection } from './providers.js'
export { MountSession, type MountSessionConfig } from './mount-session.js'
export { MountRegistry, type MountHandle, type ResolvedPath } from './registry.js'
export { recoverMounts } from './vault-boot.js'
