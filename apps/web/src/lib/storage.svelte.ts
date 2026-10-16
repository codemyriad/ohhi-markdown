/**
 * The reactive copy of this browser's storage decision (the rules live in
 * `storage-persistence.ts`). Device-level, like the theme: the grant belongs
 * to the browser profile, not to a vault.
 */
import { setStorageNoticeDismissed, storageNoticeDismissed } from './config.js'
import { isDesktop, isTauri } from './platform.js'
import {
  browserStorage,
  ensurePersistence,
  estimateUsage,
  requestPersistence,
  shouldWarnAboutStorage,
  type PersistState,
  type StorageUsage,
} from './storage-persistence.js'

interface StorageStatus {
  state: PersistState
  usage: StorageUsage | null
  /** The note was dismissed on this device. */
  dismissed: boolean
  /** The user's own ask was refused — said once, calmly, where they asked. */
  refused: boolean
}

export const storageState = $state<StorageStatus>({
  state: 'unknown',
  usage: null,
  dismissed: storageNoticeDismissed(),
  refused: false,
})

/** Launch, browser only: read the browser's decision, and ask once if it has not agreed. */
export async function initStorage(): Promise<void> {
  // The phone app's vaults are in the webview's storage too, but nothing
  // there can be asked: the Android System WebView refuses `persist()`
  // every time, and the storage goes only with the app's data
  // (docs/mobile-android.md). So no ask and no warning, only the usage.
  if (isTauri()) return refreshStorageUsage()
  const state = await ensurePersistence()
  // A click may have answered while the launch check was in flight.
  if (storageState.state === 'unknown') storageState.state = state
  await refreshStorageUsage()
}

/**
 * Ask again. Call it synchronously from the click handler: `persist()` runs
 * before the first await, so Firefox sees the gesture.
 */
export async function askToKeepStorage(): Promise<void> {
  const state = await requestPersistence(browserStorage())
  storageState.state = state
  storageState.refused = state !== 'persisted'
  await refreshStorageUsage()
}

export async function refreshStorageUsage(): Promise<void> {
  if (isDesktop()) return
  storageState.usage = await estimateUsage(browserStorage())
}

/** `shouldWarnAboutStorage` against this device's live state. */
export function storageWarning(browserVault: boolean): boolean {
  const { state, dismissed } = storageState
  return shouldWarnAboutStorage({ tauri: isTauri(), browserVault, state, dismissed })
}

/** The per-device reminder switch (the manager's Dismiss, and its Settings checkbox). */
export function setStorageReminder(on: boolean): void {
  storageState.dismissed = !on
  setStorageNoticeDismissed(!on)
}
