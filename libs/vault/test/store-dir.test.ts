import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import { NodeStoreDir } from '../src/node-adapter.js'
import type { StoreDir } from '../src/store-dir.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

/** Contract suite run against every StoreDir implementation. */
function storeDirContract(name: string, make: () => Promise<{ dir: StoreDir; cleanup?: () => Promise<void> }>) {
  describe(`${name}: StoreDir contract`, () => {
    let cleanup: (() => Promise<void>) | undefined
    afterEach(async () => {
      await cleanup?.()
      cleanup = undefined
    })

    it('round-trips and overwrites a named file', async () => {
      const made = await make()
      cleanup = made.cleanup
      const io = made.dir.io('room-a/lca.json')
      expect(await io.read()).toBeNull()
      await io.writeAtomic(enc('one'))
      expect(dec(await io.read())).toBe('one')
      await io.writeAtomic(enc('two'))
      expect(dec(await io.read())).toBe('two')
    })

    it('lists by raw prefix, nested names included', async () => {
      const made = await make()
      cleanup = made.cleanup
      await made.dir.io('mounts.json').writeAtomic(enc('m'))
      await made.dir.io('room-a/lca.json').writeAtomic(enc('l'))
      await made.dir.io('room-a/docs/g1.bin').writeAtomic(enc('d'))
      await made.dir.io('room-b/lca.json').writeAtomic(enc('l'))
      expect(await made.dir.list()).toEqual([
        'mounts.json',
        'room-a/docs/g1.bin',
        'room-a/lca.json',
        'room-b/lca.json',
      ])
      expect(await made.dir.list('room-a/')).toEqual(['room-a/docs/g1.bin', 'room-a/lca.json'])
      expect(await made.dir.list('room-a/docs/')).toEqual(['room-a/docs/g1.bin'])
    })

    it('remove drops the file; removing a missing name is a no-op', async () => {
      const made = await make()
      cleanup = made.cleanup
      await made.dir.io('a/b.bin').writeAtomic(enc('x'))
      await made.dir.remove('a/b.bin')
      expect(await made.dir.io('a/b.bin').read()).toBeNull()
      await expect(made.dir.remove('never-existed')).resolves.toBeUndefined()
    })
  })
}

storeDirContract('MemStoreDir', async () => ({ dir: new MemStoreDir() }))

storeDirContract('NodeStoreDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-store-dir-'))
  return {
    dir: new NodeStoreDir(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
})

describe('NodeStoreDir specifics', () => {
  it('lists [] for a store dir that was never written to', async () => {
    const root = join(tmpdir(), `editor-store-dir-missing-${process.pid}`)
    const dir = new NodeStoreDir(root)
    expect(await dir.list()).toEqual([])
  })

  it('rejects names escaping the store root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'editor-store-dir-'))
    const dir = new NodeStoreDir(root)
    expect(() => dir.io('../outside.bin')).toThrow(/escapes/)
    await rm(root, { recursive: true, force: true })
  })
})
