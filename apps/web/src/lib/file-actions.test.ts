// @vitest-environment jsdom
/**
 * File operations (`file-actions.svelte.ts`): which tree requests open the
 * shared dialog and which are dispatched elsewhere, what the dialog's answer
 * does for each mode, and where a new note lands.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { createFileActions, type FileActions, type FileHost } from './file-actions.svelte.js'
import {
  actionsWorkspace,
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

beforeEach(() => {
  ws = actionsWorkspace(['docs/a.md', 'notes/b.md'])
  opened = []
  revealed = []
  history = 0
  share = {
    folderSharePath: null,
    addShareOpen: null,
    addLinkPath: null,
    moves: [],
    asked: [],
    move: async (from, to) => {
      share.moves.push(`${from} -> ${to}`)
    },
    askUnshare: (path) => share.asked.push(`unshare:${path}`),
    askUnmount: (path) => share.asked.push(`unmount:${path}`),
  }
  harness = withActions(() =>
    createFileActions({
      workspace: () => ws.asWorkspace(),
      open: (path) => opened.push(path),
      share,
      showHistory: () => {
        history++
      },
      reveal: (path) => revealed.push(path),
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
    // createFile is async: two hops (the record wrapper, then the open).
    await Promise.resolve()
    await Promise.resolve()
    harness.flush()

    expect(share.folderSharePath).toBe('docs')
    expect(share.addShareOpen).toEqual({ dir: 'notes' })
    expect(share.addLinkPath).toBe('docs')
    expect(share.asked).toEqual(['unshare:docs', 'unmount:notes'])
    expect(share.moves).toEqual(['docs/a.md -> notes/a.md'])
    expect(history).toBe(1)
    expect(opened).toEqual(['notes/b.md', 'notes/untitled-1.md'])
    expect(ws.calls).toEqual(['createFile(notes)'])
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

    fileOps.handle({ type: 'move', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('notes')
    expect(share.moves).toEqual(['docs/a.md -> notes/a.md'])

    fileOps.handle({ type: 'move', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('')
    expect(share.moves[1]).toBe('docs/a.md -> a.md')
  })

  it('delete deletes', async () => {
    fileOps.handle({ type: 'delete', path: 'docs/a.md', kind: 'text' })
    await fileOps.confirm('')
    expect(ws.calls).toEqual(['deletePath(docs/a.md)'])
  })
})

describe("rename checks (P3) — the tree's dialog and the inline title share them", () => {
  /** The facade with its flashes recorded and a rename that moves the row, as the vault's does. */
  function flashing(): { text: string; path?: string }[] {
    const flashes: { text: string; path?: string }[] = []
    const real = ws.asWorkspace()
    const live = Object.assign(Object.create(null), real, {
      flash: (f: { text: string; path?: string }) => flashes.push(f),
      renamePath: async (from: string, to: string) => {
        await real.renamePath(from, to)
        ws.ui.files = ws.ui.files.map((f) => (f.path === from ? { ...f, path: to } : f))
      },
    })
    ws.asWorkspace = () => live
    return flashes
  }
  const tree = getLL().web.tree_op

  it('renameNote keeps the folder and the .md, and resolves the new path', async () => {
    flashing()
    await expect(fileOps.renameNote('docs/a.md', ' Plans ')).resolves.toBe('docs/Plans.md')
    expect(ws.calls).toEqual(['renamePath(docs/a.md, docs/Plans.md)'])
  })

  it('renameNote: an unchanged or empty name writes nothing', async () => {
    flashing()
    await expect(fileOps.renameNote('docs/a.md', 'a')).resolves.toBe('docs/a.md')
    await expect(fileOps.renameNote('docs/a.md', '  ')).resolves.toBeNull()
    expect(ws.calls).toEqual([])
  })

  it("renameNote refuses an illegal name, flashing the tree's wording", async () => {
    const flashes = flashing()
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
    const flashes = flashing()
    await expect(fileOps.renameNote('docs/a.md', 'taken')).resolves.toBeNull()
    expect(flashes.map((f) => f.text)).toEqual([tree.name_taken({ name: 'taken.md' })])
    // The same name in ANOTHER folder is no collision.
    await expect(fileOps.renameNote('notes/b.md', 'Taken')).resolves.toBe('notes/Taken.md')
    await expect(fileOps.renameNote('docs/Taken.md', 'TAKEN')).resolves.toBe('docs/TAKEN.md')
  })

  it('the tree dialog refuses the same way instead of renaming onto an existing file', async () => {
    const flashes = flashing()
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
