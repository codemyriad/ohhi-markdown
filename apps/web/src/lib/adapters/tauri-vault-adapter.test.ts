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
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (p: string) => exists(p),
  readDir: (p: string) => readDir(p),
}))

const { pickVaultFolder, TauriVaultAdapter } = await import('./tauri-vault-adapter.js')

beforeEach(() => {
  open.mockReset()
  exists.mockReset()
  readDir.mockReset()
})

describe('pickVaultFolder', () => {
  it('asks for one directory, granted recursively', async () => {
    open.mockResolvedValue('/home/chris/vault')
    expect(await pickVaultFolder()).toBe('/home/chris/vault')
    const opts = open.mock.calls[0]![0] as Record<string, unknown>
    expect(opts).toMatchObject({ directory: true, multiple: false, recursive: true })
    expect(opts).not.toHaveProperty('defaultPath')
  })

  it('opens on the given folder; a cancel is null', async () => {
    open.mockResolvedValue(null)
    expect(await pickVaultFolder('/home/chris/vault')).toBeNull()
    expect(open.mock.calls[0]![0]).toMatchObject({ defaultPath: '/home/chris/vault', recursive: true })
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
    const a = new TauriVaultAdapter('/home/chris/vault')
    expect(await a.listAppDirs('.ohhi/themes/')).toEqual(['.ohhi/themes/Paper', '.ohhi/themes/nord-dark'])
    expect(readDir).toHaveBeenCalledWith('/home/chris/vault/.ohhi/themes')
  })

  it('is empty when the folder does not exist', async () => {
    exists.mockResolvedValue(false)
    expect(await new TauriVaultAdapter('/v').listAppDirs('.ohhi/themes')).toEqual([])
    expect(readDir).not.toHaveBeenCalled()
  })
})
