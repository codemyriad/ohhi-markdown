/**
 * @editor/agent — the host-neutral command core behind the `ohhi` CLI and the
 * `ohhi mcp` server (plans/agent-surface-shaping.md A1). Files-direct: reads
 * the canonical files through @editor/vault/node, indexes them with
 * @editor/index, journals every write. No relay, no CRDT, no second
 * reconciler — a running app ingests this tool's writes through its own
 * disk path.
 */
export * from './contract.js'
