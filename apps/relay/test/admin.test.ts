/**
 * Operator admin HTTP API (M4): auth gating, mint/list/revoke, and the
 * revocation semantics that matter — a revoked token is refused at the NEXT
 * connection (live connections are not dropped; R4.3 deferred by decision).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { createRelay, type Relay } from '../src/server.ts'

const SECRET = 'operator-secret-for-tests'

describe('relay admin API', () => {
  let dir: string
  let relay: Relay
  const cleanups: (() => void)[] = []

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-admin-test-'))
    relay = createRelay({ dbPath: join(dir, 'relay.db'), operatorSecret: SECRET })
    await relay.listen()
  })

  afterEach(async () => {
    for (const c of cleanups.splice(0)) c()
    await relay.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  const call = (
    method: string,
    path: string,
    opts: { secret?: string; body?: unknown } = {}
  ): Promise<Response> =>
    fetch(`http://127.0.0.1:${relay.port}${path}`, {
      method,
      headers: {
        ...(opts.secret ? { authorization: `Bearer ${opts.secret}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })

  it('requires the operator secret: missing → 401, wrong → 401', async () => {
    expect((await call('GET', '/shares')).status).toBe(401)
    expect((await call('GET', '/shares', { secret: 'wrong' })).status).toBe(401)
    expect(
      (await call('POST', '/shares', { secret: 'wrong', body: { folderGuid: 'f' } })).status
    ).toBe(401)
  })

  it('answers 404 when no secret is configured (admin HTTP does not exist)', async () => {
    const bare = createRelay({ dbPath: join(dir, 'bare.db') })
    await bare.listen()
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/shares`, {
        headers: { authorization: `Bearer ${SECRET}` },
      })
      expect(res.status).toBe(404)
    } finally {
      await bare.destroy()
    }
  })

  it('mints, lists (with folder filter), and revokes shares', async () => {
    const minted = await call('POST', '/shares', {
      secret: SECRET,
      body: { folderGuid: 'folder-a', label: 'laptop', readOnly: false },
    })
    expect(minted.status).toBe(200)
    const share = (await minted.json()) as { token: string; folderGuid: string; label: string }
    expect(share.folderGuid).toBe('folder-a')
    expect(share.label).toBe('laptop')
    expect(share.token).toMatch(/^[0-9a-f]{64}$/)

    await call('POST', '/shares', { secret: SECRET, body: { folderGuid: 'folder-b', readOnly: true } })

    const all = (await (await call('GET', '/shares', { secret: SECRET })).json()) as {
      shares: { folderGuid: string; readOnly: boolean }[]
    }
    expect(all.shares).toHaveLength(2)

    const filtered = (await (
      await call('GET', '/shares?folder=folder-a', { secret: SECRET })
    ).json()) as { shares: { token: string }[] }
    expect(filtered.shares).toHaveLength(1)
    expect(filtered.shares[0]!.token).toBe(share.token)

    const revoked = await call('DELETE', `/shares/${share.token}`, { secret: SECRET })
    expect(revoked.status).toBe(200)
    expect(((await (await call('GET', '/shares', { secret: SECRET })).json()) as { shares: unknown[] }).shares).toHaveLength(1)
    // Revoking an unknown token is a 404, not a silent success.
    expect((await call('DELETE', `/shares/${share.token}`, { secret: SECRET })).status).toBe(404)
  })

  it('rejects bad mint bodies without leaking internals', async () => {
    const res = await call('POST', '/shares', { secret: SECRET, body: { label: 'no folder' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('folderGuid is required')
  })

  it('a revoked token is refused at the next connection', async () => {
    const minted = (await (
      await call('POST', '/shares', { secret: SECRET, body: { folderGuid: 'fR' } })
    ).json()) as { token: string }

    const connectOnce = async (): Promise<string | null> => {
      const doc = new Y.Doc()
      const socket = new HocuspocusProviderWebsocket({
        url: `ws://127.0.0.1:${relay.port}`,
        WebSocketPolyfill: WebSocket,
      })
      let failed: string | null = null
      const provider = new HocuspocusProvider({
        name: 'fR/d1',
        document: doc,
        token: minted.token,
        websocketProvider: socket,
        onAuthenticationFailed: (data) => {
          failed = data.reason
        },
      })
      provider.attach()
      cleanups.push(() => {
        provider.destroy()
        socket.destroy()
      })
      const deadline = Date.now() + 5000
      while (!provider.isAuthenticated && failed === null) {
        if (Date.now() > deadline) throw new Error('timed out waiting for auth outcome')
        await new Promise((r) => setTimeout(r, 20))
      }
      return failed
    }

    expect(await connectOnce()).toBeNull() // authenticates while the share exists
    await call('DELETE', `/shares/${minted.token}`, { secret: SECRET })
    expect(await connectOnce()).toBe('unknown_token') // blocked on the NEXT connection
  })
})
