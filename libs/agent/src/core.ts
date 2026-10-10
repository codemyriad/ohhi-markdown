/**
 * `@ohhi/agent/core` — the browser-safe half of the command core: the
 * contract, the ops and `runOp`, the `VaultBackend` seam and the read
 * helpers. No Node import is reachable from here (no files backend, no
 * vault selection), so the in-app harness (`@ohhi/harness`, running in the
 * web bundle) runs the same ops `ohhi` runs. The package root adds the
 * Node-only pieces on top.
 */
export * from './contract.js'
export { openForRead, readNote, type VaultBackend, type VaultFile } from './read.js'
export { isOpName, OPS, runOp } from './ops/index.js'
export type { OpDef } from './op.js'
export { readFrontmatter, type FrontmatterRead } from './frontmatter-read.js'
export { fromIndexPage, paginate, type PageIn, type PageResult } from './paging.js'
