/**
 * The backend seam itself: what it walks, what it caches, where it keeps its
 * own state, and what it refuses to open.
 */
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SimClock } from '@editor/testkit'
import { createFilesBackend, readNote } from '../src/backend.js'
import { vaultId } from '../src/select-vault.js'
import { FIXTURE_BINARIES, FIXTURE_TEXT_NOTES, makeFixtureVault } from './fixture.js'
import { harness, type Harness } from './harness.js'

let h: Harness
const open = async (): Promise<Harness> => (h = await harness())
afterEach(async () => h?.cleanup())

describe('createFilesBackend', () => {
  it('walks the vault once and indexes only the text files', async () => {
    const { backend } = await open()
    const docs = await backend.docs()
    expect(docs.size).toBe(FIXTURE_TEXT_NOTES)
    expect((await backend.files()).size).toBe(FIXTURE_TEXT_NOTES + FIXTURE_BINARIES)
    // guid IS the path here: files-direct has no CRDT guids to carry.
    for (const [path, doc] of docs) expect(doc.guid).toBe(path)
    expect(docs.has('attachments/diagram.png')).toBe(false)
    expect(await backend.coverage()).toMatchObject({
      docs: FIXTURE_TEXT_NOTES,
      skippedBinary: FIXTURE_BINARIES,
    })
  })

  it('caches the index rather than rebuilding it per query', async () => {
    const { backend } = await open()
    expect(await backend.index()).toBe(await backend.index())
    expect(await backend.buildMs()).toBeGreaterThanOrEqual(0)
  })

  it('never lists an ignored directory, however deep', async () => {
    const { backend, root } = await open()
    await writeFile(join(root, '.obsidian/plugin.md'), '# not a note\n', 'utf8')
    const fresh = await createFilesBackend({ root, dataDir: h.dataDir, clock: new SimClock() })
    expect([...(await fresh.files()).keys()].some((p) => p.startsWith('.obsidian'))).toBe(false)
  })

  it('keeps its journal outside the vault, under the vault.s own id', async () => {
    const { backend, root, dataDir } = await open()
    await backend.journal.record('TODO/Writing.md', new TextEncoder().encode('x\n'))
    const entries = await readdir(join(dataDir, 'vaults', vaultId(root), 'journal'))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toContain('TODO')
  })

  it('realpaths the root and refuses anything that is not a directory', async () => {
    const vault = await makeFixtureVault()
    try {
      const backend = await createFilesBackend({
        root: `${vault.root}/Areas/..`,
        dataDir: vault.dataDir,
        clock: new SimClock(),
      })
      expect(backend.root).toBe(vault.root)
      await expect(
        createFilesBackend({ root: join(vault.root, 'nope'), dataDir: vault.dataDir, clock: new SimClock() })
      ).rejects.toMatchObject({ code: 'usage' })
      await expect(
        createFilesBackend({
          root: join(vault.root, 'TODO/Writing.md'),
          dataDir: vault.dataDir,
          clock: new SimClock(),
        })
      ).rejects.toMatchObject({ code: 'usage' })
    } finally {
      await vault.cleanup()
    }
  })

  it('answers exists() for paths the walk cannot see', async () => {
    const { backend } = await open()
    expect(await backend.exists('TODO/Writing.md')).toBe('file')
    expect(await backend.exists('TODO')).toBe('dir')
    expect(await backend.exists('.obsidian')).toBe('dir')
    expect(await backend.exists('nope')).toBeNull()
  })
})

describe('readNote', () => {
  it('decodes from disk with the note.s own EOL and BOM, never from a cache', async () => {
    const { backend, root } = await open()
    const crlf = await readNote(backend, 'Inbox/CRLF Note.md')
    expect(crlf?.eol).toBe('crlf')
    expect(crlf?.text).toBe('CRLF lines\nsecond line\nthird line\n')

    await writeFile(join(root, 'TODO/Writing.md'), '﻿with a bom\n', 'utf8')
    const bom = await readNote(backend, 'TODO/Writing.md')
    expect(bom?.bom).toBe(true)
    expect(bom?.text).toBe('with a bom\n')
    expect(await readNote(backend, 'nope.md')).toBeNull()
  })
})
