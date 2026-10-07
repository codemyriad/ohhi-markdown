/**
 * The browser-storage note (storage-persistence): the manager's note and the
 * once-per-session reminder, moved out of `App.svelte` in the shell mould —
 * a runes module over an explicit host (`shell-structure.md`).
 *
 * On the manager a browser vault is always at stake (creating, joining and
 * linking a device all make one), so the note shows whenever the browser
 * may evict; reopening straight into a browser vault gets one logged
 * reminder instead. Whichever surface comes first is the session's one.
 */
import {
  askToKeepStorage,
  initStorage,
  setStorageReminder,
  storageState,
  storageWarning,
} from './storage.svelte.js'

export interface StorageNoteHost {
  /** The vault manager is on screen. */
  onManager(): boolean
  /** This browser has OPFS (a browser vault is possible at all). */
  hasOpfs(): boolean
  /** The storage rules; absent → the live ones (`storage.svelte.ts`). */
  storage?: {
    ready: Promise<void>
    state: { readonly state: string; readonly refused: boolean }
    warning(browserVault: boolean): boolean
    ask(): Promise<void>
    setReminder(on: boolean): void
  }
}

export interface StorageNote {
  canAsk: boolean
  outcome: 'granted' | 'refused' | null
}

export function createStorageNote(host: StorageNoteHost) {
  const storage = host.storage ?? {
    ready: initStorage(), // the launch check-then-ask; a no-op under Tauri
    state: storageState,
    warning: storageWarning,
    ask: askToKeepStorage,
    setReminder: setStorageReminder,
  }
  /** The manager note's own ask was granted: the note stays up to say so. */
  let granted = $state(false)
  const note = $derived.by((): StorageNote | null => {
    if (granted) return { canAsk: false, outcome: 'granted' }
    if (!storage.warning(host.hasOpfs())) return null
    return { canAsk: storage.state.state === 'best-effort', outcome: storage.state.refused ? 'refused' : null }
  })

  let reminded = false
  $effect.root(() => {
    $effect(() => {
      if (host.onManager() && note) reminded = true
    })
  })

  return {
    /** What the manager's note says; null when there is nothing to say. */
    get note() {
      return note
    },
    keep(): void {
      // Straight from the click, so persist() carries the gesture (Firefox).
      void storage.ask().then(() => {
        if (storage.state.state === 'persisted') granted = true
      })
    },
    dismiss(): void {
      if (granted) granted = false
      else storage.setReminder(false)
    },
    /**
     * A browser vault opened straight from launch: one logged reminder, unless
     * the manager's note already said it — and only while `still()` is true.
     */
    async remind(notify: () => void, still: () => boolean = () => true): Promise<void> {
      await storage.ready
      if (reminded || !still() || !storage.warning(true)) return
      reminded = true
      notify()
    },
  }
}

export type StorageNoteShell = ReturnType<typeof createStorageNote>
