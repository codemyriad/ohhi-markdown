/**
 * Live membership, enrol-on-create (nextcloud-build decision 11): with
 * `enrollOnCreate`, a text file that appears on disk while the session runs
 * is enrolled through the boot delta scan's own step (`enrollOne`) — fresh
 * guid, LCA with the seed, provider attached — behind the mass-change
 * breaker. Off (the default) it is ignored exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { MemStoreDir, OHHI_HOST_MARKER } from '@ohhi/vault'
import { bootDuo, bootVault, dec, enc, seedAdapter, yieldMacro, type BootedVault } from './fixture.js'

const ROOM = 'root-room'

async function tick(vault: BootedVault, rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    vault.clock.advance(100)
    for (let j = 0; j < 4; j++) await yieldMacro()
  }
}

const row = (vault: BootedVault, path: string) => vault.root.files().find((r) => r.path === path)

describe('enrol on create (decision 11)', () => {
  it('enrols a file written after boot when on, and not when off', async () => {
    for (const on of [true, false]) {
      const base = await seedAdapter({ 'a.md': 'alpha\n' })
      const vault = await bootVault(base, new MemStoreDir(), ROOM, {
        sessionDefaults: () => ({ enrollOnCreate: on }),
      })
      try {
        await base.writeAtomic('notes/new.md', enc.encode('fresh\n'))
        await tick(vault)
        if (on) {
          const r = row(vault, 'notes/new.md')
          expect(r?.kind).toBe('text')
          expect(vault.root.docForPath('notes/new.md')?.getText()).toBe('fresh\n')
          // The new folder is a first-class dir entry, as the boot scan makes it.
          expect(row(vault, 'notes')?.kind).toBe('dir')
          // Bound live: a later edit on disk ingests into the same doc.
          await base.writeAtomic('notes/new.md', enc.encode('fresh, edited\n'))
          await tick(vault)
          expect(row(vault, 'notes/new.md')?.guid).toBe(r!.guid)
          expect(vault.root.docForPath('notes/new.md')?.getText()).toBe('fresh, edited\n')
        } else {
          expect(row(vault, 'notes/new.md')).toBeUndefined()
          expect(row(vault, 'notes')).toBeUndefined()
        }
        expect(vault.events.errors).toEqual([])
      } finally {
        vault.dispose()
      }
    }
  })

  it('holds a batch above the threshold until confirmBreaker()', async () => {
    const base = await seedAdapter({ 'a.md': 'alpha\n' })
    const held: string[][] = []
    const vault = await bootVault(base, new MemStoreDir(), ROOM, {
      sessionDefaults: () => ({
        enrollOnCreate: true,
        thresholds: { massChangePaths: 2 },
        events: { onBreaker: (paths: string[]) => held.push(paths) },
      }),
    })
    try {
      base.autoEmit = false
      for (const p of ['x.md', 'y.md', 'z.md']) await base.writeAtomic(p, enc.encode(`${p}\n`))
      base.autoEmit = true
      base.emitBatch(['x.md', 'y.md', 'z.md'])
      await tick(vault)
      expect(held).toEqual([['x.md', 'y.md', 'z.md']])
      expect(vault.root.files().map((r) => r.path)).toEqual(['a.md'])

      await vault.root.confirmBreaker()
      await tick(vault)
      expect(vault.root.files().map((r) => [r.path, r.kind])).toEqual([
        ['a.md', 'text'],
        ['x.md', 'text'],
        ['y.md', 'text'],
        ['z.md', 'text'],
      ])
      expect(vault.root.docForPath('y.md')?.getText()).toBe('y.md\n')
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('maps a binary as an attachment, never a note; ignores the marker and .obsidian/', async () => {
    const base = await seedAdapter({ 'a.md': 'alpha\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOM, {
      sessionDefaults: () => ({ enrollOnCreate: true }),
    })
    try {
      await base.writeAtomic('pic.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))
      await base.writeAtomic(OHHI_HOST_MARKER, enc.encode('---\nroom: r\n---\n'))
      await base.writeAtomic('.obsidian/workspace.json', enc.encode('{}'))
      await tick(vault)
      expect(row(vault, 'pic.png')?.kind).toBe('binary')
      expect(vault.root.docForPath('pic.png')).toBeNull()
      expect(row(vault, OHHI_HOST_MARKER)).toBeUndefined()
      expect(vault.root.files().some((r) => r.path.startsWith('.obsidian'))).toBe(false)
      // A second change to the binary does not re-enrol it under a new guid.
      const guid = row(vault, 'pic.png')!.guid
      await base.writeAtomic('pic.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 9]))
      await tick(vault)
      expect(row(vault, 'pic.png')?.guid).toBe(guid)
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('a live-enrolled note reaches the second peer', async () => {
    const duo = await bootDuo({
      files: { 'a.md': 'alpha\n' },
      defaultsA: () => ({ enrollOnCreate: true }),
    })
    try {
      await duo.a.adapter.writeAtomic('inbox/new.md', enc.encode('hello from disk\n'))
      await duo.deliver()
      await duo.deliver()
      const guid = duo.a.root.files().find((r) => r.path === 'inbox/new.md')?.guid
      expect(guid).toBeDefined()
      expect(duo.b.root.files().find((r) => r.path === 'inbox/new.md')?.guid).toBe(guid)
      expect(dec.decode((await duo.b.adapter.read('inbox/new.md'))!)).toBe('hello from disk\n')
      expect(duo.a.events.errors).toEqual([])
      expect(duo.b.events.errors).toEqual([])
      expect(duo.a.events.reviews).toEqual([])
      expect(duo.b.events.reviews).toEqual([])
    } finally {
      duo.dispose()
    }
  })
})
