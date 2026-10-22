/**
 * The host hooks (nextcloud-build decision 18): `authenticate` replaces the
 * shares-table check and `onRequest` is consulted before the built-in HTTP
 * routes. Without hooks nothing changes — relay.test.ts covers that path.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createRelay, type AuthenticateInput, type Relay } from '../src/server.ts'
import { RelayDb } from '../src/db.ts'

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('relay hooks', () => {
  let dir: string
  let relay: Relay | null = null
  const cleanups: (() => void)[] = []

  afterEach(async () => {
    for (const c of cleanups.splice(0)) c()
    await relay?.destroy()
    relay = null
    rmSync(dir, { recursive: true, force: true })
  })

  function connect(port: number, name: string, token: string) {
    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}`, WebSocketPolyfill: WebSocket })
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
    provider.attach()
    cleanups.push(() => {
      provider.destroy()
      socket.destroy()
    })
    return { doc, provider, reason: () => reason }
  }

  it('authenticate replaces the shares table and its context reaches the connection', async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-hooks-'))
    const seen: AuthenticateInput[] = []
    relay = createRelay({
      dbPath: join(dir, 'relay.db'),
      authenticate: async (input) => {
        seen.push(input)
        if (input.token !== 'good') throw new Error('refused by host')
        return { readOnly: input.documentName.endsWith('/ro'), context: { uid: 'alice' } }
      },
    })
    await relay.listen()
    // No shares row exists for 'good' — only the hook admits it.
    const ok = connect(relay.port, 'room/doc', 'good')
    await until(() => ok.provider.synced, 'good token synced')
    expect(seen[0]?.documentName).toBe('room/doc')
    expect(typeof seen[0]?.requestHeaders).toBe('object')

    const bad = connect(relay.port, 'room/doc', 'bad')
    await until(() => bad.reason() !== null, 'bad token refused')
    // Hocuspocus reports every refusal as permission-denied; the hook's
    // message stays server-side (a reason is not a channel to the client).
    expect(bad.reason()).toBe('permission-denied')

    // readOnly from the hook: an update over the read-only connection is dropped.
    const ro = connect(relay.port, 'room/ro', 'good')
    await until(() => ro.provider.synced, 'ro synced')
    ro.doc.getText('t').insert(0, 'should not land')
    const reader = connect(relay.port, 'room/ro', 'good')
    await until(() => reader.provider.synced, 'reader synced')
    await new Promise((r) => setTimeout(r, 200))
    expect(reader.doc.getText('t').toString()).toBe('')
  })

  it('onRequest is consulted before the built-in routes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-hooks-'))
    relay = createRelay({
      dbPath: join(dir, 'relay.db'),
      onRequest: async (req, res) => {
        if (req.url === '/api/me') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ uid: 'alice' }))
          return true
        }
        return false
      },
    })
    await relay.listen()
    const me = await fetch(`http://127.0.0.1:${relay.port}/api/me`)
    expect(await me.json()).toEqual({ uid: 'alice' })
    const health = await fetch(`http://127.0.0.1:${relay.port}/healthz`)
    expect(await health.json()).toEqual({ ok: true })
  })

  it('shares carry the Nextcloud binding columns and expire', () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-hooks-'))
    const db = new RelayDb(join(dir, 'relay.db'))
    db.addShare({ token: 'static', folderGuid: 'f1' })
    db.addShare({ token: 'bound', folderGuid: 'f1', ncUid: 'alice', vaultId: 'v1', expiresAt: 1_000 })
    expect(db.getShare('static')).toMatchObject({ ncUid: null, vaultId: null, expiresAt: null })
    expect(db.getShare('bound')).toMatchObject({ ncUid: 'alice', vaultId: 'v1', expiresAt: 1_000 })
    expect(db.removeExpiredShares(999)).toBe(0)
    expect(db.removeExpiredShares(1_000)).toBe(1)
    expect(db.getShare('bound')).toBeNull()
    expect(db.getShare('static')).not.toBeNull()
    db.close()
  })
})
