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
import { harness, raceTheWrite, reopen, type Harness } from './harness.js'

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

describe('mv follows links (bases-shaping A5.1)', () => {
  // The fixture: JSON.md is linked bare from HTML.md, Docs.md, the daily note
  // and Projects/Editor.md (whose frontmatter must stay byte for byte).
  const linksToJson = ['Areas/CS/HTML.md', 'Daily/02-5-2024.md', 'Edible/Docs.md', 'Projects/Editor.md']

  it('rewrites a bare link in every referencing note, each as one byte-minimal journaled write', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(out.files).toBe(1)
    expect(out.rewrote.map((r) => r.path)).toEqual(linksToJson)
    expect(out.skipped).toEqual([])
    for (const path of linksToJson) {
      expect(await text(path)).toBe(notes[path].replaceAll('[[JSON]]', '[[Data Format]]'))
      // Its own pre-image, under its own path — `restore` takes it back alone.
      expect(await backend.journal.list(path)).toHaveLength(1)
    }
    const editor = out.rewrote.find((r) => r.path === 'Projects/Editor.md')!
    expect(editor.links).toBe(1)
    expect(editor.journalSeq).not.toBeNull()
    // Nothing else moved a byte.
    expect(await text('Inbox/CRLF Note.md')).toBe(notes['Inbox/CRLF Note.md'])
    expect(await text('Areas/CS/Networking.md')).toBe(notes['Areas/CS/Networking.md'])
  })

  it('keeps alias, anchor, embeds and a CRLF note.s line endings; a frontmatter link is the same byte edit', async () => {
    const vault = await open()
    await writeFile(
      join(vault.root, 'Inbox/Refs.md'),
      '---\npillar: "[[JSON]]"\nrelated:\n  - "[[JSON|the format]]"\n---\n\nSee [[JSON|json]], [[JSON#Heading]] and ![[JSON]].\n',
      'utf8'
    )
    await writeFile(join(vault.root, 'Inbox/CRLF Links.md'), 'Linked: [[JSON]]\r\nsecond line\r\n', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(out.rewrote.find((r) => r.path === 'Inbox/Refs.md')?.links).toBe(5)
    expect(await vault.text('Inbox/Refs.md')).toBe(
      '---\npillar: "[[Data Format]]"\nrelated:\n  - "[[Data Format|the format]]"\n---\n\nSee [[Data Format|json]], [[Data Format#Heading]] and ![[Data Format]].\n'
    )
    expect(await vault.text('Inbox/CRLF Links.md')).toBe('Linked: [[Data Format]]\r\nsecond line\r\n')
  })

  it('a move between folders leaves bare links alone and rewrites path links; a folder move does the same', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Inbox/Paths.md'), 'Bare [[JSON]], path [[Areas/CS/JSON]], ext [[Areas/CS/JSON.md]].\n', 'utf8')
    let backend = await reopen(vault)
    const moved = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Archive/JSON.md' })
    expect(moved.rewrote.map((r) => [r.path, r.links])).toEqual([['Inbox/Paths.md', 2]])
    expect(await vault.text('Inbox/Paths.md')).toBe('Bare [[JSON]], path [[Archive/JSON]], ext [[Archive/JSON.md]].\n')

    backend = await reopen(vault)
    const folder = await runOp(backend, 'mv', { from: 'Archive', to: 'Areas/Old' })
    expect(folder.files).toBe(1)
    expect(folder.rewrote.map((r) => r.path)).toEqual(['Inbox/Paths.md'])
    expect(await vault.text('Inbox/Paths.md')).toBe('Bare [[JSON]], path [[Areas/Old/JSON]], ext [[Areas/Old/JSON.md]].\n')
  })

  it('a note under a moved folder is rewritten at its new path', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Areas/CS/Index.md'), 'Siblings: [[Areas/CS/JSON]] and [[HTML]].\n', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas/CS', to: 'Areas/Computing' })
    expect(out.rewrote.map((r) => r.path)).toEqual(['Areas/Computing/Index.md'])
    expect(await vault.text('Areas/Computing/Index.md')).toBe('Siblings: [[Areas/Computing/JSON]] and [[HTML]].\n')
    expect(await backend.journal.list('Areas/Computing/Index.md')).toHaveLength(1)
  })

  it('reports on a dry run and writes nothing', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md', dryRun: true })
    expect(out.dryRun).toBe(true)
    expect(out.rewrote.map((r) => r.path)).toEqual(linksToJson)
    expect(out.rewrote.every((r) => r.journalSeq === null)).toBe(true)
    for (const path of linksToJson) {
      expect(await text(path)).toBe(notes[path])
      expect(await backend.journal.list(path)).toHaveLength(0)
    }
    expect(await text('Areas/CS/JSON.md')).toBe(notes['Areas/CS/JSON.md'])
  })

  it('--keep-links moves and touches no other note', async () => {
    const { backend, text, notes } = await open()
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md', keepLinks: true })
    expect(out.keepLinks).toBe(true)
    expect(out.rewrote).toEqual([])
    expect(await text('Areas/CS/Data Format.md')).toBe(notes['Areas/CS/JSON.md'])
    for (const path of linksToJson) expect(await text(path)).toBe(notes[path])
  })

  it('a referencing note that loses a race is skipped with `conflict`, its bytes kept, the move done', async () => {
    const vault = await open()
    raceTheWrite(vault, 'Edible/Docs.md', 'a human saved this\n')
    const out = await runOp(vault.backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(out.skipped).toEqual([{ path: 'Edible/Docs.md', links: 1, reason: 'conflict' }])
    expect(out.rewrote.map((r) => r.path)).toEqual(linksToJson.filter((p) => p !== 'Edible/Docs.md'))
    expect(await vault.text('Edible/Docs.md')).toBe('a human saved this\n')
    expect(await vault.text('Areas/CS/Data Format.md')).toBe(vault.notes['Areas/CS/JSON.md'])
  })

  it('a folder with a sub-folder: path links deep inside follow, a suffix that still fits is kept', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Inbox/Deep.md'), '[[Areas/CS/JSON]] [[CS/JSON]] [[Areas/Life/Music|tunes]] [[JSON]]\n', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas', to: 'Archive/Areas' })
    expect(out.files).toBe(4)
    expect(out.rewrote.map((r) => [r.path, r.links])).toEqual([['Inbox/Deep.md', 2]])
    expect(await vault.text('Inbox/Deep.md')).toBe('[[Archive/Areas/CS/JSON]] [[CS/JSON]] [[Archive/Areas/Life/Music|tunes]] [[JSON]]\n')
    expect(await vault.text('Archive/Areas/CS/JSON.md')).toBe(vault.notes['Areas/CS/JSON.md'])
  })

  it('the moved note.s own named self-link follows; its [[#anchor]] does not; the pre-image sits under the new path', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Areas/CS/JSON.md'), '# JSON\n\nSee [[JSON#Top]] and [[#Top]] and [[HTML]].\n', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(out.rewrote.map((r) => r.path)).toContain('Areas/CS/Data Format.md')
    expect(await vault.text('Areas/CS/Data Format.md')).toBe('# JSON\n\nSee [[Data Format#Top]] and [[#Top]] and [[HTML]].\n')
    expect(await backend.journal.list('Areas/CS/Data Format.md')).toHaveLength(1)
    expect(await backend.journal.list('Areas/CS/JSON.md')).toHaveLength(0)
  })

  it('a referrer that is not a markdown note is neither rewritten nor reported', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Inbox/Board.canvas'), '{"nodes":[{"text":"[[JSON]]"}]}', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(out.rewrote.map((r) => r.path)).toEqual(linksToJson)
    expect(out.skipped).toEqual([])
    expect(await vault.text('Inbox/Board.canvas')).toBe('{"nodes":[{"text":"[[JSON]]"}]}')
  })

  it('a bare link to a namesake the rename would capture is pinned to its path, and reported', async () => {
    const vault = await open()
    // Areas/CS/Markup.md is linked bare from Areas/CS/Guide.md. Renaming HTML.md to
    // Markup.md beside it would capture that link by proximity.
    await mkdir(join(vault.root, 'Areas/Web'), { recursive: true })
    await writeFile(join(vault.root, 'Areas/Web/Markup.md'), '# Markup\n', 'utf8')
    await writeFile(join(vault.root, 'Areas/CS/Guide.md'), 'Read [[Markup]] then [[HTML]].\n', 'utf8')
    const backend = await reopen(vault)
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/HTML.md', to: 'Areas/CS/Markup.md' })
    expect(out.rewrote.find((r) => r.path === 'Areas/CS/Guide.md')?.links).toBe(2)
    expect(await vault.text('Areas/CS/Guide.md')).toBe('Read [[Areas/Web/Markup]] then [[Areas/CS/Markup]].\n')
  })

  it('names every note it is about to rewrite on the trail before it moves anything', async () => {
    const vault = await open()
    await runOp(vault.backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(vault.trail[0]).toBe('plan: move Areas/CS/JSON.md -> Areas/CS/Data Format.md, then update links in 4 notes:')
    expect(vault.trail.slice(1)).toEqual(linksToJson.map((p) => `plan: 1 link in ${p}`))
    // A dry run writes nothing, so there is nothing to leave a trail for.
    vault.trail.length = 0
    await runOp(await reopen(vault), 'mv', { from: 'Areas/CS/Data Format.md', to: 'Areas/CS/JSON.md', dryRun: true })
    expect(vault.trail).toEqual([])
  })

  it('renaming the folder a collection reads rewrites its inFolder, through the journal, and the rows follow', async () => {
    const vault = await open()
    const before = vault.notes['Competitors.base']
    const out = await runOp(vault.backend, 'mv', { from: 'Competitors', to: 'Rivals' })
    expect(out.rewrote.map((r) => [r.path, r.links])).toEqual([['Competitors.base', 1]])
    const base = out.rewrote[0]
    expect(base.journalSeq).not.toBeNull()
    // One string changed, every other byte kept.
    expect(await vault.text('Competitors.base')).toBe(before.replace('file.inFolder("Competitors")', 'file.inFolder("Rivals")'))
    expect(await vault.backend.journal.list('Competitors.base')).toHaveLength(1)
    expect(vault.trail).toContain('plan: 1 filter in Competitors.base')
    // The collection still has its rows, at their new paths.
    const rows = await runOp(await reopen(vault), 'rows', { collection: 'Competitors.base' })
    expect(rows.rows.length).toBeGreaterThan(0)
    expect(rows.rows.every((r) => r.path.startsWith('Rivals/'))).toBe(true)
  })

  it('a pillar note renamed: a collection\'s hasLink follows it; a dry run reports and writes nothing; --keep-links leaves it', async () => {
    const vault = await open()
    await writeFile(join(vault.root, 'Pillar.base'), 'filters: file.hasLink("JSON")\nviews:\n  - type: table\n    name: All\n', 'utf8')
    let backend = await reopen(vault)
    const dry = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md', dryRun: true })
    expect(dry.rewrote.find((r) => r.path === 'Pillar.base')?.links).toBe(1)
    expect(await vault.text('Pillar.base')).toBe('filters: file.hasLink("JSON")\nviews:\n  - type: table\n    name: All\n')
    const kept = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Kept.md', keepLinks: true })
    expect(kept.rewrote).toEqual([])
    expect(await vault.text('Pillar.base')).toContain('file.hasLink("JSON")')
    backend = await reopen(vault)
    await runOp(backend, 'mv', { from: 'Areas/CS/Kept.md', to: 'Areas/CS/JSON.md', keepLinks: true })
    backend = await reopen(vault)
    await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    expect(await vault.text('Pillar.base')).toBe('filters: file.hasLink("Data Format")\nviews:\n  - type: table\n    name: All\n')
  })

  it('counts the notes it would rewrite toward the breaker', async () => {
    const vault = await open()
    for (let i = 0; i < MASS_CHANGE_PATHS; i++) {
      await writeFile(join(vault.root, `Inbox/ref-${i}.md`), `See [[JSON]].\n`, 'utf8')
    }
    const backend = await reopen(vault)
    await expect(
      runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md' })
    ).rejects.toMatchObject({ code: 'refused', details: { files: MASS_CHANGE_PATHS + linksToJson.length + 1 } })
    expect(await vault.text('Areas/CS/JSON.md')).toBe(vault.notes['Areas/CS/JSON.md'])
    const out = await runOp(backend, 'mv', { from: 'Areas/CS/JSON.md', to: 'Areas/CS/Data Format.md', yes: true })
    expect(out.rewrote).toHaveLength(MASS_CHANGE_PATHS + linksToJson.length)
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
