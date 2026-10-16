/**
 * One tab per browser vault (join-share-brief P3): the claim answers at once
 * — the release function when the vault is free, null when another tab holds
 * it — and the lock lives exactly as long as the claim.
 */
import { describe, expect, it } from 'vitest'
import { claimVaultLock, vaultLockName, type VaultLocks } from './vault-lock.js'

/** A LockManager that remembers who holds what, as the browser's does across tabs. */
function fakeLocks() {
  const held = new Map<string, Promise<unknown>>()
  const locks: VaultLocks = {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null)
      const lifetime = Promise.resolve(callback({ name }))
      held.set(name, lifetime)
      await lifetime
      held.delete(name)
      return undefined
    },
  }
  return { locks, held }
}

describe('claimVaultLock', () => {
  it('a free vault is claimed, and the lock is held until the claim is released', async () => {
    const { locks, held } = fakeLocks()
    const release = await claimVaultLock('v1', locks)
    expect(release).toBeTypeOf('function')
    expect(held.has(vaultLockName('v1'))).toBe(true)

    // The same vault from "another tab": refused, at once.
    expect(await claimVaultLock('v1', locks)).toBeNull()
    // Another vault is another lock.
    expect(await claimVaultLock('v2', locks)).toBeTypeOf('function')

    release!()
    await Promise.resolve()
    await Promise.resolve()
    expect(held.has(vaultLockName('v1'))).toBe(false)
    expect(await claimVaultLock('v1', locks)).toBeTypeOf('function')
  })

  it('a browser without Web Locks claims unconditionally — nothing it cannot tell apart is refused', async () => {
    expect(await claimVaultLock('v1', undefined)).toBeTypeOf('function')
  })

  it('a locks API that throws does not refuse either', async () => {
    const locks: VaultLocks = {
      request: () => Promise.reject(new Error('SecurityError')),
    }
    expect(await claimVaultLock('v1', locks)).toBeTypeOf('function')
  })
})
