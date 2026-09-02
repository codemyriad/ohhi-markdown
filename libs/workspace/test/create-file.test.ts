/**
 * `createFile(dir, name, text)` — the named-create path that wikilink
 * create-on-click and daily notes use.
 *
 * The regressions here are golden-rule-1 shaped, so they get their own file:
 * a create that overwrites a file Editor did not write is silent, permanent
 * content loss in exactly the coexistence scenario this product exists for
 * (Obsidian, git or Claude Code writing the same folder while Editor runs).
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@editor/sync'
import { MemJournal, MemLcaStore, MemVaultAdapter } from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import type { FileRow, SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function boot(seed: Record<string, string> = {}) {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(seed)) {
    await adapter.writeAtomic(path, enc.encode(text))
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
  const read = async (p: string): Promise<string | null> => {
    const b = await adapter.read(p)
    return b ? dec.decode(b) : null
  }
  return { session, adapter, journal, errors, read, files: () => files }
}

describe('createFile — auto-named', () => {
  it('creates an empty untitled note and enrolls it', async () => {
    const h = await boot()
    const path = await h.session.createFile('')
    expect(path).toBe('untitled-1.md')
    expect(await h.read('untitled-1.md')).toBe('')
    expect(h.session.docForPath('untitled-1.md')?.getText()).toBe('')
    h.session.dispose()
  })
})

describe('createFile — named', () => {
  it('creates the note with its seed text, on disk and in the CRDT', async () => {
    const h = await boot()
    const path = await h.session.createFile('', 'Brand New Note', '# Brand New Note\n\n')
    expect(path).toBe('Brand New Note.md')
    expect(await h.read('Brand New Note.md')).toBe('# Brand New Note\n\n')
    expect(h.session.docForPath('Brand New Note.md')?.getText()).toBe('# Brand New Note\n\n')
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it('is idempotent: creating an existing note opens it, unchanged', async () => {
    const h = await boot({ 'Note.md': 'original' })
    const path = await h.session.createFile('', 'Note.md', 'REPLACEMENT')
    expect(path).toBe('Note.md')
    expect(await h.read('Note.md')).toBe('original')
    h.session.dispose()
  })

  it('NEVER overwrites a file Editor did not write — it adopts it', async () => {
    // The watcher deliberately ignores out-of-map disk files for the whole
    // session, so a note Obsidian/git/Claude Code wrote while Editor was
    // running is invisible to the folder map. Clicking its wikilink must not
    // destroy it.
    const h = await boot()
    await h.adapter.writeAtomic('Idea.md', enc.encode('# Idea\n\nwork I did in Obsidian\n'))
    const path = await h.session.createFile('', 'Idea', '# Idea\n\n')
    expect(path).toBe('Idea.md')
    expect(await h.read('Idea.md')).toBe('# Idea\n\nwork I did in Obsidian\n')
    // ...and the adopted bytes are what the CRDT and the LCA now hold, so the
    // reconciler sees no divergence.
    expect(h.session.docForPath('Idea.md')?.getText()).toBe(
      '# Idea\n\nwork I did in Obsidian\n'
    )
    h.session.dispose()
  })

  it('refuses a name that is not a markdown note', async () => {
    // `![[diagram.png]]` is a missing ATTACHMENT; creating `diagram.png.md`
    // would produce a file nothing links to.
    const h = await boot()
    expect(await h.session.createFile('', 'diagram.png')).toBeNull()
    expect(h.errors).toHaveLength(1)
    h.session.dispose()
  })

  it('refuses to adopt binary content sitting at the target path', async () => {
    const h = await boot()
    await h.adapter.writeAtomic('note.md', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    expect(await h.session.createFile('', 'note.md', 'text')).toBeNull()
    expect(h.errors).toHaveLength(1)
    h.session.dispose()
  })

  it('journals every write it does make', async () => {
    const h = await boot()
    await h.session.createFile('', 'Fresh.md', 'hello')
    expect((await h.journal.entries('Fresh.md')).length).toBeGreaterThan(0)
    h.session.dispose()
  })

  it('creates directory entries for a nested name, so rename and delete work', async () => {
    const h = await boot()
    await h.session.createFile('', 'Projects/2026/Roadmap', '# Roadmap\n')
    const rows = h.files()
    expect(rows.map((r) => r.path)).toContain('Projects')
    expect(rows.map((r) => r.path)).toContain('Projects/2026')
    expect(rows.find((r) => r.path === 'Projects')?.kind).toBe('dir')
    // The map is the tree authority (M3): renaming the implied folder works.
    await h.session.renamePath('Projects/2026', 'Projects/2027')
    expect(h.files().map((r) => r.path)).toContain('Projects/2027/Roadmap.md')
    expect(h.errors).toEqual([])
    h.session.dispose()
  })

  it('appends .md and strips leading slashes', async () => {
    const h = await boot()
    expect(await h.session.createFile('', '/Some Note')).toBe('Some Note.md')
    h.session.dispose()
  })

  it('refuses a name that climbs out of the mount', async () => {
    const h = await boot()
    expect(await h.session.createFile('', '../escape.md')).toBeNull()
    expect(h.errors).toHaveLength(1)
    h.session.dispose()
  })
})
