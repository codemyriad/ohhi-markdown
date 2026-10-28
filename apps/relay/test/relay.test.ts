/**
 * Integration tests: a real relay on an ephemeral port, real Hocuspocus
 * providers over ws. Conditions are awaited by polling (no arbitrary
 * sleeps); everything is torn down so vitest exits cleanly.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createRelay, type Relay } from '../src/server.ts'

const TOKEN = 'token-for-folder-fA'
const DOC = 'fA/d1'

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

interface Client {
  doc: Y.Doc
  provider: HocuspocusProvider
  socket: HocuspocusProviderWebsocket
  authFailedReason: () => string | null
}

describe('relay integration', () => {
  let dir: string
  let relay: Relay
  const clients: Client[] = []

  function connect(port: number, name: string, token: string): Client {
    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${port}`,
      WebSocketPolyfill: WebSocket,
    })
    let reason: string | null = null
    const provider = new HocuspocusProvider({
      name,
      document: doc,
      token,
      websocketProvider: socket,
      onAuthenticationFailed: (data) => {
        reason = data.reason
      },
    })
    // v4: providers with an explicitly passed websocketProvider do not
    // auto-attach (manageSocket is false) — attach by hand.
    provider.attach()
    const client = { doc, provider, socket, authFailedReason: () => reason }
    clients.push(client)
    return client
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-test-'))
    relay = createRelay({ dbPath: join(dir, 'relay.db') })
    relay.db.addShare({ token: TOKEN, folderGuid: 'fA' })
    await relay.listen()
  })

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      c.provider.destroy()
      c.socket.destroy()
    }
    await relay.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  it('syncs text between two authenticated clients', async () => {
    const c1 = connect(relay.port, DOC, TOKEN)
    const c2 = connect(relay.port, DOC, TOKEN)

    await until(() => c1.provider.synced, 'client 1 synced')
    c1.doc.getText('content').insert(0, 'hello from c1')

    await until(
      () => c2.doc.getText('content').toString() === 'hello from c1',
      'client 2 to receive the text',
    )
    expect(c2.doc.getText('content').toString()).toBe('hello from c1')
  })

  it('rejects a connection with an unknown token, saying so', async () => {
    const bad = connect(relay.port, DOC, 'not-a-real-token')

    await until(() => bad.authFailedReason() !== null, 'authentication failure')
    // The reason reaches the client, so it can tell a dead link from a scope refusal.
    expect(bad.authFailedReason()).toBe('unknown_token')
    expect(bad.provider.isAuthenticated).toBe(false)
  })

  it('a document it cannot load is refused alone, logged by name, and opens once it can', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // fA/broken's stored state is not a Yjs update.
      relay.db.putDocState('fA/broken', new Uint8Array([0xff, 0xff, 0xff, 0xff]))
      const socket = new HocuspocusProviderWebsocket({
        url: `ws://127.0.0.1:${relay.port}`,
        WebSocketPolyfill: WebSocket,
      })
      const ride = (name: string): Client => {
        const doc = new Y.Doc()
        let reason: string | null = null
        const provider = new HocuspocusProvider({
          name,
          document: doc,
          token: TOKEN,
          websocketProvider: socket,
          onAuthenticationFailed: (data) => {
            reason = data.reason
          },
        })
        provider.attach()
        const client = { doc, provider, socket, authFailedReason: () => reason }
        clients.push(client)
        return client
      }
      const broken = ride('fA/broken')
      const fine = ride(DOC)

      await until(() => broken.authFailedReason() !== null, 'the broken doc refused')
      // Not a credential refusal: the generic answer, which the client retries.
      expect(broken.authFailedReason()).toBe('permission-denied')
      // The other document on the SAME socket is untouched and keeps syncing.
      await until(() => fine.provider.synced, 'the fine doc synced')
      fine.doc.getText('content').insert(0, 'still here')
      const peer = connect(relay.port, DOC, TOKEN)
      await until(() => peer.doc.getText('content').toString() === 'still here', 'the edit to reach a peer')
      // The operator can tell which document failed.
      expect(errors.mock.calls.some((args) => String(args[0]).includes('could not load fA/broken'))).toBe(true)

      // Repaired: a fresh connection opens it.
      relay.db.putDocState('fA/broken', Y.encodeStateAsUpdate(new Y.Doc()))
      const again = connect(relay.port, 'fA/broken', TOKEN)
      await until(() => again.provider.synced, 'the repaired doc synced')
      expect(again.authFailedReason()).toBeNull()
    } finally {
      errors.mockRestore()
    }
  })

  it('persists doc state across a server restart', async () => {
    const c1 = connect(relay.port, DOC, TOKEN)
    await until(() => c1.provider.synced, 'client 1 synced')
    c1.doc.getText('content').insert(0, 'survives restarts')
    await until(
      () => c1.provider.synced && !c1.provider.hasUnsyncedChanges,
      'update acked by relay',
    )

    // Disconnect, then destroy — destroy flushes the debounced store.
    for (const c of clients.splice(0)) {
      c.provider.destroy()
      c.socket.destroy()
    }
    await relay.destroy()

    relay = createRelay({ dbPath: join(dir, 'relay.db') })
    await relay.listen()

    const c2 = connect(relay.port, DOC, TOKEN)
    await until(
      () => c2.doc.getText('content').toString() === 'survives restarts',
      'restarted relay to serve the persisted doc',
    )
  })
})
