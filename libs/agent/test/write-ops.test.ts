/**
 * The write half (shaping A5). Every assertion here is a golden rule made
 * observable: the pre-image is journaled BEFORE the write (rule 1), untouched
 * bytes stay untouched — EOL and BOM included (rule 2), and a write over a
 * note that moved under the agent is refused, not merged (R1).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { hashBytes } from '@ohhi/vault'
import { runOp } from '../src/ops/index.js'
import { harness, raceTheWrite, type Harness } from './harness.js'

let h: Harness
const open = async (): Promise<Harness> => (h = await harness())
afterEach(async () => h?.cleanup())

const NUL = String.fromCharCode(0)

describe('a write that loses a race writes nothing (golden rule 1)', () => {
  it('refuses with `conflict` when the note changes between the read and the rename', async () => {
    const vault = await open()
    raceTheWrite(vault, 'TODO/Writing.md', 'a human saved this\n')
    await expect(
      runOp(vault.backend, 'write', { path: 'TODO/Writing.md', text: 'the agent wrote this\n' })
    ).rejects.toMatchObject({ code: 'conflict' })
    // Their bytes are still there. Without the swap they would be gone from
    // disk AND absent from the journal, which holds the pre-race pre-image.
    expect(await vault.text('TODO/Writing.md')).toBe('a human saved this\n')
  })

  it('applies the same swap to patch, append and restore', async () => {
    const vault = await open()
    raceTheWrite(vault, 'TODO/Writing.md', 'theirs\n')
    await expect(
      runOp(vault.backend, 'patch', { path: 'TODO/Writing.md', old: 'Short.', new: 'Long.' })
    ).rejects.toMatchObject({ code: 'conflict' })

    raceTheWrite(vault, 'TODO/Writing.md', 'theirs again\n')
    await expect(
      runOp(vault.backend, 'append', { path: 'TODO/Writing.md', text: 'a line' })
    ).rejects.toMatchObject({ code: 'conflict' })

    await runOp(vault.backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    raceTheWrite(vault, 'TODO/Writing.md', 'and theirs once more\n')
    await expect(
      runOp(vault.backend, 'restore', { path: 'TODO/Writing.md' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await vault.text('TODO/Writing.md')).toBe('and theirs once more\n')
  })

  it('is a no-op on the happy path — an uncontended write still works', async () => {
    const { backend, text } = await open()
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'quiet\n' })
    expect(await text('TODO/Writing.md')).toBe('quiet\n')
  })
})

describe('write', () => {
  it('creates a new note without a pre-image (there is nothing to protect)', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'write', { path: 'Inbox/New.md', text: 'fresh\n' })
    expect(out.created).toBe(true)
    expect(out.journalSeq).toBeNull()
    expect(out.bytes).toBe(6)
    expect(await text('Inbox/New.md')).toBe('fresh\n')
    expect(await backend.journal.list('Inbox/New.md')).toEqual([])
  })

  it('journals the previous bytes before replacing a note', async () => {
    const { backend, notes } = await open()
    const out = await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'replaced\n' })
    expect(out.created).toBe(false)
    expect(out.journalSeq).toBe(1)
    const kept = await backend.journal.latest('TODO/Writing.md')
    expect(new TextDecoder().decode(kept!.bytes)).toBe(notes['TODO/Writing.md'])
  })

  it('honours expectHash and reports a conflict with both hashes', async () => {
    const { backend } = await open()
    const before = await runOp(backend, 'read', { path: 'TODO/Writing.md' })
    await expect(
      runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'x\n', expectHash: 'deadbeef' })
    ).rejects.toMatchObject({ code: 'conflict', details: { expected: 'deadbeef', actual: before.hash } })
    const ok = await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'x\n', expectHash: before.hash })
    expect(ok.hash).not.toBe(before.hash)
  })

  it('refuses create-only over an existing note, a non-markdown path and binary content', async () => {
    const { backend } = await open()
    await expect(
      runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'x\n', createOnly: true })
    ).rejects.toMatchObject({ code: 'refused' })
    await expect(runOp(backend, 'write', { path: 'notes.txt', text: 'x\n' })).rejects.toMatchObject({
      code: 'refused',
    })
    await expect(runOp(backend, 'write', { path: 'bad.md', text: `a${NUL}b\n` })).rejects.toMatchObject({
      code: 'refused',
    })
    await expect(runOp(backend, 'write', { path: '../escape.md', text: 'x\n' })).rejects.toMatchObject({
      code: 'refused',
    })
  })

  it('computes everything and records nothing on a dry run', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'nope\n', dryRun: true })
    expect(out.dryRun).toBe(true)
    expect(out.journalSeq).toBeNull()
    expect(out.hash).toBe(hashBytes(new TextEncoder().encode('nope\n')))
    expect(await text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
    expect(await backend.journal.list('TODO/Writing.md')).toEqual([])
  })

  it('preserves a note.s CRLF line endings byte for byte', async () => {
    const { backend, bytes, notes } = await open()
    const before = await bytes('Inbox/CRLF Note.md')
    // Write the note's own text back: the bytes must be identical, CRs included.
    const read = await runOp(backend, 'read', { path: 'Inbox/CRLF Note.md' })
    const out = await runOp(backend, 'write', { path: 'Inbox/CRLF Note.md', text: read.text! })
    expect(out.hash).toBe(read.hash)
    expect(Buffer.from(await bytes('Inbox/CRLF Note.md'))).toEqual(Buffer.from(before))
    expect(new TextDecoder().decode(await bytes('Inbox/CRLF Note.md'))).toBe(notes['Inbox/CRLF Note.md'])
  })
})

describe('patch', () => {
  it('replaces a unique string and leaves the rest of the note alone', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'patch', {
      path: 'Areas/CS/JSON.md',
      old: 'a data format',
      new: 'a wire format',
    })
    expect(out.replaced).toBe(1)
    expect(out.journalSeq).toBe(1)
    const after = await text('Areas/CS/JSON.md')
    expect(after).toContain('a wire format')
    expect(after).toContain('See [[HTML]].')
  })

  it('refuses a string that is not unique, and says how many it found', async () => {
    const { backend, notes } = await open()
    await expect(
      runOp(backend, 'patch', {
        path: 'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md',
        old: 'the json',
        new: 'the JSON',
      })
    ).rejects.toMatchObject({ code: 'refused', details: { occurrences: 72 } })
    await expect(
      runOp(backend, 'patch', { path: 'TODO/Writing.md', old: 'absent', new: 'x' })
    ).rejects.toMatchObject({ code: 'refused', details: { occurrences: 0 } })
    // Nothing was written on either refusal.
    expect(await h.text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
  })

  it('replaces every occurrence with --all', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'patch', {
      path: 'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md',
      old: 'the json',
      new: 'the JSON',
      all: true,
    })
    expect(out.replaced).toBe(72)
    expect(await text('Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md')).not.toContain('the json')
  })

  it('never treats the replacement as a pattern', async () => {
    const { backend, text } = await open()
    await runOp(backend, 'patch', { path: 'TODO/Writing.md', old: 'Short.', new: '$& and $1' })
    expect(await text('TODO/Writing.md')).toContain('$& and $1')
  })

  it('keeps CRLF endings through a patch', async () => {
    const { backend, bytes } = await open()
    await runOp(backend, 'patch', { path: 'Inbox/CRLF Note.md', old: 'second line', new: 'middle line' })
    const after = new TextDecoder().decode(await bytes('Inbox/CRLF Note.md'))
    expect(after).toBe('CRLF lines\r\nmiddle line\r\nthird line\r\n')
  })

  it('refuses a patch to a note that is not there', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'patch', { path: 'nope.md', old: 'a', new: 'b' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('append', () => {
  it('adds to the end of a note with exactly one newline before it', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'append', { path: 'TODO/Writing.md', text: 'One more line.' })
    expect(out.line).toBe(4)
    expect(await text('TODO/Writing.md')).toBe('# Writing\n\nShort.\nOne more line.\n')
  })

  it('adds to the end of a section, before the next heading, keeping one blank line', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'append', {
      path: 'Projects/Editor.md',
      section: 'Decisions',
      text: '- Agents are collaborators.',
    })
    expect(out.line).toBe(21)
    const after = await text('Projects/Editor.md')
    expect(after).toContain('- CRDTs handle sync.\n- Agents are collaborators.\n\n## Notes')
    expect(after).toContain('### Open questions')
  })

  it('appends to a nested section without disturbing its parent', async () => {
    const { backend, text } = await open()
    await runOp(backend, 'append', {
      path: 'Projects/Editor.md',
      section: 'Notes/Open questions',
      text: '- And restore --list?',
    })
    expect(await text('Projects/Editor.md')).toContain(
      '- How does restore work?\n- And restore --list?\n\n## Later'
    )
  })

  it('appends to the last section without leaving a trailing blank line', async () => {
    const { backend, text } = await open()
    await runOp(backend, 'append', { path: 'Projects/Editor.md', section: 'Later', text: 'Something now.' })
    expect(await text('Projects/Editor.md')).toMatch(/Nothing yet\.\nSomething now\.\n$/)
  })

  it('refuses a section that is not there and an empty append', async () => {
    const { backend } = await open()
    await expect(
      runOp(backend, 'append', { path: 'Projects/Editor.md', section: 'Nope', text: 'x' })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(backend, 'append', { path: 'TODO/Writing.md', text: '' })).rejects.toMatchObject({
      code: 'usage',
    })
  })

  it('creates the note when appending to one that does not exist', async () => {
    const { backend, text } = await open()
    const out = await runOp(backend, 'append', { path: 'Inbox/Fresh.md', text: 'first line' })
    expect(out.line).toBe(1)
    expect(await text('Inbox/Fresh.md')).toBe('first line\n')
  })
})
