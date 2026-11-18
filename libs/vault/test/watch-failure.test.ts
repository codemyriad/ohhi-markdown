/**
 * A watcher that fails is an error the app reports (golden rule 4 in spirit):
 * the failure travels from the adapter, through every wrapper a mount puts
 * around it, to `VaultSession`'s `events.onError`.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import {
  ignoringAdapter,
  MemVaultAdapter,
  scopedAdapter,
  VaultSession,
  type LcaStore,
  type PreImageJournal,
  type VaultAdapter,
  type WatchEvent,
} from '../src/index.js'
import { NodeVaultAdapter } from '../src/node-adapter.js'

/** A MemVaultAdapter whose watcher fails to start. */
class DeadWatchAdapter extends MemVaultAdapter {
  override watch(_cb: (ev: WatchEvent) => void, onError?: (err: unknown) => void): () => void {
    onError?.(new Error('no watcher'))
    return () => {}
  }
}

const lcaStore: LcaStore = {
  get: async () => null,
  put: async () => {},
  remove: async () => {},
  all: async () => [],
} as unknown as LcaStore
const journal = { record: async () => {}, rename: async () => {} } as unknown as PreImageJournal

function sessionOver(adapter: VaultAdapter, errors: unknown[]): VaultSession {
  const engine = createYjsEngine()
  return new VaultSession({
    engine,
    adapter,
    lcaStore,
    journal,
    clock: new SimClock(),
    folderDoc: engine.createDoc('folder'),
    docs: new Map(),
    events: { onError: (err) => errors.push(err) },
  })
}

describe('a watcher that fails reaches the session’s onError', () => {
  it('straight from the adapter', async () => {
    const errors: unknown[] = []
    await sessionOver(new DeadWatchAdapter(), errors).start()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('no watcher')
  })

  it('through a mount’s scoped view and the root’s ignoring view', async () => {
    for (const wrap of [
      (a: VaultAdapter) => scopedAdapter(a, 'team'),
      (a: VaultAdapter) => ignoringAdapter(a, new Set(['team'])),
    ]) {
      const errors: unknown[] = []
      await sessionOver(wrap(new DeadWatchAdapter()), errors).start()
      expect(errors).toHaveLength(1)
    }
  })
})

describe('NodeVaultAdapter watch', () => {
  it('reports a root it cannot watch instead of throwing, when a listener is given', async () => {
    const base = await mkdtemp(join(tmpdir(), 'ohhi-watch-'))
    try {
      const adapter = new NodeVaultAdapter(join(base, 'missing'))
      const errors: unknown[] = []
      const off = adapter.watch(() => {}, (err) => errors.push(err))
      off()
      expect(errors).toHaveLength(1)
      // Without one, the historical throw.
      expect(() => adapter.watch(() => {})).toThrow()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
