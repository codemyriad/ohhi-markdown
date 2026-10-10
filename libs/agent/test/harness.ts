/**
 * The fixture vault, wired to a backend. Kept apart from `fixture.ts` because
 * that file must import nothing but node built-ins (`apps/cli` imports it);
 * this one is free to reach for `@ohhi/*`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SimClock } from '@ohhi/testkit'
import type { WriteOptions } from '@ohhi/vault'
import { createFilesBackend, type VaultBackend } from '../src/backend.js'
import { makeFixtureVault, type FixtureVault } from './fixture.js'

export interface Harness extends FixtureVault {
  backend: VaultBackend
  clock: SimClock
  /** Raw bytes on disk, for byte-identity assertions. */
  bytes(path: string): Promise<Uint8Array>
  text(path: string): Promise<string>
}

export async function harness(opts: { appStoreDirs?: string[] } = {}): Promise<Harness> {
  const vault = await makeFixtureVault()
  const clock = new SimClock()
  // Anchored to real time ONCE, then frozen: the fixture's files carry real
  // filesystem mtimes, and `changes` unions those with journal stamps — the
  // two have to come from the same clock domain or a 1970 journal looks older
  // than every file in the vault. Time still never moves unless a test moves it.
  clock.advance(Date.now()) // clock-exempt: anchors the sim clock to the filesystem's domain
  const backend = await createFilesBackend({ root: vault.root, dataDir: vault.dataDir, clock, ...opts })
  return {
    ...vault,
    backend,
    clock,
    bytes: async (path) => new Uint8Array(await readFile(join(vault.root, path))),
    text: async (path) => readFile(join(vault.root, path), 'utf8'),
  }
}

/** A backend over the same vault as `h`, with a fresh cache (a second invocation). */
export const reopen = (h: Harness, opts: { appStoreDirs?: string[] } = {}): Promise<VaultBackend> =>
  createFilesBackend({ root: h.root, dataDir: h.dataDir, clock: h.clock, ...opts })

/**
 * Arm the adapter so that the next atomic write to `path` is preceded by a
 * "human" save of `theirText` to the same file — landing after the op has
 * read the note and journaled its pre-image, a moment before the rename. The
 * narrowest window there is, and the only one a caller-side re-read cannot
 * close (Spike S11 finding F1). Returns nothing: the point is what the op
 * does, not what the hook did.
 */
export function raceTheWrite(h: Harness, path: string, theirText: string): void {
  const real = h.backend.adapter.writeAtomic.bind(h.backend.adapter)
  let armed = true
  ;(h.backend.adapter as { writeAtomic: unknown }).writeAtomic = async (
    p: string,
    bytes: Uint8Array,
    opts?: WriteOptions
  ): Promise<void> => {
    if (armed && p === path) {
      armed = false
      await writeFile(join(h.root, path), theirText, 'utf8')
    }
    await real(p, bytes, opts)
  }
}
