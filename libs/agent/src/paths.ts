/**
 * Vault-relative path hygiene — the ONE place a caller-supplied path is
 * validated, so every op refuses the same inputs with the same words.
 *
 * `NodeVaultAdapter` already guards against escapes (it throws), but an
 * adapter throw is a runtime error with an ABSOLUTE path in the message, and
 * the surface must never print a path outside the vault (shaping A2.7). So
 * paths are normalized and refused here, before the adapter ever sees them,
 * and the message names nothing.
 */
import { OpError } from './contract.js'

/** `.md` is the only extension the write ops will create or replace. */
export const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith('.md')

/**
 * Normalize a vault-relative path: POSIX separators, no `.`/`..` segments, no
 * leading slash, no trailing slash. Throws `refused` on anything that could
 * address a byte outside the vault.
 */
export function normalizeVaultPath(input: string): string {
  const path = normalizeDir(input)
  if (!path) throw new OpError('usage', 'a vault-relative path is required')
  return path
}

/**
 * The same normalization for a directory, where the vault ROOT is a legal
 * answer and spells itself `''` (an empty string, not `.` — every other path
 * in the contract is relative to the root, so the root is the empty prefix).
 */
export function normalizeDir(input: string | undefined): string {
  const raw = (input ?? '').trim().replaceAll('\\', '/')
  if (/^[A-Za-z]:/.test(raw)) throw new OpError('refused', 'path escapes the vault')
  const segments: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') throw new OpError('refused', 'path escapes the vault')
    segments.push(segment)
  }
  return segments.join('/')
}

/** Parent directory of a vault path (`''` for a root-level file). */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

/** Basename without its extension, and the extension (`''` when there is none). */
export function splitExtension(path: string): { stem: string; ext: string } {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash + 1 ? { stem: path.slice(0, dot), ext: path.slice(dot) } : { stem: path, ext: '' }
}

/** True when `path` is `dir` itself or sits anywhere beneath it. */
export const isUnder = (dir: string, path: string): boolean =>
  dir === '' || path === dir || path.startsWith(`${dir}/`)
