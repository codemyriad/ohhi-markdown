// @vitest-environment jsdom
/**
 * File operations (`file-actions.svelte.ts`): which tree requests open the
 * shared dialog and which are dispatched elsewhere, what the dialog's answer
 * does for each mode, and where a new note lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { MemoryIndex } from '@ohhi/index'
import { createFileActions, LINK_CONFIRM_THRESHOLD, type FileActions, type FileHost } from './file-actions.svelte.js'
import {
  actionsWorkspace,
  fakeDoc,
  withActions,
  type ActionsHarness,
  type ActionsWorkspace,
} from './shell-actions.fixture.svelte.js'

let ws: ActionsWorkspace
let harness: ActionsHarness<FileActions>
let fileOps: FileActions
let opened: string[]
let revealed: string[]
let history: number
let share: FileHost['share'] & { moves: string[]; asked: string[] }
/** The vault index the rename reads backlinks from; empty unless a test seeds it. */
let index: MemoryIndex
let flashes: { level: string; text: string; path?: string }[]

/** Let a chain of awaits inside an action settle (a plan, a move, an apply). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** The sink's job, done by hand: the index follows what the docs and the tree now say. */
const syncIndex = (): void => {
  index.rebuild([...ws.docs].map(([path, doc]) => ({ guid: doc.guid, path, text: doc.getText() })))
}

beforeEach(() => {
  ws = actionsWorkspace(['docs/a.md', 'notes/b.md'])
  index = new MemoryIndex()
  opened = []
  revealed = []
  history = 0
  flashes = []
  share = {
    folderSharePath: null,
    addShareOpen: null,
    addLinkPath: null,
    afterMove: null,
    moves: [],
    asked: [],
    move: async (from, to) => {
      share.moves.push(`${from} -> ${to}`)
      // The real one moves (or confirms first) and then reports the landing.
      await ws.asWorkspace().movePath(from, to)
      share.afterMove?.(from, to)
    },
    askUnshare: (path) => share.asked.push(`unshare:${path}`),
    askUnmount: (path) => share.asked.push(`unmount:${path}`),
  }
  const real = ws.asWorkspace
  ws.asWorkspace = () => Object.assign(Object.create(null), real(), { flash: (f: (typeof flashes)[number]) => flashes.push(f) })
  harness = withActions(() =>
    createFileActions({
      workspace: () => ws.asWorkspace(),
      open: (path) => opened.push(path),
      share,
      showHistory: () => {
        history++
      },
      reveal: (path) => revealed.push(path),
      index: () => index,
    })
  )
  fileOps = harness.actions
})

afterEach(() => harness.stop())

describe('handle', () => {
  it('parks the four dialog ops and narrows them for TreeOpDialog', () => {
    fileOps.handle({ type: 'new-folder', dir: 'docs' })
    harness.flush()
    expect(fileOps.dialog).toEqual({ mode: 'new-folder', path: 'docs', kind: 'dir' })

    fileOps.handle({ type: 'rename', path: 'docs/a.md', kind: 'text' })
    harness.flush()
    expect(fileOps.dialog).toEqual({ mode: 'rename', path: 'docs/a.md', kind: 'text' })

    fileOps.cancel()
    harness.flush()
    expect(fileOps.dialog).toBeNull()
  })

  it('dispatches the rest to their own affordance and never opens the dialog', async () => {
    fileOps.handle({ type: 'share-folder', path: 'docs' })
    fileOps.handle({ type: 'add-share', dir: 'notes' })
    fileOps.handle({ type: 'add-link', path: 'docs' })
    fileOps.handle({ type: 'unshare', path: 'docs' })
    fileOps.handle({ type: 'unmount', path: 'notes' })
    fileOps.handle({ type: 'move-to', from: 'docs/a.md', to: 'notes/a.md' })
    fileOps.handle({ type: 'history', path: 'notes/b.md' })
    fileOps.handle({ type: 'new-file', dir: 'notes' })
    // createFile and the move are async: let their hops settle.
    await settle()
    harness.flush()

    expect(share.folderSharePath).toBe('docs')
    expect(share.addShareOpen).toEqual({ dir: 'notes' })
    expect(share.addLinkPath).toBe('docs')
    expect(share.asked).toEqual(['unshare:docs', 'unmount:notes'])
    expect(share.moves).toEqual(['docs/a.md -> notes/a.md'])
    expect(history).toBe(1)
    expect(opened).toEqual(['notes/b.md', 'notes/untitled-1.md'])
    // The move plans its link rewrites first, so the note creation lands before it.
    expect(ws.calls).toEqual(['createFile(notes)', 'movePath(docs/a.md, notes/a.md)'])
    expect(fileOps.dialog).toBeNull()
  })
})

describe('confirm', () => {
  it('new folder: creates it under its dir and reveals it', async () => {
    fileOps.handle({ type: 'new-folder', dir: 'docs' })
    await fileOps.confirm('sub')
    expect(ws.calls).toEqual(['createDir(docs/sub)'])
    expect(revealed).toEqual(['docs/sub'])
    expect(fileOps.op).toBeNull()
  })

  it('rename keeps the parent; move goes through the boundary check', async () => {
    fileOps.handle({ type: 'rename', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('z.md')
    expect(ws.calls).toEqual(['renamePath(docs/a.md, docs/z.md)'])

    fileOps.handle({ type: 'move', path: 'docs/z.md', kind: 'text' })
    await fileOps.confirm('notes')
    expect(share.moves).toEqual(['docs/z.md -> notes/z.md'])

    fileOps.handle({ type: 'move', path: 'notes/z.md', kind: 'text' })
    await fileOps.confirm('')
    expect(share.moves[1]).toBe('notes/z.md -> z.md')
  })

  it('delete deletes', async () => {
    fileOps.handle({ type: 'delete', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('')
    expect(ws.calls).toEqual(['deletePath(docs/a.md)'])
  })
})

describe("rename checks (P3) — the tree's dialog and the inline title share them", () => {
  const tree = getLL().web.tree_op

  it('renameNote keeps the folder and the .md, and resolves the new path', async () => {
    await expect(fileOps.renameNote('docs/a.md', ' Plans ')).resolves.toBe('docs/Plans.md')
    expect(ws.calls).toEqual(['renamePath(docs/a.md, docs/Plans.md)'])
  })

  it('renameNote: an unchanged or empty name writes nothing', async () => {
    await expect(fileOps.renameNote('docs/a.md', 'a')).resolves.toBe('docs/a.md')
    await expect(fileOps.renameNote('docs/a.md', '  ')).resolves.toBeNull()
    expect(ws.calls).toEqual([])
  })

  it("renameNote refuses an illegal name, flashing the tree's wording", async () => {
    for (const bad of ['a/b', 'what?', 'x:y', '.hidden']) {
      await expect(fileOps.renameNote('docs/a.md', bad)).resolves.toBeNull()
    }
    expect(ws.calls).toEqual([])
    expect(flashes.map((f) => f.text)).toEqual([
      tree.invalid_name({ name: 'a/b.md' }),
      tree.invalid_name({ name: 'what?.md' }),
      tree.invalid_name({ name: 'x:y.md' }),
      tree.invalid_name({ name: '.hidden.md' }),
    ])
    expect(flashes[0]!.path).toBe('docs/a.md')
  })

  it('renameNote refuses a name already in the folder, whatever its case — but not a case-only rename', async () => {
    ws.ui.files = [...ws.ui.files, { path: 'docs/Taken.md', guid: 'g:t', kind: 'text' }]
    await expect(fileOps.renameNote('docs/a.md', 'taken')).resolves.toBeNull()
    expect(flashes.map((f) => f.text)).toEqual([tree.name_taken({ name: 'taken.md' })])
    // The same name in ANOTHER folder is no collision.
    await expect(fileOps.renameNote('notes/b.md', 'Taken')).resolves.toBe('notes/Taken.md')
    await expect(fileOps.renameNote('docs/Taken.md', 'TAKEN')).resolves.toBe('docs/TAKEN.md')
  })

  it('the tree dialog refuses the same way instead of renaming onto an existing file', async () => {
    fileOps.handle({ type: 'rename', path: 'docs/a.md', kind: 'text' })
    ws.ui.files = [...ws.ui.files, { path: 'docs/z.md', guid: 'g:z', kind: 'text' }]
    await fileOps.confirm('z.md')
    fileOps.handle({ type: 'rename', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('a|b.md')
    expect(ws.calls).toEqual([])
    expect(flashes.map((f) => f.text)).toEqual([
      tree.name_taken({ name: 'z.md' }),
      tree.invalid_name({ name: 'a|b.md' }),
    ])
  })
})

describe('renames follow (DB6) — the planner over the index, applied on live docs', () => {
  const t = getLL().web.link_follow

  /** Seed the vault: each path's text goes to the index AND to a live doc. */
  function seed(vault: Record<string, string>): void {
    ws.ui.files = Object.keys(vault).map((path) => ({ path, guid: `g:${path}`, kind: 'text' as const }))
    for (const [path, text] of Object.entries(vault)) {
      index.upsert({ guid: `g:${path}`, path, text })
      ws.docs.set(path, fakeDoc(`g:${path}`, text))
    }
  }

  it('the inline title: bare links follow the new name, path links the new path; alias and anchor stay', async () => {
    seed({
      'docs/a.md': '# a',
      'notes/b.md': 'See [[a]], [[docs/a|the a note]] and [[a#Top]].',
      'notes/c.md': '---\npillar: "[[a]]"\n---\nNothing else.',
      'notes/d.md': 'Unrelated [[b]].',
    })
    await expect(fileOps.renameNote('docs/a.md', 'Plans')).resolves.toBe('docs/Plans.md')
    expect(ws.docs.get('notes/b.md')!.getText()).toBe('See [[Plans]], [[docs/Plans|the a note]] and [[Plans#Top]].')
    expect(ws.docs.get('notes/c.md')!.getText()).toBe('---\npillar: "[[Plans]]"\n---\nNothing else.')
    expect(ws.docs.get('notes/d.md')!.getText()).toBe('Unrelated [[b]].')
    // One 'local' transaction per note, so the edit is each note's own for sync and undo.
    expect(ws.docs.get('notes/b.md')!.origins).toEqual(['local'])
    expect(ws.docs.get('notes/d.md')!.origins).toEqual([])
    expect(flashes).toEqual([{ level: 'info', text: t.updated({ count: 2 }), path: 'docs/Plans.md' }])
    expect(fileOps.linksConfirm).toBeNull()
  })

  it("the tree's rename dialog and a drop take the same path", async () => {
    seed({ 'docs/a.md': '', 'notes/b.md': '[[a]] and [[docs/a]]' })
    fileOps.handle({ type: 'rename', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('z.md')
    expect(ws.docs.get('notes/b.md')!.getText()).toBe('[[z]] and [[docs/z]]')
    syncIndex()

    // Moving between folders: the bare link is untouched, the path one follows.
    fileOps.handle({ type: 'move-to', from: 'docs/z.md', to: 'archive/z.md' })
    await vi.waitFor(() => expect(share.moves).toEqual(['docs/z.md -> archive/z.md']))
    expect(ws.docs.get('notes/b.md')!.getText()).toBe('[[z]] and [[archive/z]]')
    expect(flashes.map((f) => f.text)).toEqual([t.updated({ count: 1 }), t.updated({ count: 1 })])
  })

  it('a folder move rewrites path links in every referencing note, including one inside the folder', async () => {
    seed({ 'docs/a.md': 'Sibling [[docs/b]] and [[b]]', 'docs/b.md': '', 'notes/c.md': '[[docs/a]] [[a]]' })
    fileOps.handle({ type: 'move', path: 'docs', kind: 'dir' })
    await fileOps.confirm('archive')
    expect(share.moves).toEqual(['docs -> archive/docs'])
    expect(ws.docs.get('archive/docs/a.md')!.getText()).toBe('Sibling [[archive/docs/b]] and [[b]]')
    expect(ws.docs.get('notes/c.md')!.getText()).toBe('[[archive/docs/a]] [[a]]')
  })

  it('over the threshold it asks first, naming the count; confirm renames and updates, cancel does nothing', async () => {
    const vault: Record<string, string> = { 'docs/a.md': '' }
    for (let i = 0; i <= LINK_CONFIRM_THRESHOLD; i++) vault[`notes/n${i}.md`] = 'See [[a]].'
    seed(vault)

    const cancelled = fileOps.renameNote('docs/a.md', 'Plans')
    await vi.waitFor(() => expect(fileOps.linksConfirm).not.toBeNull())
    expect(fileOps.linksConfirm).toEqual({ kind: 'rename', path: 'docs/a.md', name: 'a.md', notes: LINK_CONFIRM_THRESHOLD + 1 })
    expect(ws.calls).toEqual([])
    fileOps.cancelLinks()
    await expect(cancelled).resolves.toBeNull()
    expect(ws.calls).toEqual([])
    expect(ws.docs.get('notes/n0.md')!.getText()).toBe('See [[a]].')

    const confirmed = fileOps.renameNote('docs/a.md', 'Plans')
    await vi.waitFor(() => expect(fileOps.linksConfirm?.notes).toBe(LINK_CONFIRM_THRESHOLD + 1))
    fileOps.confirmLinks()
    await expect(confirmed).resolves.toBe('docs/Plans.md')
    expect(ws.calls).toEqual(['renamePath(docs/a.md, docs/Plans.md)'])
    expect(ws.docs.get(`notes/n${LINK_CONFIRM_THRESHOLD}.md`)!.getText()).toBe('See [[Plans]].')
    expect(flashes).toEqual([{ level: 'info', text: t.updated({ count: LINK_CONFIRM_THRESHOLD + 1 }), path: 'docs/Plans.md' }])
    expect(fileOps.linksConfirm).toBeNull()
  })

  it('at the threshold it just does it', async () => {
    const vault: Record<string, string> = { 'docs/a.md': '' }
    for (let i = 0; i < LINK_CONFIRM_THRESHOLD; i++) vault[`notes/n${i}.md`] = 'See [[a]].'
    seed(vault)
    await expect(fileOps.renameNote('docs/a.md', 'Plans')).resolves.toBe('docs/Plans.md')
    expect(fileOps.linksConfirm).toBeNull()
    expect(flashes.map((f) => f.text)).toEqual([t.updated({ count: LINK_CONFIRM_THRESHOLD })])
  })

  it('a note whose text is not what the index saw is reported, not guessed at; the others still update', async () => {
    seed({ 'docs/a.md': '', 'notes/b.md': 'See [[a]].', 'notes/c.md': 'See [[a]].' })
    // c changed under the index: the link is no longer where the plan says.
    ws.docs.set('notes/c.md', fakeDoc('g:notes/c.md', 'Now: see [[a]].'))
    await fileOps.renameNote('docs/a.md', 'Plans')
    expect(ws.docs.get('notes/b.md')!.getText()).toBe('See [[Plans]].')
    expect(ws.docs.get('notes/c.md')!.getText()).toBe('Now: see [[a]].')
    expect(ws.docs.get('notes/c.md')!.origins).toEqual([])
    expect(flashes).toEqual([
      { level: 'info', text: t.updated({ count: 1 }), path: 'docs/Plans.md' },
      { level: 'warn', text: t.not_updated({ count: 1 }), path: 'notes/c.md' },
    ])
  })

  it('a rename the vault did not carry out leaves every link as it was', async () => {
    seed({ 'docs/a.md': '', 'notes/b.md': 'See [[a]].' })
    ws.failNext('renamePath', 'disk full')
    await expect(fileOps.renameNote('docs/a.md', 'Plans')).rejects.toThrow('disk full')
    expect(ws.docs.get('notes/b.md')!.getText()).toBe('See [[a]].')
    expect(flashes).toEqual([])
  })

  it('with no index there is nothing to follow and the rename still happens', async () => {
    index = null as unknown as MemoryIndex
    await expect(fileOps.renameNote('docs/a.md', 'Plans')).resolves.toBe('docs/Plans.md')
    expect(ws.calls).toEqual(['renamePath(docs/a.md, docs/Plans.md)'])
  })
})

describe('createFromLink', () => {
  it('lands beside the linking note, adds .md, seeds a heading, and opens it', async () => {
    ws.ui.selectedPath = 'docs/a.md'
    await fileOps.createFromLink(' Ideas ')
    expect(ws.calls).toEqual(['createFile(docs, Ideas.md, # Ideas\n\n)'])
    expect(opened).toEqual(['docs/Ideas.md'])
  })

  it('a path-shaped target is taken as written, from the root', async () => {
    ws.ui.selectedPath = 'docs/a.md'
    await fileOps.createFromLink('/archive/old.md')
    expect(ws.calls).toEqual(['createFile(, archive/old.md, # old.md\n\n)'])
  })

  it('an empty target is a no-op', async () => {
    await fileOps.createFromLink('  /// ')
    expect(ws.calls).toEqual([])
  })
})
