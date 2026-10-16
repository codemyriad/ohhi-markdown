/**
 * @ohhi/agent — the host-neutral command core behind the `ohhi` CLI and the
 * `ohhi mcp` server (agent-surface-shaping A1). Files-direct: reads
 * the canonical files through @ohhi/vault/node, indexes them with
 * @ohhi/index, journals every write. No relay, no CRDT, no second
 * reconciler — a running app ingests this tool's writes through its own
 * disk path.
 *
 * Node-only. A browser host imports `@ohhi/agent/core` (the contract, the
 * ops, the backend seam) and `@ohhi/agent/skills` (the loader) instead.
 */
export * from './core.js'
export { createFilesBackend, type FilesBackendOptions } from './backend.js'
export { resolveDataDir, resolveVault, vaultId, type SelectVaultOptions, type VaultSelection } from './select-vault.js'
