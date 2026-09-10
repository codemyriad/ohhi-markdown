import { describe, expect, it } from 'vitest'
import {
  checkThenRequest,
  estimateUsage,
  formatBytes,
  persistOnce,
  readPersistence,
  requestPersistence,
  shouldWarnAboutStorage,
  type PersistApi,
  type PersistState,
} from './storage-persistence.js'

/** A fake `navigator.storage`: what the browser has decided, and what it will answer. */
function fakeStorage(opts: { persisted?: boolean; grants?: boolean; throws?: boolean } = {}) {
  const calls = { persisted: 0, persist: 0 }
  let persisted = opts.persisted ?? false
  const api: PersistApi = {
    persisted: async () => {
      calls.persisted++
      if (opts.throws) throw new Error('boom')
      return persisted
    },
    persist: () => {
      calls.persist++
      if (opts.throws) return Promise.reject(new Error('boom'))
      if (opts.grants) persisted = true
      return Promise.resolve(persisted)
    },
    estimate: async () => ({ usage: 2_500_000, quota: 300_000_000_000 }),
  }
  return { api, calls }
}

describe('reading and asking', () => {
  it('reads the decision without asking', async () => {
    const kept = fakeStorage({ persisted: true })
    expect(await readPersistence(kept.api)).toBe('persisted')
    const not = fakeStorage()
    expect(await readPersistence(not.api)).toBe('best-effort')
    expect(not.calls.persist).toBe(0)
  })

  it('no API at all is unsupported, never a crash', async () => {
    expect(await readPersistence(undefined)).toBe('unsupported')
    expect(await readPersistence({})).toBe('unsupported')
    expect(await requestPersistence(undefined)).toBe('unsupported')
  })

  it('a throwing browser degrades to best-effort (still worth asking)', async () => {
    const { api } = fakeStorage({ throws: true })
    expect(await readPersistence(api)).toBe('best-effort')
    expect(await requestPersistence(api)).toBe('best-effort')
  })

  it('calls persist() synchronously, so a click keeps its user gesture (Firefox)', () => {
    const { api, calls } = fakeStorage({ grants: true })
    void requestPersistence(api)
    // Before any await: the call happened inside the caller's task.
    expect(calls.persist).toBe(1)
  })

  it('reports a grant and a silent refusal (Chrome) alike', async () => {
    expect(await requestPersistence(fakeStorage({ grants: true }).api)).toBe('persisted')
    expect(await requestPersistence(fakeStorage({ grants: false }).api)).toBe('best-effort')
  })
})

describe('the launch check', () => {
  it('asks only when the browser has not already agreed', async () => {
    const kept = fakeStorage({ persisted: true })
    expect(await checkThenRequest(kept.api)).toBe('persisted')
    expect(kept.calls.persist).toBe(0)

    const not = fakeStorage({ grants: true })
    expect(await checkThenRequest(not.api)).toBe('persisted')
    expect(not.calls.persist).toBe(1)
  })

  it('happens once per page, however many callers want it', async () => {
    const { api, calls } = fakeStorage()
    const ensure = persistOnce(() => api)
    const [a, b] = await Promise.all([ensure(), ensure()])
    await ensure()
    expect([a, b]).toEqual(['best-effort', 'best-effort'])
    expect(calls.persisted).toBe(1)
    expect(calls.persist).toBe(1) // one prompt, never two
  })
})

describe('shouldWarnAboutStorage', () => {
  const base = { tauri: false, browserVault: true, dismissed: false }

  it('warns in a browser vault whose storage is not guaranteed', () => {
    expect(shouldWarnAboutStorage({ ...base, state: 'best-effort' })).toBe(true)
    expect(shouldWarnAboutStorage({ ...base, state: 'unsupported' })).toBe(true)
  })

  it('stays quiet when the storage is kept, or before the browser has answered', () => {
    expect(shouldWarnAboutStorage({ ...base, state: 'persisted' })).toBe(false)
    expect(shouldWarnAboutStorage({ ...base, state: 'unknown' })).toBe(false)
  })

  it('never nags: not in the desktop app, not without a browser vault, not once dismissed', () => {
    const states: PersistState[] = ['unknown', 'persisted', 'best-effort', 'unsupported']
    for (const state of states) {
      expect(shouldWarnAboutStorage({ ...base, state, tauri: true })).toBe(false)
      expect(shouldWarnAboutStorage({ ...base, state, browserVault: false })).toBe(false)
      expect(shouldWarnAboutStorage({ ...base, state, dismissed: true })).toBe(false)
    }
  })
})

describe('usage', () => {
  it('estimates, and degrades to null when the browser cannot', async () => {
    expect(await estimateUsage(fakeStorage().api)).toEqual({ usage: 2_500_000, quota: 300_000_000_000 })
    expect(await estimateUsage(undefined)).toBeNull()
    expect(await estimateUsage({ estimate: async () => ({}) })).toBeNull()
    expect(await estimateUsage({ estimate: () => Promise.reject(new Error('no')) })).toBeNull()
  })

  it('formats bytes in the reader’s locale, from kilobytes up', () => {
    expect(formatBytes(0, 'en')).toBe('0 kB')
    expect(formatBytes(512, 'en')).toBe('0.5 kB')
    expect(formatBytes(2_500_000, 'en')).toBe('2.5 MB')
    expect(formatBytes(300_000_000_000, 'en')).toBe('300 GB')
    expect(formatBytes(-5, 'en')).toBe('0 kB')
  })
})
