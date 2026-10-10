/**
 * `writeAttachment(path, bytes)` — the pasted / dropped picture's write
 * (editor-usability E5). Golden rule 1 shaped like createFile's suite: the
 * write is journaled and atomic, and it NEVER replaces bytes that are already
 * there — a taken name moves aside to `name 1.ext`.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { MemJournal, MemLcaStore, MemVaultAdapter } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import type { FileRow, SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()
/** A PNG's signature plus a NUL: binary by extension and by content. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02])
const OTHER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

async function boot(seed: Record<string, string | Uint8Array> = {}) {
  const adapter = new MemVaultAdapter()
  for (const [path, body] of Object.entries(seed)) {
    await adapter.writeAtomic(path, typeof body === 'string' ? enc.encode(body) : body)
  }
  const clock = new SimClock()
  const journal = new MemJournal(() => clock.now())
  let files: FileRow[] = []
  const errors: unknown[] = []
  const cfg: MountSessionConfig = {
    engine: createYjsEngine(),
    adapter,
    user: { name: 'T', color: '#000' },
    room: 'r',
    clock,
    lcaStore: new MemLcaStore(),
    journal,
    recordFor: (): SyncRecordFields => ({
      connected: false,
      synced: false,
      pendingLocal: false,
      diskMatchesCrdt: true,
      diverged: false,
    }),
    makeShareLink: () => 'link',
    events: {
      onFiles: (rows) => {
        files = rows
      },
      onError: (err) => errors.push(err),
    },
  }
  const session = await MountSession.create(cfg)
  return { session, adapter, journal, errors, files: () => files }
}

describe('writeAttachment', () => {
  it('writes the bytes exactly, journaled, and enrols them as a binary with no doc', async () => {
    const h = await boot({ 'Note.md': '# Note\n' })
    const path = await h.session.writeAttachment('Pasted image 20261010140307.png', PNG)
    expect(path).toBe('Pasted image 20261010140307.png')
    expect(await h.adapter.read(path!)).toEqual(PNG)
    // A create journals a pre-image of null: the record says we made the path.
    const entries = await h.journal.entries(path!)
    expect(entries).toHaveLength(1)
    // Honest enrolment (D2f): a binary row, no CRDT doc to sync.
    expect(h.files().find((r) => r.path === path)?.kind).toBe('binary')
    expect(h.session.docForPath(path!)).toBeNull()
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it('never overwrites a file the map does not know — it moves aside', async () => {
    const h = await boot()
    // Written by Obsidian while Editor ran: on disk, not in the map.
    await h.adapter.writeAtomic('shot.png', OTHER)
    const path = await h.session.writeAttachment('shot.png', PNG)
    expect(path).toBe('shot 1.png')
    expect(await h.adapter.read('shot.png')).toEqual(OTHER)
    expect(await h.adapter.read('shot 1.png')).toEqual(PNG)
    h.session.dispose()
  })

  it('never overwrites a file the map does know, and counts on past every taken name', async () => {
    const h = await boot({ 'a.png': OTHER, 'a 1.png': OTHER })
    expect(h.files().find((r) => r.path === 'a.png')?.kind).toBe('binary')
    expect(await h.session.writeAttachment('a.png', PNG)).toBe('a 2.png')
    expect(await h.adapter.read('a.png')).toEqual(OTHER)
    expect(await h.adapter.read('a 1.png')).toEqual(OTHER)
    h.session.dispose()
  })

  it('creates the folder it goes in as map entries (M3)', async () => {
    const h = await boot()
    const path = await h.session.writeAttachment('Notes/Attachments/x.png', PNG)
    expect(path).toBe('Notes/Attachments/x.png')
    expect(h.files().find((r) => r.path === 'Notes/Attachments')?.kind).toBe('dir')
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it.each([
    ['../escape.png'],
    ['a/../../escape.png'],
    ['a\\b.png'],
    ['.ohhi/themes/x.png'],
    ['.obsidian/x.png'],
    ['sub/.git/x.png'],
  ])('refuses %s, writing nothing', async (bad) => {
    const h = await boot()
    expect(await h.session.writeAttachment(bad, PNG)).toBeNull()
    expect(h.errors).toHaveLength(1)
    expect(await h.journal.entries(bad)).toHaveLength(0)
    h.session.dispose()
  })

  it('refuses a text type, which would need a doc this path does not make', async () => {
    const h = await boot()
    expect(await h.session.writeAttachment('notes.md', enc.encode('# hi'))).toBeNull()
    expect(await h.adapter.read('notes.md')).toBeNull()
    h.session.dispose()
  })

  it('a second paste under the same name is a second file, the first untouched', async () => {
    const h = await boot({ 'Note.md': '# Note\n' })
    await h.session.writeAttachment('img.png', PNG)
    await h.session.writeAttachment('img.png', OTHER)
    expect(h.files().filter((r) => r.path.startsWith('img')).map((r) => [r.path, r.kind])).toEqual([
      ['img 1.png', 'binary'],
      ['img.png', 'binary'],
    ].sort())
    expect(await h.adapter.read('img.png')).toEqual(PNG)
    h.session.dispose()
  })

  it('two concurrent writes under the same name both survive, side by side', async () => {
    const h = await boot({ 'Note.md': '# Note\n' })
    const [a, b] = await Promise.all([
      h.session.writeAttachment('Pasted image 20261010140307.png', PNG),
      h.session.writeAttachment('Pasted image 20261010140307.png', OTHER),
    ])
    expect([a, b]).toEqual(['Pasted image 20261010140307.png', 'Pasted image 20261010140307 1.png'])
    expect(await h.adapter.read(a!)).toEqual(PNG)
    expect(await h.adapter.read(b!)).toEqual(OTHER)
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it('a file that appears between the check and the write refuses it, and the attachment moves aside', async () => {
    const h = await boot()
    await h.adapter.writeAtomic('race.png', OTHER)
    // Simulate the window: the existence check misses the file (it is written
    // by someone else after `taken` looked), but the adapter's must-not-exist
    // compare-and-swap still sees it.
    const read = h.adapter.read.bind(h.adapter)
    h.adapter.read = async (p: string) => (p === 'race.png' ? null : read(p))
    expect(await h.session.writeAttachment('race.png', PNG)).toBe('race 1.png')
    expect(await read('race.png')).toEqual(OTHER)
    expect(await read('race 1.png')).toEqual(PNG)
    expect(h.errors).toEqual([])
    h.session.dispose()
  })
})
