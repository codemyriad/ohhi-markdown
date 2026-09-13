/**
 * Which vault, and where this tool keeps its own state (shaping R8 —
 * "installable, multi-vault, NEVER GUESSING").
 *
 * Three ways to say which vault, in this order: `--vault`, `OHHI_VAULT`, or a
 * walk up from the working directory for a folder holding `.editor/` or
 * `.obsidian/`. Two markers on the walk is an AMBIGUITY, not a tie to break:
 * a vault inside a vault is a real shape (an Obsidian vault checked into a
 * repo that is itself a vault), and picking one silently is how an agent
 * writes a note into the wrong one. Both candidates are named and the caller
 * is told to choose.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { hashText } from '@ohhi/vault'
import { OpError } from './contract.js'

/** A directory holding one of these IS a vault, as far as the walk is concerned. */
export const VAULT_MARKERS = ['.editor', '.obsidian'] as const

export interface VaultSelection {
  /** Absolute, realpath'd. */
  root: string
  /** How it was chosen — worth printing when an agent is surprised. */
  source: 'flag' | 'env' | 'marker'
  /** The marker directory that decided it, for `source: 'marker'`. */
  marker?: string
}

export interface SelectVaultOptions {
  /** `--vault`. */
  vault?: string
  env: Record<string, string | undefined>
  cwd: string
}

/** The sentence every "which vault?" failure ends with. Written once. */
const HOW =
  'name a vault with --vault <path>, set OHHI_VAULT, or run inside a folder containing .editor/ or .obsidian/'

export async function resolveVault(opts: SelectVaultOptions): Promise<VaultSelection> {
  if (opts.vault) return { root: await requireDir(opts.vault, '--vault'), source: 'flag' }
  const fromEnv = opts.env.OHHI_VAULT
  if (fromEnv) return { root: await requireDir(fromEnv, 'OHHI_VAULT'), source: 'env' }

  const candidates = await walkUp(opts.cwd)
  if (candidates.length === 0) throw new OpError('usage', `no vault found — ${HOW}`)
  if (candidates.length > 1) {
    throw new OpError(
      'usage',
      `ambiguous vault: markers at ${candidates.map((c) => c.root).join(' and ')} — ${HOW}`,
      { candidates: candidates.map((c) => c.root) }
    )
  }
  const only = candidates[0]
  return { root: await realpath(only.root), source: 'marker', marker: only.marker }
}

/**
 * This tool's data directory: `OHHI_DATA_DIR`, else `$XDG_DATA_HOME/ohhi`,
 * else `~/.local/share/ohhi`. Never inside the vault — the vault holds the
 * user's notes and nothing of ours (golden rule 1's other half).
 */
export function resolveDataDir(env: Record<string, string | undefined>, home = homedir()): string {
  const explicit = env.OHHI_DATA_DIR
  if (explicit) return resolve(explicit)
  const xdg = env.XDG_DATA_HOME
  if (xdg && isAbsolute(xdg)) return join(xdg, 'ohhi')
  return join(home, '.local', 'share', 'ohhi')
}

/**
 * Per-vault id: the first 16 hex of sha-256 over the REALPATH. Short enough to
 * read in a directory listing, and stable across two spellings of one folder
 * (a symlink and its target must not get two journals).
 */
export const vaultId = (realRoot: string): string => hashText(realRoot).slice(0, 16)

async function requireDir(path: string, how: string): Promise<string> {
  const absolute = resolve(path)
  try {
    const real = await realpath(absolute)
    if ((await stat(real)).isDirectory()) return real
  } catch {
    throw new OpError('usage', `${how}: no such directory: ${path}`)
  }
  throw new OpError('usage', `${how}: not a directory: ${path}`)
}

/** Every ancestor of `cwd` (itself included) that holds a vault marker. */
async function walkUp(cwd: string): Promise<{ root: string; marker: string }[]> {
  const found: { root: string; marker: string }[] = []
  let dir = resolve(cwd)
  for (;;) {
    const marker = await markerIn(dir)
    if (marker) found.push({ root: dir, marker })
    const parent = dirname(dir)
    if (parent === dir) return found
    dir = parent
  }
}

async function markerIn(dir: string): Promise<string | null> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  for (const marker of VAULT_MARKERS) {
    if (!names.includes(marker)) continue
    try {
      if ((await stat(join(dir, marker))).isDirectory()) return marker
    } catch {
      // A marker we cannot stat is not a marker.
    }
  }
  return null
}
