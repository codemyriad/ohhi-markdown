/**
 * The shim's merged event feed (`ui.events`): each mount's room log, kept in
 * a per-room map that the mount's `onEvent` closes over. *Clear* must empty
 * those maps in place — a detached map would swallow every later room event
 * until reload (no Log rows, no badge, no toasts).
 *
 * Boots the real `setupWorkspace` over a memory adapter; the room events are
 * disk ingests (an external write the reconciler picks up), which need no relay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemStorage } from './storage.fixture.js'
import { MemStoreDir, MemVaultAdapter } from '@ohhi/vault'
import { setupWorkspace, type Workspace } from './workspace.svelte.js'

beforeEach(() => useMemStorage())

const enc = new TextEncoder()
let open: Workspace | null = null
afterEach(() => {
  open?.dispose()
  open = null
})

const changes = (ws: Workspace) => ws.ui.events.filter((e) => e.kind === 'doc.changed')

describe('ui.events', () => {
  it('room events still arrive after Clear', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('note.md', enc.encode('hello\n'))
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'root-room' })
    open = ws

    adapter.externalWrite('note.md', enc.encode('hello\nfrom obsidian\n'))
    await vi.waitFor(() => expect(changes(ws)).toHaveLength(1), { timeout: 5_000 })
    expect(changes(ws)[0]).toMatchObject({ actor: { kind: 'disk' }, scope: { room: 'root-room', path: 'note.md' } })

    ws.clearEvents()
    expect(ws.ui.events).toEqual([])

    adapter.externalWrite('note.md', enc.encode('hello\nfrom obsidian\nagain\n'))
    await vi.waitFor(() => expect(changes(ws)).toHaveLength(1), { timeout: 5_000 })
    expect(changes(ws)[0]).toMatchObject({ actor: { kind: 'disk' }, payload: expect.objectContaining({ added: 6 }) })
  })
})
