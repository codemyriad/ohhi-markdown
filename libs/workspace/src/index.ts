export {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type FileRow,
  type MountEntryInfo,
  type MountEvents,
  type PullProgress,
  type RelayConfig,
  type SyncRecordFields,
} from './types.js'
export {
  connectDoc,
  createRoomSocket,
  whenSynced,
  DEFAULT_STALL_MS,
  ProgressTracker,
  type ConnectDocOptions,
  type DocConnection,
  type ProgressSnapshot,
  type ProgressTrackerOptions,
  type RoomSocket,
  type RoomSocketOptions,
  type WhenSyncedOptions,
} from './providers.js'
export {
  MAX_SEED_BYTES,
  MountSession,
  type DetachOptions,
  type DocInspection,
  type MountSessionConfig,
  type MountStats,
  type SeedOptions,
  type SeedResult,
} from './mount-session.js'
export { MountRegistry, type MountHandle, type ResolvedPath } from './registry.js'
export {
  absorbMount,
  recoverMounts,
  rollforwardDetach,
  type AbsorbOptions,
} from './vault-boot.js'
export {
  mountInvariants,
  mountStoreInvariants,
  reconcileMountEntries,
  sweepGhosts,
  type AdoptContext,
  type AdoptedMountOptions,
  type AdoptNotice,
  type AdoptNoticeKind,
} from './adopt.js'
export { activateMount, type ActivateMountOptions } from './activate.js'
export { carveFolder, type CarveOptions } from './carve.js'
export { joinMount, type JoinMountOptions } from './join.js'
export { unmountMount, unshareMount, type UnshareOptions } from './unshare.js'
