import { describe, expect, it } from 'vitest'
import {
  buildTree,
  containingDir,
  dirPaths,
  planDrop,
  SHARE_BLOCKED_ROOT_SHARED,
  treeMenuItems,
  type MountLike,
} from './tree-model.js'
import type { FileRow } from './workspace.svelte.js'

const row = (path: string, kind: FileRow['kind'] = 'text'): FileRow => ({
  path,
  kind,
  guid: `g:${path}`,
})

describe('buildTree', () => {
  it('nests by path segments, dirs first, alphabetical within groups', () => {
    const tree = buildTree([
      row('zeta.md'),
      row('notes/b.md'),
      row('notes/a.md'),
      row('assets', 'dir'),
      row('assets/img.png', 'binary'),
    ])
    expect(tree.map((n) => n.path)).toEqual(['assets', 'notes', 'zeta.md'])
    const notes = tree[1]!
    expect(notes.kind).toBe('dir')
    expect(notes.children.map((c) => c.name)).toEqual(['a.md', 'b.md'])
    expect(tree[0]!.children[0]!.kind).toBe('binary')
  })

  it('derives dirs from file prefixes even without dir entries (pre-M3 maps)', () => {
    const tree = buildTree([row('deep/er/note.md')])
    expect(tree).toHaveLength(1)
    expect(tree[0]!.path).toBe('deep')
    expect(tree[0]!.children[0]!.path).toBe('deep/er')
    expect(tree[0]!.children[0]!.children[0]!.path).toBe('deep/er/note.md')
  })

  it('renders explicit empty dirs and keeps their guid', () => {
    const tree = buildTree([row('empty', 'dir')])
    expect(tree[0]!.kind).toBe('dir')
    expect(tree[0]!.guid).toBe('g:empty')
    expect(tree[0]!.children).toEqual([])
  })
})

describe('dirPaths', () => {
  it('collects explicit dirs and implied parents, sorted', () => {
    expect(dirPaths([row('a/b/c.md'), row('z', 'dir')])).toEqual(['a', 'a/b', 'z'])
  })
})

describe('containingDir', () => {
  it('is the dir itself for dirs, the parent for files, root for null', () => {
    expect(containingDir(null)).toBe('')
    expect(containingDir('top.md', 'text')).toBe('')
    expect(containingDir('a/b/n.md', 'text')).toBe('a/b')
    expect(containingDir('a/b', 'dir')).toBe('a/b')
  })
})

describe('treeMenuItems', () => {
  const actions = (...args: Parameters<typeof treeMenuItems>) =>
    treeMenuItems(...args).map((i) => i.action)
  const plain = { mounts: [] as MountLike[], rootShared: false }

  it('offers only creation on the tree background (vault root)', () => {
    expect(actions({ kind: 'root' }, plain)).toEqual(['new-file', 'new-folder'])
  })

  it('offers rename/move/delete on a file, and no sharing', () => {
    expect(actions({ kind: 'text', path: 'a/n.md' }, plain)).toEqual(['rename', 'move', 'delete'])
    expect(actions({ kind: 'binary', path: 'a/i.png' }, plain)).toEqual([
      'rename',
      'move',
      'delete',
    ])
  })

  it('offers Share on a plain folder of an unshared vault', () => {
    const items = treeMenuItems({ kind: 'dir', path: 'notes' }, plain)
    expect(items.map((i) => i.action)).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'move',
      'share',
      'delete',
    ])
    expect(items.find((i) => i.action === 'share')?.disabled).toBeUndefined()
  })

  it('shows Share DISABLED, with the rule spelled out, in a root-shared vault', () => {
    const items = treeMenuItems({ kind: 'dir', path: 'notes' }, { mounts: [], rootShared: true })
    const share = items.find((i) => i.action === 'share')!
    // Visible-but-inert, never hidden: the hidden rule is what confused people.
    expect(share.disabled).toBe(true)
    expect(share.reason).toBe(SHARE_BLOCKED_ROOT_SHARED)
  })

  it('refuses Share for folders that would nest with an existing mount', () => {
    const mounts: MountLike[] = [{ path: 'team', provenance: 'carved' }]
    const inside = treeMenuItems({ kind: 'dir', path: 'team/sub' }, { mounts, rootShared: false })
    expect(inside.find((i) => i.action === 'share')!.disabled).toBe(true)
    expect(inside.find((i) => i.action === 'share')!.reason).toContain("'team'")

    // A parent of a mount is refused for the same reason, from the other side.
    const nested: MountLike[] = [{ path: 'team/inner', provenance: 'joined' }]
    const parent = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts: nested, rootShared: false })
    expect(parent.find((i) => i.action === 'share')!.disabled).toBe(true)
    expect(parent.find((i) => i.action === 'share')!.reason).toContain("'team/inner'")
  })

  it('replaces Share with share management on a mount root', () => {
    const carved: MountLike[] = [{ path: 'team', provenance: 'carved' }]
    expect(actions({ kind: 'dir', path: 'team' }, { mounts: carved, rootShared: false })).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'move',
      'manage',
      'unshare',
      'delete',
    ])
  })

  it('adds Unmount only for a joined mount', () => {
    const joined: MountLike[] = [{ path: 'team', provenance: 'joined' }]
    expect(actions({ kind: 'dir', path: 'team' }, { mounts: joined, rootShared: false })).toContain(
      'unmount'
    )
  })

  it('marks delete as dangerous and separates the sharing group', () => {
    const items = treeMenuItems({ kind: 'dir', path: 'notes' }, plain)
    expect(items.find((i) => i.action === 'delete')?.danger).toBe(true)
    expect(items.find((i) => i.action === 'share')?.separatorBefore).toBe(true)
  })
})

describe('planDrop', () => {
  it('moves a file into a folder', () => {
    expect(planDrop('n.md', 'notes')).toEqual({ ok: true, to: 'notes/n.md' })
  })

  it('moves a file back out to the vault root', () => {
    expect(planDrop('notes/n.md', '')).toEqual({ ok: true, to: 'n.md' })
  })

  it('moves a whole folder into a sibling', () => {
    expect(planDrop('a/deep', 'b')).toEqual({ ok: true, to: 'b/deep' })
  })

  it('refuses a folder onto itself', () => {
    const plan = planDrop('a/deep', 'a/deep')
    expect(plan.ok).toBe(false)
    expect(plan).toMatchObject({ reason: expect.stringContaining('itself') })
  })

  it('refuses a folder into its own descendant, however deep', () => {
    expect(planDrop('a', 'a/b').ok).toBe(false)
    expect(planDrop('a', 'a/b/c/d').ok).toBe(false)
    // A sibling whose name merely starts the same is NOT a descendant.
    expect(planDrop('a', 'ab').ok).toBe(true)
  })

  it('no-ops a drop back into the same parent', () => {
    expect(planDrop('notes/n.md', 'notes').ok).toBe(false)
    expect(planDrop('top.md', '').ok).toBe(false)
  })

  it('refuses a drop that would collide with an existing name', () => {
    const plan = planDrop('n.md', 'notes', ['notes/n.md', 'notes/other.md'])
    expect(plan.ok).toBe(false)
    expect(plan).toMatchObject({ reason: expect.stringContaining('notes/n.md') })
    // The same name elsewhere in the vault is irrelevant.
    expect(planDrop('n.md', 'notes', ['archive/n.md']).ok).toBe(true)
  })

  it('refuses when nothing is being dragged', () => {
    expect(planDrop('', 'notes').ok).toBe(false)
  })
})
