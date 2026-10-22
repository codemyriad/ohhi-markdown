/**
 * The ExApp API client: same-origin credentials, the CSRF header, JSON, and
 * failures as `NcApiError`s worded through i18n.
 */
import { getLL } from '@ohhi/i18n'
import { describe, expect, it } from 'vitest'
import { createNcApi, NcApiError, ncErrorText, parseFileId } from './api.js'

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(answer: (url: string) => { status: number; body?: unknown }): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const a = answer(url)
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status })
  }) as unknown as typeof fetch
  return { fetch: f, calls }
}

describe('createNcApi', () => {
  it('sends same-origin credentials, X-Ohhi-Request and JSON on every call', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { uid: 'alice', displayName: 'Alice' } }))
    const api = createNcApi('/exapps/ohhi/api/', fetch)
    expect(await api.me()).toEqual({ uid: 'alice', displayName: 'Alice' })
    await api.grant({ vaultId: 'v1' })
    await api.enrol(42)
    await api.status('v1')
    await api.resolveHold('v1', 'h/1', 'confirm')
    await api.remove('v1')
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', '/exapps/ohhi/api/me'],
      ['POST', '/exapps/ohhi/api/session'],
      ['POST', '/exapps/ohhi/api/vaults'],
      ['GET', '/exapps/ohhi/api/vaults/v1/status'],
      ['POST', '/exapps/ohhi/api/vaults/v1/holds/h%2F1'],
      ['DELETE', '/exapps/ohhi/api/vaults/v1'],
    ])
    for (const c of calls) {
      expect(c.init.credentials).toBe('same-origin')
      expect((c.init.headers as Record<string, string>)['X-Ohhi-Request']).toBe('1')
    }
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ vaultId: 'v1' })
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ fileId: 42 })
    expect(JSON.parse(calls[4]!.init.body as string)).toEqual({ action: 'confirm' })
    expect((calls[1]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('turns an error answer into an NcApiError carrying the status and the reason', async () => {
    const { fetch } = fakeFetch(() => ({ status: 409, body: { error: 'refused', reason: 'inside an enrolled vault' } }))
    const err = await createNcApi('/api', fetch)
      .enrol(1)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NcApiError)
    expect((err as NcApiError).status).toBe(409)
    expect((err as NcApiError).reason).toBe('inside an enrolled vault')
    expect(ncErrorText(err)).toBe(getLL().web.nextcloud.manager.errors.refused_reason({ reason: 'inside an enrolled vault' }))
  })

  it('words an unreachable server, a 501 stub and an unknown status', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const err = await createNcApi('/api', down)
      .me()
      .catch((e: unknown) => e)
    expect((err as NcApiError).status).toBe(0)
    const t = getLL().web.nextcloud.manager.errors
    expect(ncErrorText(err)).toBe(t.unreachable())
    expect(ncErrorText(new NcApiError(501, 'not implemented'))).toBe(t.not_ready())
    expect(ncErrorText(new NcApiError(418, ''))).toBe(t.server({ status: 418 }))
    expect(ncErrorText(new Error('boom'))).toBe(t.unexpected({ message: 'boom' }))
  })
})

describe('parseFileId', () => {
  it('accepts only a positive numeric file id', () => {
    expect(parseFileId(' 1234 ')).toBe(1234)
    expect(parseFileId('12a')).toBeNull()
    expect(parseFileId('0')).toBeNull()
    expect(parseFileId('')).toBeNull()
    expect(parseFileId('99999999999999999')).toBeNull()
  })
})
