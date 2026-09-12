/**
 * @editor/agent — the host-neutral command core behind the `ohhi` CLI and the
 * `ohhi mcp` server (plans/agent-surface-shaping.md A1). Files-direct: reads
 * the canonical files through @editor/vault/node, indexes them with
 * @editor/index, journals every write. No relay, no CRDT, no second
 * reconciler — a running app ingests this tool's writes through its own
 * disk path.
 */
export * from './contract.js'
export { createFilesBackend, readNote, type FilesBackendOptions, type VaultBackend, type VaultFile } from './backend.js'
export { resolveDataDir, resolveVault, vaultId, VAULT_MARKERS, type SelectVaultOptions, type VaultSelection } from './select-vault.js'
export { isOpName, OPS, runOp } from './ops/index.js'
export type { OpDef } from './op.js'
export { readFrontmatter, type FrontmatterRead } from './frontmatter-read.js'
export { MASS_CHANGE_PATHS } from './ops/move.js'
