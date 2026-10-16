/**
 * The app-file door (`readAppFile`/`writeAppFile`): `.ohhi/` and
 * `.obsidian/` only, and never a `..` that climbs out of them — a palette
 * template name is user text (correctness review #23).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemStoreDir, MemVaultAdapter } from '@ohhi/vault'
import { useMemStorage } from './storage.fixture.js'
import { setupWorkspace, type Workspace } from './workspace.svelte.js'

beforeEach(() => useMemStorage())

const enc = new TextEncoder()
let open: Workspace | null = null
afterEach(() => {
  open?.dispose()
  open = null
})

describe('readAppFile', () => {
  it('reads under .ohhi/, and refuses a path that leaves it', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('.ohhi/templates/meeting.md', enc.encode('# Meeting\n'))
    await adapter.writeAtomic('secret.md', enc.encode('not an app file\n'))
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'app-files' })
    open = ws

    expect(await ws.readAppFile('.ohhi/templates/meeting.md')).toBe('# Meeting\n')
    await expect(ws.readAppFile('.ohhi/templates/../../secret.md')).rejects.toThrow(/readAppFile is for/)
    await expect(ws.readAppFile('notes/x.md')).rejects.toThrow(/readAppFile is for/)
  })
})

describe('listAppDirs', () => {
  it('lists the folders under .ohhi/themes, and refuses a path that leaves the app dirs', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('.ohhi/themes/nord-dark/theme.css', enc.encode('[data-theme="nord-dark"] {}\n'))
    await adapter.writeAtomic('.ohhi/themes/Paper/theme.css', enc.encode('[data-theme="Paper"] {}\n'))
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'app-dirs' })
    open = ws

    expect(await ws.listAppDirs('.ohhi/themes')).toEqual(['.ohhi/themes/Paper', '.ohhi/themes/nord-dark'])
    expect(await ws.listAppDirs('.ohhi/layouts')).toEqual([])
    await expect(ws.listAppDirs('notes')).rejects.toThrow(/listAppDirs is for/)
    await expect(ws.listAppDirs('.ohhi/../notes')).rejects.toThrow(/listAppDirs is for/)
    // Never a file the vault lists.
    expect(ws.ui.files.some((f) => f.path.startsWith('.ohhi/'))).toBe(false)
  })
})

describe('deleteAppFile', () => {
  it('removes a file under .ohhi/, is a no-op when absent, and refuses .obsidian/ and a climb out', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('.ohhi/layouts/mine.json', enc.encode('{}\n'))
    await adapter.writeAtomic('.obsidian/app.json', enc.encode('{}\n'))
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'app-files-del' })
    open = ws

    await ws.deleteAppFile('.ohhi/layouts/mine.json')
    expect(await adapter.read('.ohhi/layouts/mine.json')).toBeNull()
    await ws.deleteAppFile('.ohhi/layouts/mine.json')
    await expect(ws.deleteAppFile('.obsidian/app.json')).rejects.toThrow(/deleteAppFile is for/)
    await expect(ws.deleteAppFile('.ohhi/../notes.md')).rejects.toThrow(/deleteAppFile is for/)
    expect(await adapter.read('.obsidian/app.json')).not.toBeNull()
  })
})
