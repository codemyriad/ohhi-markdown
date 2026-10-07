export * from './types.js'
export { computeMergeHunks, tryCleanMerge, type MergeHunk } from './diff3.js'
export { decodeFile, renderFile, type DecodedText } from './eol.js'
export { hashBytes, hashText } from './hash.js'
export { MemVaultAdapter } from './mem-adapter.js'
export { AppDirListeners } from './app-dir.js'
export { ignoringAdapter, scopedAdapter } from './adapter-wrappers.js'
export {
  JsonFileLcaStore,
  MemJournal,
  MemLcaStore,
  type StoreIo,
  type StoreIoBinding,
} from './stores.js'
export {
  enrollFolder,
  joinFolder,
  looksBinary,
  NEVER_ON_DISK,
  type EnrollResult,
  type JoinProblem,
} from './enrollment.js'
export {
  reconcileFile,
  resolveDivergence,
  rememberFlush,
  type ReconcileContext,
} from './reconciler.js'
export {
  VaultSession,
  type Clock,
  type SessionEvents,
  type VaultSessionOptions,
} from './session.js'
export { MemStoreDir, scopedStoreDir, wipeStoreDir, type StoreDir } from './store-dir.js'
export {
  BlobDocStore,
  docBlobName,
  FOLDER_DOC_KEY,
  lcaGuard,
  type DocBlobStat,
  type DocStore,
} from './doc-store.js'
export { FileJournal } from './file-journal.js'
export {
  isRecoverable,
  MountsFile,
  mountRootsFrom,
  type MountDesc,
  type MountProvenance,
  type MountRecovery,
  type MountStatus,
  type RecoverableMountStatus,
} from './mounts-file.js'
