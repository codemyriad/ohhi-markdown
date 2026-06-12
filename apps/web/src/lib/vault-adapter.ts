/** VaultAdapter factory for the web shell. */
import { MemVaultAdapter, type VaultAdapter } from '@editor/vault'

export type VaultMode = 'memory' | 'tauri'

export function createVaultAdapter(mode: VaultMode): VaultAdapter {
  switch (mode) {
    case 'memory':
      return new MemVaultAdapter()
    case 'tauri':
      // TODO(separate task): TauriVaultAdapter over @tauri-apps/plugin-fs —
      // watchImmediate, atomic temp+fsync+rename, ignore list. Lands with the
      // apps/desktop slice; ?mode=tauri is wired here when it does.
      throw new Error('mode=tauri: TauriVaultAdapter not implemented yet (lands with apps/desktop)')
  }
}
