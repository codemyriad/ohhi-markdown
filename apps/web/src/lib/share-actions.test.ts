// @vitest-environment jsdom
/**
 * In-workspace sharing (`share-actions.svelte.ts`): the registry side-effects
 * around each shim call, the confirm-first rule for a cross-boundary move,
 * and where a failure is reported. The shim's own behaviour is
 * `workspace-mounts.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadShares, roomToken, setRoomToken, upsertVault } from './config.js'
import { createShareActions, type ShareActions } from './share-actions.svelte.js'
import {
  actionsWorkspace,
  mount,
  withActions,
  type ActionsHarness,
  type ActionsWorkspace,
} from './shell-actions.fixture.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'

let ws: ActionsWorkspace
let harness: ActionsHarness<ShareActions>
let sharing: ShareActions
let refreshed: number
let closed: string[]
let revoked: string[]

beforeEach(() => {
  useMemStorage()
  upsertVault({ name: 'Team', room: 'root-room', vault: { kind: 'opfs', id: 'x' } })
  ws = actionsWorkspace(['docs/a.md', 'docs/b.md', 'private/c.md'], [
    mount('', 'root-room'),
    mount('docs', 'docs-room'),
  ])
  refreshed = 0
  closed = []
  revoked = []
  harness = withActions(() =>
    createShareActions({
      workspace: () => ws.asWorkspace(),
      refresh: () => {
        refreshed++
      },
      closeUnder: (path) => {
        closed.push(path)
      },
      revokeRoom: async (room) => {
        revoked.push(room)
      },
    })
  )
  sharing = harness.actions
})

afterEach(() => {
  harness.stop()
  dropStorage()
})

describe('folder share', () => {
  it('carves the folder and remembers the share as vault/folder', async () => {
    ws.ui.mounts = [...ws.ui.mounts, mount('private', 'private-room')]
    sharing.folderSharePath = 'private'
    harness.flush()
    expect(sharing.folderShareMount?.room).toBe('private-room')

    const link = await sharing.carveFolderShare()
    expect(link).toBe('share:private')
    expect(ws.calls).toEqual(['carveFolder(private)'])
    expect(loadShares()).toEqual([{ link, room: 'private-room', label: 'Team/private' }])
    expect(refreshed).toBe(1)
  })

  it('refuses to carve with nothing selected', async () => {
    await expect(sharing.carveFolderShare()).rejects.toThrow()
  })

  it('a device link bumps the revision so the access list refetches', async () => {
    expect(sharing.revision).toBe(0)
    await sharing.createDeviceLink('laptop')
    expect(ws.calls).toEqual(['linkDevice(laptop)'])
    expect(sharing.revision).toBe(1)
    sharing.touch()
    expect(sharing.revision).toBe(2)
  })
})

describe('add link', () => {
  it('reports a bad link as a notice on the mount AND rethrows for the dialog', async () => {
    sharing.addLinkPath = 'docs'
    harness.flush()
    expect(sharing.addLinkMount?.room).toBe('docs-room')

    ws.failNext('addMountLink', 'boom')
    await expect(sharing.addMountLink('docs', 'nope')).rejects.toThrow('boom')
    expect(ws.notices).toHaveLength(1)
    expect(ws.notices[0]?.path).toBe('docs')
    expect(refreshed).toBe(0)

    await sharing.addMountLink('docs', 'ok')
    expect(refreshed).toBe(1)
  })
})

describe('unshare / unmount', () => {
  it('unshare forgets the share and its token; the revoke is opt-in', async () => {
    setRoomToken('docs-room', 'tok')
    sharing.askUnshare('docs')
    expect(sharing.unshareConfirm).toEqual({ path: 'docs', provenance: 'carved' })

    await sharing.confirmUnshare(false)
    expect(sharing.unshareConfirm).toBeNull()
    expect(ws.calls).toEqual(['unshare(docs)'])
    expect(roomToken('docs-room')).toBe('')
    expect(revoked).toEqual([])

    sharing.askUnshare('docs')
    await sharing.confirmUnshare(true)
    expect(revoked).toEqual(['docs-room'])
  })

  it('unmount closes the tabs under the folder before the shim runs', async () => {
    sharing.askUnmount('docs')
    expect(sharing.unmountConfirm).toBe('docs')
    await sharing.confirmUnmount()
    expect(closed).toEqual(['docs'])
    expect(ws.calls).toEqual(['unmount(docs)'])
    expect(refreshed).toBe(1)
  })

  it('a shim failure lands in the notices, not in a throw', async () => {
    sharing.askUnmount('docs')
    ws.failNext('unmount', 'relay down')
    await sharing.confirmUnmount()
    expect(ws.notices.map((n) => n.text)).toEqual(['relay down'])
  })
})

describe('move', () => {
  it('moves within a mount silently', async () => {
    await sharing.move('docs/a.md', 'docs/z.md')
    expect(ws.calls).toEqual(['movePath(docs/a.md, docs/z.md)'])
    expect(sharing.moveConfirm).toBeNull()
  })

  it('asks first across a share boundary, saying which way the content goes', async () => {
    ws.crossMount = () => true
    await sharing.move('docs/a.md', 'private/a.md')
    expect(ws.calls).toEqual([])
    expect(sharing.moveConfirm).toEqual({ from: 'docs/a.md', to: 'private/a.md', leavingShared: true })

    await sharing.confirmCrossMove()
    expect(ws.calls).toEqual(['movePath(docs/a.md, private/a.md)'])
    expect(sharing.moveConfirm).toBeNull()

    await sharing.move('private/c.md', 'docs/c.md')
    expect(sharing.moveConfirm?.leavingShared).toBe(false)
  })
})
