/**
 * VaultAdapter + StoreDir factories for the web shell — build the right
 * backends for a vault source (onboarding-shaping.md A2/A7; spike S8 store
 * layout). The Tauri and OPFS modules are dynamically imported so a plain
 * browser never pulls the @tauri-apps modules into its bundle path, and vice
 * versa.
 */
import {
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  wipeStoreDir,
  type StoreDir,
  type VaultAdapter,
} from '@ohhi/vault'
import type { VaultEntry, VaultSourceDesc } from './config.js'

export async function buildAdapter(source: VaultSourceDesc): Promise<VaultAdapter> {
  switch (source.kind) {
    case 'memory':
      return new MemVaultAdapter()
    case 'tauri': {
      const { TauriVaultAdapter } = await import('./adapters/tauri-vault-adapter.js')
      return new TauriVaultAdapter(source.path)
    }
    case 'opfs': {
      const { createOpfsVaultAdapter } = await import('./adapters/opfs-vault-adapter.js')
      return await createOpfsVaultAdapter(source.id)
    }
  }
}

/**
 * The vault's durable store namespace (`stores/<room>` on the platform's
 * app-data/OPFS root). Memory mode gets a fresh in-memory dir per boot, so
 * the dev/e2e URL contract always fresh-boots — exactly its pre-M1 behavior.
 */
export async function buildStoreDir(source: VaultSourceDesc, room: string): Promise<StoreDir> {
  switch (source.kind) {
    case 'memory':
      return new MemStoreDir()
    case 'tauri': {
      const { createTauriStoreDir } = await import('./store-dirs/tauri-store-dir.js')
      return await createTauriStoreDir(room)
    }
    case 'opfs': {
      const { createOpfsStoreDir } = await import('./store-dirs/opfs-store-dir.js')
      return await createOpfsStoreDir(room)
    }
  }
}

/**
 * The vault's store namespace if it already exists on this device, else
 * null — a READ that never creates `stores/<room>` (first-run B1's row
 * facts). `buildStoreDir` creates the directory, which is right for a boot
 * but wrong for a glance: reading every row's facts would leave a skeleton
 * behind for each, and racing `forgetVaultState` could recreate a namespace
 * just wiped. Memory mode has no durable namespace: null.
 */
export async function openStoreDirIfExists(source: VaultSourceDesc, room: string): Promise<StoreDir | null> {
  switch (source.kind) {
    case 'memory':
      return null
    case 'tauri': {
      const { openTauriStoreDirIfExists } = await import('./store-dirs/tauri-store-dir.js')
      return await openTauriStoreDirIfExists(room)
    }
    case 'opfs': {
      const { openOpfsStoreDirIfExists } = await import('./store-dirs/opfs-store-dir.js')
      return await openOpfsStoreDirIfExists(room)
    }
  }
}

/**
 * Forget a vault's SYNC STATE: delete its entire store namespace
 * (`stores/<room>` — mounts.json plus every mount's subnamespace) so the next
 * open of the same folder enrolls fresh under a new room. Disk `.md` files
 * are never touched — the stores are derived state (spike S8). For OPFS
 * vaults the vault CONTENT dir is deleted too: those files live only inside
 * OPFS, and with the registry entry gone the dir would be unreachable
 * orphaned storage with no affordance to ever see it again.
 *
 * Returns every room whose config residue (tokens, remembered shares) should
 * be purged: the vault's root room plus any mount rooms found in mounts.json.
 * mounts.json is read BEFORE the wipe; if that read fails, the mount rooms'
 * tokens are left behind — inert, since revocation happens relay-side.
 */
export async function forgetVaultState(entry: VaultEntry): Promise<string[]> {
  const rooms = [entry.room]
  if (entry.vault.kind === 'memory') return rooms // per-boot stores; nothing durable
  const dir = await buildStoreDir(entry.vault, entry.room)
  try {
    const mounts = await new MountsFile(dir.io('mounts.json')).load()
    for (const m of mounts) if (!rooms.includes(m.room)) rooms.push(m.room)
  } catch {
    /* unreadable mounts.json — wipe proceeds; mount tokens stay (inert) */
  }
  // Files first (the generic seam), then the platform helper drops the
  // now-empty directory skeleton the file-level interface can't see.
  await wipeStoreDir(dir)
  if (entry.vault.kind === 'tauri') {
    const { destroyTauriStoreDir } = await import('./store-dirs/tauri-store-dir.js')
    await destroyTauriStoreDir(entry.room)
  } else if (entry.vault.kind === 'opfs') {
    const { destroyOpfsStoreDir } = await import('./store-dirs/opfs-store-dir.js')
    await destroyOpfsStoreDir(entry.room)
    const { removeOpfsVaultContent } = await import('./adapters/opfs-vault-adapter.js')
    await removeOpfsVaultContent(entry.vault.id)
  }
  return rooms
}
