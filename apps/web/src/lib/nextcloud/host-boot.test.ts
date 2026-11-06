/**
 * The Nextcloud host's boot: `/api/me` sets the storage namespace before any
 * config read (decision 16); the launch parameters are read defensively.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setStorageNamespace, storageNamespace } from '../host.js'
import { nextcloudHost, parseLaunch, prepareNextcloudHost, resetNextcloudHost, UNKNOWN_NAMESPACE } from './host-boot.js'

const NC = { kind: 'nextcloud' as const, apiBase: '/exapps/ohhi/api', relayUrl: 'ws://nc/exapps/ohhi/ws' }

const answering = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

afterEach(() => {
  setStorageNamespace('')
  resetNextcloudHost()
})

describe('parseLaunch', () => {
  it('takes the first numeric file id and a vault-relative note', () => {
    expect(parseLaunch('?fileIds=12,13&open=Daily/2026-10-11.md')).toEqual({ fileId: 12, open: 'Daily/2026-10-11.md' })
    expect(parseLaunch('')).toEqual({ fileId: null, open: null })
  })

  it('reads anything malformed as absent', () => {
    expect(parseLaunch('?fileIds=abc').fileId).toBeNull()
    expect(parseLaunch('?fileIds=0').fileId).toBeNull()
    expect(parseLaunch('?fileIds=-4').fileId).toBeNull()
    expect(parseLaunch('?open=/etc/passwd').open).toBeNull()
    expect(parseLaunch('?open=a/../b.md').open).toBeNull()
    expect(parseLaunch('?open=a//b.md').open).toBeNull()
    expect(parseLaunch('?open=a\\b.md').open).toBeNull()
  })
})

describe('prepareNextcloudHost', () => {
  it('does nothing outside Nextcloud', async () => {
    expect(await prepareNextcloudHost({ kind: 'browser' }, '')).toBeNull()
    expect(storageNamespace()).toBe('')
    expect(nextcloudHost()).toBeNull()
  })

  it('sets the namespace to the uid and keeps the display name', async () => {
    const host = await prepareNextcloudHost(NC, '?fileIds=9', answering(200, { uid: 'alice', displayName: 'Alice A.' }))
    expect(storageNamespace()).toBe('alice')
    expect(host?.me).toEqual({ uid: 'alice', displayName: 'Alice A.' })
    expect(host?.launch.fileId).toBe(9)
    expect(nextcloudHost()).toBe(host)
  })

  it('a failed /me isolates the boot under a namespace no uid can have, and says why', async () => {
    const host = await prepareNextcloudHost(NC, '', answering(401, { error: 'unauthorised' }))
    expect(storageNamespace()).toBe(UNKNOWN_NAMESPACE)
    expect(host?.me).toBeNull()
    expect(host?.error).toBeTruthy()
  })
})
