/**
 * The folder pick is the desktop build's only fs grant (DEL-89): the dialog
 * must be asked to grant the folder recursively, and to open on a vault's
 * folder when access is being allowed again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const open = vi.fn()
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (opts: unknown) => open(opts) }))
vi.mock('@tauri-apps/plugin-fs', () => ({}))

const { pickVaultFolder } = await import('./tauri-vault-adapter.js')

beforeEach(() => {
  open.mockReset()
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
