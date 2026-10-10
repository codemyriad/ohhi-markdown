/** Shared by `mv` and `rm`: what is at a path, how big it is, and the breaker. */
import { OpError } from '../contract.js'
import type { VaultBackend } from '../read.js'
import { isUnder } from '../paths.js'

/**
 * The app's mass-change breaker fires at 20 paths in one watch batch
 * (`DEFAULT_THRESHOLDS.massChangePaths`). This surface refuses at the same
 * number rather than tripping it: an agent that meant to move one folder
 * should be told, not have Editor raise a review at the user (shaping A5).
 */
export const MASS_CHANGE_PATHS = 20

export function requireConfirmation(files: number, yes: boolean, what: string): void {
  if (files > MASS_CHANGE_PATHS && !yes) {
    throw new OpError('refused', `${what} needs --yes (more than ${MASS_CHANGE_PATHS})`, { files })
  }
}

export async function resolveTarget(
  backend: VaultBackend,
  path: string
): Promise<{ kind: 'file' | 'dir' }> {
  const files = await backend.files()
  if (files.has(path)) return { kind: 'file' }
  if ((await backend.dirs()).includes(path)) return { kind: 'dir' }
  throw new OpError('not_found', `no such note or folder: ${path}`, { path })
}

/** Every file at or under a path, sorted — `.length` is the breaker's count. */
export async function filesUnder(backend: VaultBackend, path: string): Promise<string[]> {
  const files = await backend.files()
  return [...files.keys()].filter((candidate) => isUnder(path, candidate)).sort()
}
