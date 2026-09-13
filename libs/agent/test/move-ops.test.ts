/**
 * `mv`, `rm`, `restore`, `changes` — the ops that move bytes around without
 * ever destroying any (shaping A5/A6).
 *
 * The thing worth testing hardest is the journal: a rename that loses a note's
 * recoverable history, or an `rm` that leaves nothing to restore, is a golden
 * rule 1 violation that no type can catch.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileJournal } from '@ohhi/vault'
import { NodeStoreDir } from '@ohhi/vault/node'
import { runOp } from '../src/ops/index.js'
import { MASS_CHANGE_PATHS } from '../src/ops/move.js'
import { harness, reopen, type Harness } from './harness.js'

let h: Harness
const open = async (): Promise<Harness> => (h = await harness())
afterEach(async () => h?.cleanup())

/** A folder with more files than the app's mass-change breaker tolerates. */
async function crowdedFolder(root: string, count = MASS_CHANGE_PATHS + 1): Promise<void> {
  await mkdir(join(root, 'Bulk'), { recursive: true })
  for (let i = 0; i < count; i++) await writeFile(join(root, `Bulk/note-${i}.md`), `# ${i}\n`, 'utf8')
}

describe('mv', () => {
  it('renames a note and takes its journal history with it', async () => {
    const { backend, text } = await open()
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    expect(await backend.journal.list('TODO/Writing.md')).toHaveLength(1)

    const out = await runOp(backend, 'mv', { from: 'TODO/Writing.md', to: 'TODO/Prose.md' })
    expect(out.files).toBe(1)
    expect(await text('TODO/Prose.md')).toBe('v2\n')
    // The pre-image followed the note; nothing is left under the old name.
    expect(await backend.journal.list('TODO/Prose.md')).toHaveLength(1)
    expect(await backend.journal.list('TODO/Writing.md')).toHaveLength(0)
  })

  it('moves a folder and everything under it', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'mv', { from: 'Areas/CS', to: 'Areas/Computing' })
    expect(out.files).toBe(3)
    const after = await reopen(h)
    expect([...(await after.files()).keys()]).toContain('Areas/Computing/JSON.md')
    expect([...(await after.files()).keys()]).not.toContain('Areas/CS/JSON.md')
  })

  it('refuses a target that exists, a move into itself, and a missing source', async () => {
    const { backend } = await open()
    await expect(
      runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/HTML.md' })
    ).rejects.toMatchObject({ code: 'refused' })
    await expect(runOp(backend, 'mv', { from: 'Areas/CS', to: 'Areas/CS/Inner' })).rejects.toMatchObject({
      code: 'refused',
    })
    await expect(runOp(backend, 'mv', { from: 'nope.md', to: 'other.md' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('refuses a folder bigger than the app.s mass-change breaker without --yes', async () => {
    const vault = await open()
    await crowdedFolder(vault.root)
    const backend = await reopen(vault)
    await expect(runOp(backend, 'mv', { from: 'Bulk', to: 'Archive' })).rejects.toMatchObject({
      code: 'refused',
      details: { files: MASS_CHANGE_PATHS + 1 },
    })
    const out = await runOp(backend, 'mv', { from: 'Bulk', to: 'Archive', yes: true })
    expect(out.files).toBe(MASS_CHANGE_PATHS + 1)
  })

  it('moves a non-markdown file — mv and rm are not note-only, unlike write/patch/append', async () => {
    const vault = await open()
    // `write`/`patch`/`append` refuse anything that is not `.md` (they edit
    // NOTES). Moving an attachment is still moving a file, and refusing would
    // leave an agent unable to tidy a vault — so `mv`/`rm` take any path.
    await expect(
      runOp(vault.backend, 'write', { path: 'attachments/diagram.png', text: 'x' })
    ).rejects.toMatchObject({ code: 'refused' })
    const moved = await runOp(vault.backend, 'mv', {
      from: 'attachments/diagram.png',
      to: 'attachments/figures/diagram.png',
    })
    expect(moved.files).toBe(1)
    const after = await reopen(vault)
    expect([...(await after.files()).keys()]).toContain('attachments/figures/diagram.png')
    const trashed = await runOp(after, 'rm', { path: 'attachments/figures/diagram.png' })
    expect(trashed.trashedTo).toBe('.trash/attachments/figures/diagram.png')
  })

  it('changes nothing on a dry run', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'mv', { from: 'TODO/Writing.md', to: 'TODO/Prose.md', dryRun: true })
    expect(out.dryRun).toBe(true)
    expect(await text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
  })
})

describe('rm', () => {
  it('moves a note to .trash and keeps a pre-image under its original path', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'rm', { path: 'TODO/Writing.md' })
    expect(out.trashedTo).toBe('.trash/TODO/Writing.md')
    expect(out.files).toBe(1)
    expect(await text('.trash/TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
    // The history stays where a caller would ask for it back.
    expect(await backend.journal.list('TODO/Writing.md')).toHaveLength(1)
  })

  it('restores a removed note to where it was', async () => {
    const { backend, text, notes } = await open()
    await runOp(backend, 'rm', { path: 'TODO/Writing.md' })
    const restored = await runOp(backend, 'restore', { path: 'TODO/Writing.md' })
    expect(restored.restored?.bytes).toBe(Buffer.byteLength(notes['TODO/Writing.md']))
    expect(await text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
  })

  it('suffixes the trash name rather than overwriting an earlier removal', async () => {
    const { backend } = await open()
    await runOp(backend, 'rm', { path: 'TODO/Writing.md' })
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'second life\n' })
    const again = await runOp(backend, 'rm', { path: 'TODO/Writing.md' })
    expect(again.trashedTo).toBe('.trash/TODO/Writing~1.md')
    expect(await h.text('.trash/TODO/Writing~1.md')).toBe('second life\n')
  })

  it('trashes a folder whole, under the same breaker as mv', async () => {
    const vault = await open()
    const out = await runOp(vault.backend, 'rm', { path: 'Areas/CS' })
    expect(out.files).toBe(3)
    expect(out.trashedTo).toBe('.trash/Areas/CS')
    expect(await vault.text('.trash/Areas/CS/JSON.md')).toBe(vault.notes['Areas/CS/JSON.md'])

    await crowdedFolder(vault.root)
    const backend = await reopen(vault)
    await expect(runOp(backend, 'rm', { path: 'Bulk' })).rejects.toMatchObject({ code: 'refused' })
  })

  it('refuses a missing path and changes nothing on a dry run', async () => {
    const { backend, text, notes } = await open()
    await expect(runOp(backend, 'rm', { path: 'nope.md' })).rejects.toMatchObject({ code: 'not_found' })
    const out = await runOp(backend, 'rm', { path: 'TODO/Writing.md', dryRun: true })
    expect(out.dryRun).toBe(true)
    expect(await text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
    expect(await backend.journal.list('TODO/Writing.md')).toHaveLength(0)
  })
})

describe('restore', () => {
  it('lists pre-images newest first and restores the latest by default', async () => {
    const { backend, text, notes } = await open()
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    h.clock.advance(1000)
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v3\n' })

    const listed = await runOp(backend, 'restore', { path: 'TODO/Writing.md', list: true })
    expect(listed.entries?.map((e) => e.seq)).toEqual([2, 1])
    expect(listed.entries?.every((e) => e.source === 'cli')).toBe(true)
    expect(Date.parse(listed.entries![0].at)).not.toBeNaN()

    const back = await runOp(backend, 'restore', { path: 'TODO/Writing.md' })
    expect(back.restored?.seq).toBe(2)
    expect(await text('TODO/Writing.md')).toBe('v2\n')
    // Restoring is itself journaled, so the version just replaced is recoverable.
    const after = await runOp(backend, 'restore', { path: 'TODO/Writing.md', list: true })
    expect(after.entries).toHaveLength(3)
    expect(notes['TODO/Writing.md']).toBeDefined()
  })

  it('restores a specific sequence and reports a dry run without writing', async () => {
    const { backend, text, notes } = await open()
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v3\n' })
    const dry = await runOp(backend, 'restore', { path: 'TODO/Writing.md', seq: 1, dryRun: true })
    expect(dry.restored?.seq).toBe(1)
    expect(await text('TODO/Writing.md')).toBe('v3\n')

    await runOp(backend, 'restore', { path: 'TODO/Writing.md', seq: 1 })
    expect(await text('TODO/Writing.md')).toBe(notes['TODO/Writing.md'])
  })

  it('reads the union of this tool.s journal and the app.s', async () => {
    const vault = await open()
    // The app's own store dir, written by nothing but the app.
    const appStore = join(vault.dataDir, 'app/stores/room-1')
    const appJournal = new FileJournal(new NodeStoreDir(appStore), { now: () => 1_000 })
    await appJournal.record('TODO/Writing.md', new TextEncoder().encode('from the app\n'))

    const backend = await reopen(vault, { appStoreDirs: [appStore] })
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'from the cli\n' })
    const listed = await runOp(backend, 'restore', { path: 'TODO/Writing.md', list: true })
    expect(listed.entries?.map((e) => e.source).sort()).toEqual(['app', 'cli'])
    // Newest first: the CLI pre-image was recorded later than the app's.
    expect(listed.entries?.[0].source).toBe('cli')

    const fromApp = await runOp(backend, 'restore', {
      path: 'TODO/Writing.md',
      seq: listed.entries!.find((e) => e.source === 'app')!.seq,
      source: 'app',
    })
    expect(fromApp.restored).toBeDefined()
    expect(await vault.text('TODO/Writing.md')).toBe('from the app\n')
  })

  it('refuses a path with no history and a sequence that is not there', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'restore', { path: 'TODO/Writing.md' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    await expect(runOp(backend, 'restore', { path: 'TODO/Writing.md', seq: 99 })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('answers --list with an empty list rather than not_found — an empty list means an empty list', async () => {
    const { backend } = await open()
    // Asking what is recoverable for a note nothing has written is a QUESTION
    // with an answer, and the answer is "nothing". `not_found` here would send
    // an agent looking for a reason that does not exist (shaping R7; Cassini).
    const listed = await runOp(backend, 'restore', { path: 'TODO/Writing.md', list: true })
    expect(listed.entries).toEqual([])
    // Even for a path that is not in the vault at all: the journal is keyed by
    // path, and "no pre-images" is true of a name that never existed too.
    expect((await runOp(backend, 'restore', { path: 'Never/Existed.md', list: true })).entries).toEqual([])
    // But a restore with no candidate is still not_found — that one asked for
    // a version back, and there is none.
    await expect(runOp(backend, 'restore', { path: 'TODO/Writing.md' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('changes', () => {
  it('reports every file as created when nothing has written here before', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'changes', { since: new Date(0).toISOString(), limit: 100 })
    expect(out.changes.every((c) => c.kind === 'created')).toBe(true)
    expect(out.changes.map((c) => c.path)).toContain('attachments/diagram.png')
    expect(out.total).toBe((await backend.files()).size)
    expect(Date.parse(out.cursorSince)).not.toBeNaN()
  })

  it('resumes from its own cursor and separates a new note from a rewritten one', async () => {
    const vault = await open()
    const first = await runOp(vault.backend, 'changes', { since: new Date(0).toISOString(), limit: 100 })
    await runOp(vault.backend, 'write', { path: 'Inbox/Brand New.md', text: 'new\n' })
    await runOp(vault.backend, 'write', { path: 'TODO/Writing.md', text: 'rewritten\n' })

    const next = await runOp(await reopen(vault), 'changes', { since: first.cursorSince, limit: 100 })
    const byPath = new Map(next.changes.map((c) => [c.path, c]))
    expect(byPath.get('Inbox/Brand New.md')?.kind).toBe('created')
    expect(byPath.get('TODO/Writing.md')?.kind).toBe('modified')
    expect(byPath.get('TODO/Writing.md')?.seq).toBe(1)
    expect(byPath.has('Areas/CS/JSON.md')).toBe(false)
  })

  it('reports a path that is only in the journal — an rm leaves no mtime behind', async () => {
    const vault = await open()
    const first = await runOp(vault.backend, 'changes', { since: new Date(0).toISOString(), limit: 100 })
    // Step the sim clock past the cursor before journaling anything. The
    // harness anchors the clock to real time ONCE (the fixture's files carry
    // real mtimes), and `cursorSince` is the newest of those mtimes — which
    // can land in the SAME millisecond as the anchor. `changes` then reads the
    // rm's journal entry as `at <= since`, i.e. already reported, and drops
    // the row. Under the CLI's RealClock an `rm` is always strictly later than
    // the mtimes a previous invocation reported, so this is the fixture's
    // frozen clock, not the op: make the ordering explicit instead of racing
    // the millisecond boundary.
    vault.clock.advance(1000)
    await runOp(vault.backend, 'rm', { path: 'TODO/Writing.md' })

    const next = await runOp(await reopen(vault), 'changes', { since: first.cursorSince, limit: 100 })
    const row = next.changes.find((c) => c.path === 'TODO/Writing.md')
    expect(row?.kind).toBe('journaled')
    expect(row?.seq).toBe(1)
  })

  it('accepts a journal sequence as since, and refuses anything else', async () => {
    const { backend } = await open()
    await runOp(backend, 'write', { path: 'TODO/Writing.md', text: 'v2\n' })
    const bySeq = await runOp(backend, 'changes', { since: 'j0', limit: 100 })
    expect(bySeq.changes.some((c) => c.path === 'TODO/Writing.md')).toBe(true)
    await expect(runOp(backend, 'changes', { since: 'yesterday' })).rejects.toMatchObject({ code: 'usage' })
  })

  it('pages like every other list', async () => {
    const { backend } = await open()
    const page = await runOp(backend, 'changes', { since: new Date(0).toISOString(), limit: 3 })
    expect(page.returned).toBe(3)
    expect(page.nextCursor).not.toBeNull()
    const rest = await runOp(backend, 'changes', {
      since: new Date(0).toISOString(),
      limit: 3,
      cursor: page.nextCursor!,
    })
    expect(rest.changes.map((c) => c.path)).not.toEqual(page.changes.map((c) => c.path))
  })
})
