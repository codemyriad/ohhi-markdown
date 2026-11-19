/**
 * The folder pick is the desktop build's only fs grant (DEL-89): the dialog
 * must be asked to grant the folder recursively, and to open on a vault's
 * folder when access is being allowed again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const open = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (opts: unknown) => open(opts) }))
const exists = vi.fn()
const readDir = vi.fn()
const watchImmediate = vi.fn()
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (p: string) => exists(p),
  readDir: (p: string) => readDir(p),
  watchImmediate: (...args: unknown[]) => watchImmediate(...args),
}))

const { pickVaultFolder, TauriVaultAdapter } = await import('./tauri-vault-adapter.js')

beforeEach(() => {
  open.mockReset()
  exists.mockReset()
  readDir.mockReset()
  watchImmediate.mockReset()
})

describe('pickVaultFolder', () => {
  it('asks for one directory, granted recursively', async () => {
    open.mockResolvedValue('/home/user/vault')
    expect(await pickVaultFolder()).toBe('/home/user/vault')
    const opts = open.mock.calls[0]![0] as Record<string, unknown>
    expect(opts).toMatchObject({ directory: true, multiple: false, recursive: true })
    expect(opts).not.toHaveProperty('defaultPath')
  })

  it('opens on the given folder; a cancel is null', async () => {
    open.mockResolvedValue(null)
    expect(await pickVaultFolder('/home/user/vault')).toBeNull()
    expect(open.mock.calls[0]![0]).toMatchObject({ defaultPath: '/home/user/vault', recursive: true })
  })
})

describe('TauriVaultAdapter app-dir listings', () => {
  const entry = (name: string, dir: boolean) => ({ name, isFile: !dir, isDirectory: dir, isSymlink: false })

  it('lists the folders in one app dir — the theme folders — skipping files and temp names', async () => {
    exists.mockResolvedValue(true)
    readDir.mockResolvedValue([
      entry('nord-dark', true),
      entry('Paper', true),
      entry('stray.css', false),
      entry('x.ohhi-tmp-1-2', true),
    ])
    const a = new TauriVaultAdapter('/home/user/vault')
    expect(await a.listAppDirs('.ohhi/themes/')).toEqual(['.ohhi/themes/Paper', '.ohhi/themes/nord-dark'])
    expect(readDir).toHaveBeenCalledWith('/home/user/vault/.ohhi/themes')
  })

  it('is empty when the folder does not exist', async () => {
    exists.mockResolvedValue(false)
    expect(await new TauriVaultAdapter('/v').listAppDirs('.ohhi/themes')).toEqual([])
    expect(readDir).not.toHaveBeenCalled()
  })
})

/**
 * A watcher that fails to start is reported, never swallowed: the desktop app
 * was seen running with no watcher at all and saying nothing, so outside
 * edits silently stopped arriving.
 */
describe('TauriVaultAdapter watch', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('reports a watcher that did not start to onError', async () => {
    watchImmediate.mockRejectedValue(new Error('command watch not found'))
    const onError = vi.fn()
    new TauriVaultAdapter('/v').watch(() => {}, onError)
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0]![0] as Error
    expect(err.message).toMatch(/file watcher did not start/)
    expect(err.message).toMatch(/command watch not found/)
  })

  it('reports it once per vault, however often a session restart watches again', async () => {
    watchImmediate.mockRejectedValue(new Error('command watch not found'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn()
    const a = new TauriVaultAdapter('/v')
    a.watch(() => {}, onError)
    a.watch(() => {}, onError)
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('without a listener, the failure still reaches the console', async () => {
    watchImmediate.mockRejectedValue(new Error('denied'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    new TauriVaultAdapter('/v').watch(() => {})
    await settle()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  type NativeEvent = { type: unknown; paths: string[] }

  /** Starts the watcher and returns the native callback the plugin would call. */
  async function watching(onEvent: (paths: string[]) => void, onError?: (err: unknown) => void) {
    let native: ((ev: NativeEvent) => void) | null = null
    watchImmediate.mockImplementation(async (_root: string, cb: (ev: NativeEvent) => void) => {
      native = cb
      return () => {}
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    new TauriVaultAdapter('/home/user/vault').watch((ev) => onEvent(ev.paths), onError)
    await settle()
    return { native: native!, info }
  }

  it('says once that it is watching, and hands on vault-relative paths', async () => {
    const seen: string[][] = []
    const onError = vi.fn()
    const { native, info } = await watching((paths) => seen.push(paths), onError)
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]).toContain('/home/user/vault')
    native({
      type: 'any',
      paths: ['/home/user/vault/notes/a.md', '/home/user/vault/.git/index', '/elsewhere/x.md'],
    })
    expect(seen).toEqual([['notes/a.md']])
    expect(onError).not.toHaveBeenCalled()
    info.mockRestore()
  })

  /**
   * The Linux backend reports a file being opened as an `access` event — every
   * read this app makes. Treating that as a change read the file again, which
   * reported again: the app spun at full CPU over a resumed vault.
   */
  it('a read is not a change: access and other events are dropped, create/modify/remove/any pass', async () => {
    const seen: string[][] = []
    const { native, info } = await watching((paths) => seen.push(paths))
    const at = (type: unknown) => native({ type, paths: ['/home/user/vault/notes/a.md'] })
    at({ access: { kind: 'open', mode: 'any' } })
    at({ access: { kind: 'close', mode: 'read' } })
    at('other')
    expect(seen).toEqual([])
    at({ create: { kind: 'file' } })
    at({ modify: { kind: 'data', mode: 'any' } })
    at({ remove: { kind: 'file' } })
    at('any')
    expect(seen).toEqual([['notes/a.md'], ['notes/a.md'], ['notes/a.md'], ['notes/a.md']])
    info.mockRestore()
  })

  it('a failure after dispose is not reported', async () => {
    let reject: (err: unknown) => void = () => {}
    watchImmediate.mockReturnValue(new Promise((_res, rej) => (reject = rej)))
    const onError = vi.fn()
    const off = new TauriVaultAdapter('/v').watch(() => {}, onError)
    off()
    reject(new Error('late'))
    await settle()
    expect(onError).not.toHaveBeenCalled()
  })
})
