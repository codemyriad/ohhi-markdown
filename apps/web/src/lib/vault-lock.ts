/**
 * One tab per browser vault (`plans/join-share-brief.md` P3, settled
 * 2026-10-16). Two tabs on the same OPFS vault each run a full session over
 * the same files with nothing between them — no relay for an unshared vault,
 * no watcher on OPFS — so the second tab opens on a stale copy, neither sees
 * the other's new notes, and the last tab to flush a note overwrites the
 * other's edit on disk (reproduced headless: "From tab A + A again" survived,
 * " + from tab B" did not). A shared vault fares little better: the relay
 * carries the CRDT, but the two tabs still race for the same file bytes and
 * the same durable stores.
 *
 * So a browser vault is CLAIMED for the tab's lifetime through the Web Locks
 * API, which every current browser has: the lock is released when the tab
 * closes or navigates, and `ifAvailable` answers at once instead of queueing.
 * A second tab is told the vault is open elsewhere (`session.boot`); it is
 * never silently opened. A browser without Web Locks is not guarded — the
 * helper says so by claiming unconditionally, so nothing is refused that the
 * browser cannot tell apart.
 *
 * The desktop app is one window per vault by construction (Tauri), and the
 * memory URL contract is a test harness: neither goes through here.
 */

/** The lock name a vault's session holds while open in a tab. */
export const vaultLockName = (id: string): string => `ohhi:vault:${id}`

/** The slice of `LockManager` this uses; a test hands in a fake. */
export interface VaultLocks {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<unknown> | unknown
  ): Promise<unknown>
}

/**
 * Claim the vault for this tab. Resolves with the release function when it
 * is free, or `null` when another tab holds it. The lock stays held until
 * `release()` runs or the tab goes away.
 */
export function claimVaultLock(
  id: string,
  locks: VaultLocks | undefined = (globalThis as { navigator?: { locks?: VaultLocks } }).navigator?.locks
): Promise<(() => void) | null> {
  if (!locks) return Promise.resolve(() => {})
  return new Promise((resolve) => {
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    locks
      .request(vaultLockName(id), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null)
          return
        }
        resolve(release)
        return held // the callback's promise is the lock's lifetime
      })
      .catch(() => resolve(() => {})) // a locks API that throws cannot guard either
  })
}
