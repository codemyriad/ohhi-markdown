export {
  FOLDER_RECORD_KEY,
  type CollabUser,
  type DocPeer,
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
  PEER_SETTLE_MS,
  RELAY_OFFLINE_MS,
  type DetachOptions,
  type DocInspection,
  type MountInspection,
  type MountSessionConfig,
  type MountStats,
  type PathInspection,
  type PathPeek,
  type PreImageInfo,
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
  bootFlagsFor,
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
export { resolveRoomRelay, roomRelayUrl, sameRelay, type TokenKind } from './resolve-relay.js'
export { carveFolder, type CarveOptions } from './carve.js'
export { joinMount, type JoinMountOptions } from './join.js'
export { unmountMount, unshareMount, type UnshareOptions } from './unshare.js'
export {
  EVENT_LOG_MAX_AGE_MS,
  EVENT_LOG_MAX_BYTES,
  EVENT_WRITE_DEBOUNCE_MS,
  EVENTS_SCHEMA_VERSION,
  RoomEventLog,
  parseEventsFile,
  type EventsFile,
  type RoomEventLogOptions,
} from './event-store.js'
export { attributeUpdate, relayHost, type AttributionInput } from './attribution.js'
export {
  CHANGE_KINDS,
  DOC_CHANGE_WINDOW_MS,
  EVENT_KINDS,
  EVENT_LOG_CAP,
  EventLog,
  RelayRefusedError,
  countUnread,
  filterEvents,
  mergeNewestFirst,
  upsertEvent,
  type Actor,
  type ActorKind,
  type AppEvent,
  type EventFilter,
  type EventInput,
  type EventKind,
  type EventLevel,
  type EventLogOptions,
  type EventParam,
  type EventPayloads,
  type EventScope,
} from './events.js'
export {
  nothingShared,
  relayInSync,
  sharedSnapshot,
  type InSyncSpan,
  type RelayState,
  type RelayTokenInput,
  type SharedMountInput,
  type SharedPerson,
  type SharedSnapshot,
  type SharedSnapshotInput,
} from './shared-snapshot.js'
