/**
 * VaultAdapter + StoreDir factories for the web shell — build the right
 * backends for a vault source (onboarding-shaping.md A2/A7; spike S8 store
 * layout). The Tauri and OPFS modules are dynamically imported so a plain
 * browser never pulls the @tauri-apps modules into its bundle path, and vice
 * versa.
 */
import { MemStoreDir, MemVaultAdapter, type StoreDir, type VaultAdapter } from '@editor/vault'
import type { VaultSourceDesc } from './config.js'

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
