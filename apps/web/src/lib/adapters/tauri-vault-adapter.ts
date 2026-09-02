/**
 * Tauri VaultAdapter: on-disk vault backend for the desktop shell.
 *
 * Implements the `@editor/vault` VaultAdapter over the Tauri 2 `plugin-fs`
 * (filesystem) and `plugin-dialog` (folder picker) APIs, so the web app can
 * read/write a real markdown vault when running inside the desktop shell.
 *
 * Interface paths are vault-relative POSIX (forward slashes). They are joined
 * with the absolute `root` to form absolute filesystem paths, with a guard that
 * rejects anything resolving outside the vault root (mirrors NodeVaultAdapter).
 *
 * `node:path` is unavailable in the webview, so small POSIX path helpers are
 * implemented inline below (all internal paths use '/').
 */
import { open } from '@tauri-apps/plugin-dialog'
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove as fsRemove,
  rename as fsRename,
  stat,
  watchImmediate,
  writeFile,
  type UnwatchFn,
} from '@tauri-apps/plugin-fs'
import type { FileStat, VaultAdapter, WatchEvent } from '@editor/vault'

const IGNORED = new Set(['.git', '.obsidian', '.editor-cache', 'node_modules'])

/** Counter for unique temp names within a single ms tick. */
let tmpCounter = 0

/** Convert native separators to POSIX '/'. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Collapse '.'/'..'/empty segments; preserves a leading '/' for absolute paths. */
function normalizePosix(p: string): string {
  const isAbsolute = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
      // absolute + empty stack: '..' cannot climb above root, so drop it
    } else out.push(seg)
  }
  return (isAbsolute ? '/' : '') + out.join('/')
}

/** POSIX dirname of a normalized path. */
function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return p.slice(0, i)
}

export class TauriVaultAdapter implements VaultAdapter {
  private readonly rootAbs: string

  constructor(private root: string) {
    this.rootAbs = normalizePosix(toPosix(root))
  }

  /** Join a vault-relative POSIX path with root; reject escapes outside root. */
  private abs(path: string): string {
    const full = normalizePosix(`${this.rootAbs}/${toPosix(path)}`)
    if (full !== this.rootAbs && !full.startsWith(`${this.rootAbs}/`)) {
      throw new Error(`path escapes vault: ${path}`)
    }
    return full
  }

  /** Absolute native path -> vault-relative POSIX, or null if outside root. */
  private toRelative(abs: string): string | null {
    const full = normalizePosix(toPosix(abs))
    if (full === this.rootAbs) return ''
    if (full.startsWith(`${this.rootAbs}/`)) return full.slice(this.rootAbs.length + 1)
    return null
  }

  async list(): Promise<FileStat[]> {
    const out: FileStat[] = []
    const walk = async (relDir: string): Promise<void> => {
      for (const entry of await readDir(this.abs(relDir))) {
        if (IGNORED.has(entry.name)) continue
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
        if (entry.isDirectory) {
          await walk(relPath)
        } else {
          const s = await stat(this.abs(relPath))
          out.push({ path: relPath, size: s.size })
        }
      }
    }
    await walk('')
    return out
  }

  async read(path: string): Promise<Uint8Array | null> {
    const full = this.abs(path)
    // plugin-fs throws (with a non-structured message) for a missing file, so
    // probe with exists() to distinguish not-found from real read errors.
    if (!(await exists(full))) return null
    return await readFile(full)
  }

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirnamePosix(full), { recursive: true })
    // unique temp name
    const tmp = `${full}.editor-tmp-${Date.now()}-${tmpCounter++}`
    await writeFile(tmp, bytes)
    // Atomicity note: plugin-fs exposes no fsync, so we cannot flush the temp
    // file to durable storage before renaming. temp+rename still gives rename
    // atomicity (readers see either the old or the fully-written new file).
    await fsRename(tmp, full)
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.abs(to)
    await mkdir(dirnamePosix(dest), { recursive: true })
    await fsRename(this.abs(from), dest)
  }

  async remove(path: string): Promise<void> {
    const full = this.abs(path)
    // Ignore not-found (mirrors `rm(..., { force: true })`).
    if (await exists(full)) await fsRemove(full)
  }

  watch(cb: (ev: WatchEvent) => void): () => void {
    let unwatch: UnwatchFn | null = null
    let disposed = false

    // watchImmediate is async; kick it off and capture the unwatch fn. The
    // disposer we return is synchronous: it unwatches if already resolved, and
    // the "disposed" flag ensures a dispose that races the promise still
    // unwatches once the promise settles.
    void watchImmediate(
      this.root,
      (event) => {
        const paths: string[] = []
        for (const abs of event.paths) {
          const rel = this.toRelative(abs)
          if (!rel) continue
          if (rel.split('/').some((seg) => IGNORED.has(seg))) continue
          if (rel.includes('.editor-tmp-')) continue
          paths.push(rel)
        }
        if (paths.length) cb({ paths })
      },
      { recursive: true },
    ).then(
      (fn) => {
        if (disposed) fn()
        else unwatch = fn
      },
      () => {
        /* watch failed to start; nothing to unwatch */
      },
    )

    return () => {
      disposed = true
      if (unwatch) {
        unwatch()
        unwatch = null
      }
    }
  }
}

/**
 * Prompt the user to pick a vault folder. Returns the selected absolute path,
 * or null if the dialog was cancelled.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Choose a vault folder',
  })
  // `open` can return string | string[] | null; narrow to a single path.
  if (Array.isArray(selected)) return selected[0] ?? null
  return selected
}
