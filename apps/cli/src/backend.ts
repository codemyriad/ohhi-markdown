/**
 * The seam onto `@ohhi/agent`. Vault selection and backend construction are
 * the ONLY places the CLI touches the core's constructors — everything else
 * goes through `OPS[op].run(backend, input)`.
 *
 * Golden rule 5: the core takes an injected clock; the CLI is the host, so
 * the CLI is where the real one is built.
 */
import { createFilesBackend, resolveDataDir, resolveVault, type VaultBackend, type VaultSelection } from '@ohhi/agent'
import { RealClock } from './clock.js'
import type { Globals } from './grammar.js'
import type { Io } from './io.js'

export type Backend = VaultBackend

/**
 * `--vault` → `$OHHI_VAULT` → walk up from cwd for `.ohhi/` or
 * `.obsidian/`. Ambiguity and absence are both `OpError('usage')` (exit 2) —
 * the CLI never guesses which vault you meant (R8).
 *
 * `onSelection` gets the selection so the caller can say, on stderr, which
 * vault a walk-up picked. The answer on stdout never depends on it.
 */
export async function openVault(
  globals: Globals,
  io: Io,
  onSelection?: (selection: VaultSelection) => void
): Promise<Backend> {
  const selection = await resolveVault({ vault: globals.vault, env: io.env, cwd: io.cwd })
  onSelection?.(selection)
  return createFilesBackend({
    root: selection.root,
    dataDir: globals.dataDir ?? resolveDataDir(io.env),
    clock: new RealClock(),
    appStoreDirs: globals.appStore.length > 0 ? globals.appStore : undefined,
  })
}
