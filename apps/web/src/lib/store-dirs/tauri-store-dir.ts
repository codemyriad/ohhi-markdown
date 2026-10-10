/**
 * Tauri StoreDir: durable-store namespace under the OS app-data directory
 * (spike S8 layout: `<appData>/stores/<rootRoom>/…`) — outside the vault,
 * never droppable (shaping D5). Uses plugin-fs like TauriVaultAdapter; the
 * V1 `$HOME/**` fs scope covers app-data on Linux/macOS.
 *
 * The small POSIX helpers are duplicated from tauri-vault-adapter.ts (they
 * are module-local there; `node:path` is unavailable in the webview).
 */
import { appDataDir } from '@tauri-apps/api/path'
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove as fsRemove,
  rename as fsRename,
  writeFile,
} from '@tauri-apps/plugin-fs'
import { isTempName, TEMP_INFIX } from '@ohhi/vault'
import type { StoreDir, StoreIo } from '@ohhi/vault'

/** Counter for unique temp names within a single ms tick. */
let tmpCounter = 0

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

function normalizePosix(p: string): string {
  const isAbsolute = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
    } else out.push(seg)
  }
  return (isAbsolute ? '/' : '') + out.join('/')
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return p.slice(0, i)
}

export class TauriStoreDir implements StoreDir {
  private readonly rootAbs: string

  constructor(root: string) {
    this.rootAbs = normalizePosix(toPosix(root))
  }

  private abs(name: string): string {
    const full = normalizePosix(`${this.rootAbs}/${toPosix(name)}`)
    if (full !== this.rootAbs && !full.startsWith(`${this.rootAbs}/`)) {
      throw new Error(`name escapes store dir: ${name}`)
    }
    return full
  }

  io(name: string): StoreIo {
    const full = this.abs(name)
    return {
      read: async () => {
        // plugin-fs throws unstructured errors for missing files; probe first.
        if (!(await exists(full))) return null
        return await readFile(full)
      },
      writeAtomic: async (bytes) => {
        await mkdir(dirnamePosix(full), { recursive: true })
        const tmp = `${full}${TEMP_INFIX}${Date.now()}-${tmpCounter++}`
        await writeFile(tmp, bytes)
        // Atomicity note: plugin-fs exposes no fsync, so we cannot flush the
        // temp file to durable storage before renaming. temp+rename still
        // gives rename atomicity (readers see old or fully-written new).
        await fsRename(tmp, full)
      },
      binding: { dir: this, name },
    }
  }

  async remove(name: string): Promise<void> {
    const full = this.abs(name)
    if (await exists(full)) await fsRemove(full)
  }

  async list(prefix?: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (relDir: string): Promise<void> => {
      const dirAbs = relDir ? this.abs(relDir) : this.rootAbs
      if (!(await exists(dirAbs))) return
      for (const entry of await readDir(dirAbs)) {
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
        if (entry.isDirectory) await walk(relPath)
        else if (!isTempName(entry.name)) out.push(relPath)
      }
    }
    await walk('')
    const names = prefix ? out.filter((n) => n.startsWith(prefix)) : out
    return names.sort()
  }
}

/**
 * Resolve/create `<appData>/stores/<sub>` and wrap it in a StoreDir. `sub` is
 * the vault namespace (the root mount's room GUID per spike S8).
 */
export async function createTauriStoreDir(sub: string): Promise<TauriStoreDir> {
  const base = normalizePosix(toPosix(await appDataDir()))
  const root = `${base}/stores/${sub}`
  await mkdir(root, { recursive: true })
  return new TauriStoreDir(root)
}

/**
 * `<appData>/stores/<sub>` if it exists, else null — never creates it: a read
 * for the manager's row facts.
 */
export async function openTauriStoreDirIfExists(sub: string): Promise<TauriStoreDir | null> {
  const base = normalizePosix(toPosix(await appDataDir()))
  const root = `${base}/stores/${sub}`
  return (await exists(root)) ? new TauriStoreDir(root) : null
}

/**
 * Delete the whole `<appData>/stores/<sub>` namespace, directory included —
 * the forget-vault path (wipeStoreDir removes files; this also drops the
 * skeleton). Missing namespace is a no-op.
 */
export async function destroyTauriStoreDir(sub: string): Promise<void> {
  const base = normalizePosix(toPosix(await appDataDir()))
  const root = `${base}/stores/${sub}`
  if (await exists(root)) await fsRemove(root, { recursive: true })
}
