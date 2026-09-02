/**
 * Vault-level boot recovery (spike S8): before any mount session is created,
 * classify interrupted lifecycle transitions in mounts.json and execute their
 * recovery. M1 only ever writes 'active', so real transitions cannot exist
 * yet — but the seam is load-bearing: the carve/join/unshare flows (slices
 * M4/M5) write their statuses first and rely on boot running this.
 */
import type { MountsFile, StoreDir } from '@editor/vault'

export async function recoverMounts(vaultDir: StoreDir, mountsFile: MountsFile): Promise<void> {
  for (const { action, desc } of await mountsFile.recover()) {
    if (action === 'rollback') {
      // Spike Q1/Q4 rollback: the half-made mount's stores are derived state —
      // drop them and the entry; the parent map was never touched.
      for (const name of await vaultDir.list(`${desc.room}/`)) await vaultDir.remove(name)
      await mountsFile.removeMount(desc.room)
    } else {
      // TODO(M4/M5): roll-forward re-runs the remaining carve/unshare steps
      // (spike S8 Q1 step 5-6, Q6) — those flows don't exist yet, and M1
      // never writes these statuses, so this branch is unreachable today.
    }
  }
}
