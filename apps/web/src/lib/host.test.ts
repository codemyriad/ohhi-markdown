import { afterEach, describe, expect, it } from 'vitest'
import { detectHost, NEXTCLOUD_UI_PREFIX, nsId, nsKey, setStorageNamespace, storageNamespace } from './host.js'

describe('detectHost', () => {
  it('is the browser outside the ExApp path', () => {
    expect(detectHost({ pathname: '/', protocol: 'http:', host: 'localhost:5173' })).toEqual({ kind: 'browser' })
    expect(detectHost(null)).toEqual({ kind: 'browser' })
  })
  it('is nextcloud under the ExApp UI prefix, with the same-origin relay', () => {
    const host = detectHost({ pathname: `${NEXTCLOUD_UI_PREFIX}index.html`, protocol: 'https:', host: 'cloud.example.com' })
    expect(host).toEqual({
      kind: 'nextcloud',
      apiBase: '/exapps/ohhi/api',
      relayUrl: 'wss://cloud.example.com/exapps/ohhi/ws',
    })
    expect(detectHost({ pathname: NEXTCLOUD_UI_PREFIX, protocol: 'http:', host: 'localhost:28090' }).relayUrl).toBe(
      'ws://localhost:28090/exapps/ohhi/ws'
    )
  })
  it('does not match a look-alike path', () => {
    expect(detectHost({ pathname: '/exapps/ohhi-other/ui/', protocol: 'https:', host: 'x' }).kind).toBe('browser')
  })
})

describe('storage namespace', () => {
  afterEach(() => setStorageNamespace(''))
  it('is the identity outside Nextcloud', () => {
    expect(storageNamespace()).toBe('')
    expect(nsKey('editor:config')).toBe('editor:config')
    expect(nsId('abc')).toBe('abc')
  })
  it('prefixes keys and ids with the uid inside Nextcloud', () => {
    setStorageNamespace('alice')
    expect(nsKey('editor:config')).toBe('nc:alice:editor:config')
    expect(nsId('abc')).toBe('nc-alice--abc')
  })
})
