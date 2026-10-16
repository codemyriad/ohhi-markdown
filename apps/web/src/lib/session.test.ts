// @vitest-environment jsdom
/**
 * The boot state machine (`session.svelte.ts`): what no e2e can pin — a boot
 * that is cancelled, superseded or fails while a whole vault is arriving, and
 * what a late `setup` is allowed to do afterwards (nothing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { upsertVault, type VaultEntry } from './config.js'
import { createSession, type Session, type SessionHost } from './session.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import type { Workspace, WorkspaceConfig } from './workspace.svelte.js'
import { applyTheme, themeState } from './theme.svelte.js'

const A: VaultEntry = { name: 'A', room: 'room-a', vault: { kind: 'opfs', id: 'a' } }
const B: VaultEntry = { name: 'B', room: 'room-b', vault: { kind: 'opfs', id: 'b' } }

/** One `setup` call the test can settle by hand. */
interface Pending {
  cfg: WorkspaceConfig
  resolve(ws: Workspace): void
  reject(err: Error): void
}

function fakeWorkspace(room: string): Workspace & { disposed: boolean } {
  const ws = {
    room,
    disposed: false,
    dispose() {
      ws.disposed = true
    },
    readAppFile: async () => null,
  }
  return ws as unknown as Workspace & { disposed: boolean }
}

let pending: Pending[]
let calls: string[]
let session: Session

function host(): SessionHost {
  return {
    index: {} as SessionHost['index'],
    attachIndex: (ws) => calls.push(`index:${ws?.room ?? 'null'}`),
    attachPanes: (ws, room) => calls.push(`panes:${ws?.room ?? 'null'}:${room}`),
    onRenamed: () => {},
    userName: () => 'chris',
    lastVault: () => null,
    onOpened: (ws) => calls.push(`opened:${ws.room}`),
    setup: (cfg) =>
      new Promise<Workspace>((resolve, reject) => {
        pending.push({ cfg, resolve, reject })
      }),
    configForSession: async (entry, user) =>
      ({ room: entry.room, user }) as unknown as WorkspaceConfig,
    configForMemory: async (cfg) => ({ room: cfg.room }) as unknown as WorkspaceConfig,
  }
}

/** Let the awaited config resolve so `setup` has been called. */
const tick = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  useMemStorage()
  upsertVault(A)
  upsertVault(B)
  pending = []
  calls = []
  session = createSession(host())
})

afterEach(() => {
  dropStorage()
  vi.restoreAllMocks()
})

describe('createSession', () => {
  it('one tab per browser vault (P3): a refused claim fails the boot against the entry; a claim is held until close', async () => {
    const h = host()
    const claims: string[] = []
    let free = true
    h.claimVault = async (entry) => {
      claims.push(entry.room)
      return free ? () => calls.push(`release:${entry.room}`) : null
    }
    session = createSession(h)

    free = false
    await session.boot(A)
    expect(claims).toEqual(['room-a'])
    expect(session.view).toBe('manager')
    expect(session.busy).toBe(false)
    expect(session.failure).toEqual({ room: 'room-a', message: getLL().web.manager.open_elsewhere({ name: A.name }), elsewhere: true })
    expect(pending).toHaveLength(0) // nothing was read

    free = true
    const done = session.boot(A)
    await tick()
    await tick()
    pending[0]!.resolve(fakeWorkspace('room-a'))
    await done
    expect(session.view).toBe('workspace')
    expect(calls).not.toContain('release:room-a')
    session.close()
    expect(calls).toContain('release:room-a')
  })

  it('boots: connecting and busy until setup resolves, then the workspace with everything attached', async () => {
    const done = session.boot(A)
    await tick()
    expect(session.view).toBe('connecting')
    expect(session.busy).toBe(true)
    expect(calls).toEqual(['index:null'])

    const ws = fakeWorkspace('room-a')
    pending[0]!.resolve(ws)
    await done
    expect(session.view).toBe('workspace')
    expect(session.workspace).toBe(ws)
    expect(session.busy).toBe(false)
    expect(session.failure).toBeNull()
    // Index before panes, so the restored tree is pruned against a live vault (B6).
    expect(calls).toEqual(['index:null', 'index:room-a', 'panes:room-a:room-a', 'opened:room-a'])
  })

  it('a failed boot lands on the manager, against its row, and is not busy', async () => {
    const done = session.boot(A)
    await tick()
    pending[0]!.reject(new Error('relay refused'))
    await done
    expect(session.view).toBe('manager')
    expect(session.failure).toEqual({ room: 'room-a', message: 'relay refused' })
    expect(session.busy).toBe(false)
    expect(session.workspace).toBeNull()
  })

  it('a desktop vault refused by the fs scope offers to allow access again (DEL-89)', async () => {
    const T: VaultEntry = { name: 'T', room: 'room-t', vault: { kind: 'tauri', path: '/home/chris/vault' } }
    const done = session.boot(T)
    await tick()
    // The fs plugin rejects with a plain string, not an Error.
    pending[0]!.reject('forbidden path: /home/chris/vault' as unknown as Error)
    await done
    expect(session.view).toBe('manager')
    expect(session.failure).toMatchObject({ room: 'room-t', access: true })
    expect(session.failure?.message).not.toContain('forbidden')
  })

  it('a forbidden path on a browser vault is an ordinary failure', async () => {
    const done = session.boot(A)
    await tick()
    pending[0]!.reject(new Error('forbidden path: x'))
    await done
    expect(session.failure).toEqual({ room: 'room-a', message: 'forbidden path: x' })
  })

  it('a failure while a whole vault is arriving stays on the progress panel', async () => {
    session.joining = { entry: A, destination: 'browser', kind: 'device' }
    const done = session.boot(A)
    await tick()
    pending[0]!.reject(new Error('stalled'))
    await done
    expect(session.view).toBe('connecting')
    expect(session.joining?.entry).toEqual(A)
    expect(session.failure?.message).toBe('stalled')
  })

  it('cancel returns to the manager and a late workspace is disposed, never installed', async () => {
    const done = session.boot(A)
    await tick()
    session.cancel()
    expect(session.view).toBe('manager')
    expect(session.busy).toBe(false)

    const late = fakeWorkspace('room-a')
    pending[0]!.resolve(late)
    await done
    expect(late.disposed).toBe(true)
    expect(session.workspace).toBeNull()
    expect(session.view).toBe('manager')
  })

  it('cancel with a vault already open goes back to it', async () => {
    const first = session.boot(A)
    await tick()
    pending[0]!.resolve(fakeWorkspace('room-a'))
    await first

    const second = session.boot(B)
    await tick()
    session.cancel()
    expect(session.view).toBe('workspace')
    expect(session.workspace?.room).toBe('room-a')
    pending[1]!.resolve(fakeWorkspace('room-b'))
    await second
    expect(session.workspace?.room).toBe('room-a')
  })

  it('a newer boot supersedes an older one, whichever settles first', async () => {
    const bootA = session.boot(A)
    const bootB = session.boot(B)
    await tick()
    expect(pending).toHaveLength(2)

    const wsB = fakeWorkspace('room-b')
    pending[1]!.resolve(wsB)
    await bootB
    expect(session.workspace).toBe(wsB)
    expect(session.busy).toBe(false)

    const wsA = fakeWorkspace('room-a')
    pending[0]!.resolve(wsA)
    await bootA
    expect(wsA.disposed).toBe(true)
    expect(session.workspace).toBe(wsB)
    expect(session.view).toBe('workspace')
  })

  it('pull progress is only taken from the boot in flight', async () => {
    const bootA = session.boot(A)
    const bootB = session.boot(B)
    await tick()
    const progress = { phase: 'pull', done: 1, total: 2 } as unknown as NonNullable<Session['pull']>
    pending[0]!.cfg.onPull?.(progress)
    expect(session.pull).toBeNull()
    pending[1]!.cfg.onPull?.(progress)
    expect(session.pull).toEqual(progress)
    pending[0]!.resolve(fakeWorkspace('room-a'))
    pending[1]!.resolve(fakeWorkspace('room-b'))
    await Promise.all([bootA, bootB])
  })

  it('close tears the open workspace down and detaches it', async () => {
    const done = session.boot(A)
    await tick()
    const ws = fakeWorkspace('room-a')
    pending[0]!.resolve(ws)
    await done
    calls.length = 0

    session.close()
    expect(ws.disposed).toBe(true)
    expect(session.workspace).toBeNull()
    expect(calls).toEqual(['index:null', 'panes:null:'])
  })

  describe('start', () => {
    it('reopens the last vault on a plain launch', async () => {
      const h = host()
      h.lastVault = () => A
      session = createSession(h)
      session.start({ kind: 'landing' }, false)
      await tick()
      expect(session.view).toBe('connecting')
      expect(pending).toHaveLength(1)
    })

    it('shows the manager when a share link is in the URL, even with a last vault', () => {
      const h = host()
      h.lastVault = () => A
      session = createSession(h)
      session.start({ kind: 'landing' }, true)
      expect(session.view).toBe('manager')
      expect(pending).toHaveLength(0)
    })

    it('a bad URL lands on the manager with the message', () => {
      session.start({ kind: 'error', message: 'bad params' }, false)
      expect(session.view).toBe('manager')
      expect(session.failure).toEqual({ room: null, message: 'bad params' })
    })

    it('the memory contract boots straight into the workspace', async () => {
      session.start(
        { kind: 'memory', mode: 'memory', room: 'mem', relay: 'ws://x', token: 't', user: 'u', role: 'seed' },
        false
      )
      await tick()
      const ws = fakeWorkspace('mem')
      pending[0]!.resolve(ws)
      await tick()
      expect(session.view).toBe('workspace')
      expect(session.workspace).toBe(ws)
    })
  })
})

describe('createSession — a vault theme the vault does not hold (Nord out of the built-ins, Fork 4-A)', () => {
  /** A workspace whose `.ohhi/` holds `files`, recording what it is told. */
  function vaultWith(room: string, files: Record<string, string>) {
    const notices: unknown[] = []
    const ws = {
      room,
      dispose() {},
      readAppFile: async (path: string) => files[path] ?? null,
      notify: (input: unknown) => void notices.push(input),
    }
    return { ws: ws as unknown as Workspace, notices }
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  }

  afterEach(() => {
    document.getElementById('ed-user-theme')?.remove()
    applyTheme('system')
  })

  it('a stored nord-dark and no folder: Oh Hi Dark stands in, the preference is kept, and it is said once — ever', async () => {
    themeState.pref = 'custom:nord-dark'
    const a = vaultWith('room-a', {})
    const done = session.boot(A)
    await tick()
    pending[0]!.resolve(a.ws)
    await done
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('editor-dark')
    expect(themeState.pref).toBe('custom:nord-dark')
    expect(themeState.fellBackFrom).toBe('nord-dark')
    expect(a.notices).toEqual([
      {
        level: 'warn',
        code: 'theme_retired',
        params: { name: 'nord-dark', path: '.ohhi/themes/nord-dark/theme.css', example: 'examples/themes/nord-dark/theme.css' },
      },
    ])

    // Another vault without it: the stand-in again, nothing said.
    const b = vaultWith('room-b', {})
    const again = session.boot(B)
    await tick()
    pending[1]!.resolve(b.ws)
    await again
    await settle()
    expect(b.notices).toEqual([])

    // A vault that holds the folder: Nord Dark itself.
    const c = vaultWith('room-a', { '.ohhi/themes/nord-dark/theme.css': '[data-theme="nord-dark"] { color-scheme: dark; }' })
    const third = session.boot(A)
    await tick()
    pending[2]!.resolve(c.ws)
    await third
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord-dark')
    expect(themeState.fellBackFrom).toBeNull()
    expect(c.notices).toEqual([])
  })

  it('a custom theme of your own that the vault lacks: the stand-in, and no notice (only the retired built-ins are announced)', async () => {
    themeState.pref = 'custom:paper'
    const a = vaultWith('room-a', {})
    const done = session.boot(A)
    await tick()
    pending[0]!.resolve(a.ws)
    await done
    await settle()
    expect(themeState.fellBackFrom).toBe('paper')
    expect(a.notices).toEqual([])
  })
})
