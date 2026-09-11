import { describe, expect, it } from 'vitest'
import {
  buildTree,
  containingDir,
  dirPaths,
  filterRows,
  mountRoots,
  planDrop,
  treeMenuItems,
  type MountLike,
} from './tree-model.js'
import type { FileRow } from './workspace.svelte.js'

const row = (path: string, kind: FileRow['kind'] = 'text'): FileRow => ({
  path,
  kind,
  guid: `g:${path}`,
})

/**
 * The shell's one `MountLike` (owned by share-status.ts, re-exported here).
 * The tree reads path/provenance/status; the type carries the whole mount so
 * the tree and the rail can never be handed different shapes of the same
 * folder.
 */
const mount = (
  path: string,
  provenance: MountLike['provenance'],
  status: MountLike['status'] = 'active'
): MountLike => ({ path, provenance, status, room: `room:${path}`, link: null })

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
    expect(actions({ kind: 'root' }, plain)).toEqual(['new-file', 'new-folder', 'add-share'])
  })

  it('offers rename/move/history/delete on a note, and no sharing', () => {
    expect(actions({ kind: 'text', path: 'a/n.md' }, plain)).toEqual([
      'rename',
      'move',
      'history',
      'delete',
    ])
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
      'add-share',
      'delete',
    ])
    expect(items.find((i) => i.action === 'share')?.disabled).toBeUndefined()
    expect(items.find((i) => i.action === 'add-share')?.disabled).toBeUndefined()
  })

  it('offers Share on a folder of a SHARED vault — depth-1 nesting removed that guard', () => {
    // device-link-shaping A5: the root mount is the one mount that may contain
    // mounts, so "this vault is already shared as a whole" is gone with the
    // throw it explained. Folder-in-folder nesting is still refused, below.
    const items = treeMenuItems({ kind: 'dir', path: 'notes' }, { mounts: [], rootShared: true })
    const share = items.find((i) => i.action === 'share')!
    expect(share.disabled).toBeUndefined()
    expect(share.reason).toBeUndefined()
  })

  it('refuses Share for folders that would nest with an existing mount', () => {
    const mounts: MountLike[] = [mount('team', 'carved')]
    const inside = treeMenuItems({ kind: 'dir', path: 'team/sub' }, { mounts, rootShared: false })
    expect(inside.find((i) => i.action === 'share')!.disabled).toBe(true)
    expect(inside.find((i) => i.action === 'share')!.reason).toContain("'team'")

    // A parent of a mount is refused for the same reason, from the other side.
    const nested: MountLike[] = [mount('team/inner', 'joined')]
    const parent = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts: nested, rootShared: false })
    expect(parent.find((i) => i.action === 'share')!.disabled).toBe(true)
    expect(parent.find((i) => i.action === 'share')!.reason).toContain("'team/inner'")
  })

  it('replaces Share with share management on a mount root', () => {
    const carved: MountLike[] = [mount('team', 'carved')]
    expect(actions({ kind: 'dir', path: 'team' }, { mounts: carved, rootShared: false })).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'move',
      'manage',
      'unshare',
      'add-share',
      'delete',
    ])
  })

  it('refuses Add-a-shared-folder where a joined mount would nest, with the rule spelled out', () => {
    const carved: MountLike[] = [mount('team', 'carved')]
    const onRoot = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts: carved, rootShared: false })
    expect(onRoot.find((i) => i.action === 'add-share')!.disabled).toBe(true)
    expect(onRoot.find((i) => i.action === 'add-share')!.reason).toContain("'team'")
    const inside = treeMenuItems({ kind: 'dir', path: 'team/sub' }, { mounts: carved, rootShared: false })
    expect(inside.find((i) => i.action === 'add-share')!.disabled).toBe(true)
    // A shared (device-linked) root may hold mounts (device-link-shaping A5):
    // Add-a-shared-folder is offered plainly there, and joinMount announces it.
    const rootShared = treeMenuItems({ kind: 'root' }, { mounts: [], rootShared: true })
    expect(rootShared.find((i) => i.action === 'add-share')!.disabled).toBeUndefined()
    // Outside any mount it is offered plainly.
    const plainDir = treeMenuItems({ kind: 'dir', path: 'notes' }, { mounts: carved, rootShared: false })
    expect(plainDir.find((i) => i.action === 'add-share')!.disabled).toBeUndefined()
  })

  it('adds Unmount only for a joined mount', () => {
    const joined: MountLike[] = [mount('team', 'joined')]
    expect(actions({ kind: 'dir', path: 'team' }, { mounts: joined, rootShared: false })).toContain(
      'unmount'
    )
  })


  it('cannot rename, move or delete a mount root — the reason is stated, the item stays', () => {
    const carved: MountLike[] = [mount('team', 'carved')]
    const items = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts: carved, rootShared: false })
    for (const action of ['rename', 'move', 'delete'] as const) {
      const item = items.find((i) => i.action === action)!
      expect(item.disabled).toBe(true)
      expect(item.reason).toContain("'team'")
      expect(item.reason).toContain('shared folder')
    }
    // A plain folder is untouched by the rule.
    const plainItems = treeMenuItems({ kind: 'dir', path: 'notes' }, { mounts: carved, rootShared: false })
    expect(plainItems.find((i) => i.action === 'rename')!.disabled).toBeUndefined()
    expect(plainItems.find((i) => i.action === 'delete')!.disabled).toBeUndefined()
  })

  it('offers Add link… on a needs-token mount root, and says why the rest is inert', () => {
    const mounts: MountLike[] = [mount('team', 'adopted', 'needs-token')]
    const items = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts, rootShared: true })
    expect(items.map((i) => i.action)).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'move',
      'add-link',
      'manage',
      'unmount',
      'add-share',
      'delete',
    ])
    // The one action that supplies what is missing is the only live one.
    expect(items.find((i) => i.action === 'add-link')!.disabled).toBeUndefined()
    const manage = items.find((i) => i.action === 'manage')!
    expect(manage.disabled).toBe(true)
    expect(manage.reason).toContain('no link')
    // Unshare is not offered: you cannot stop a share you hold no key to.
    expect(items.find((i) => i.action === 'unshare')).toBeUndefined()
  })

  it('offers nothing to act on while a mount is adopting or absorbing', () => {
    for (const [status, word] of [
      ['adopting', 'attached'],
      ['absorbing', 'folded back'],
    ] as const) {
      const mounts: MountLike[] = [mount('team', 'adopted', status)]
      const items = treeMenuItems({ kind: 'dir', path: 'team' }, { mounts, rootShared: true })
      const manage = items.find((i) => i.action === 'manage')!
      expect(manage.disabled).toBe(true)
      expect(manage.reason).toContain(word)
      expect(items.find((i) => i.action === 'add-link')).toBeUndefined()
      expect(items.find((i) => i.action === 'unshare')).toBeUndefined()
      expect(items.find((i) => i.action === 'unmount')).toBeUndefined()
    }
  })

  it('treats an ACTIVE adopted mount like a share of your own that can also be dropped', () => {
    const mounts: MountLike[] = [mount('team', 'adopted', 'active')]
    expect(actions({ kind: 'dir', path: 'team' }, { mounts, rootShared: true })).toEqual([
      'new-file',
      'new-folder',
      'rename',
      'move',
      'manage',
      'unshare',
      'unmount',
      'add-share',
      'delete',
    ])
  })

  it('still refuses Share inside a needs-token mount — mounts do not nest', () => {
    const mounts: MountLike[] = [mount('team', 'adopted', 'needs-token')]
    const inside = treeMenuItems({ kind: 'dir', path: 'team/sub' }, { mounts, rootShared: true })
    expect(inside.find((i) => i.action === 'share')!.disabled).toBe(true)
    expect(inside.find((i) => i.action === 'share')!.reason).toContain("'team'")
  })


  it('marks delete as dangerous and separates the sharing group', () => {
    const items = treeMenuItems({ kind: 'dir', path: 'notes' }, plain)
    expect(items.find((i) => i.action === 'delete')?.danger).toBe(true)
    expect(items.find((i) => i.action === 'share')?.separatorBefore).toBe(true)
  })
})


describe('filterRows — provenance is ui.mounts, not isShared()', () => {
  const rows = [
    { path: 'team/a.md', kind: 'text' },
    { path: 'notes/b.md', kind: 'text' },
  ]

  it('keeps a needs-token mount SHARED: it has no relay, its files are still not local', () => {
    // spike S10 Q2: filtering on the session's isShared() would file these
    // under "Local only", which is the one thing they are not.
    const mounts: MountLike[] = [mount('team', 'adopted', 'needs-token')]
    expect(filterRows(rows, 'shared', mounts, false).map((r) => r.path)).toEqual(['team/a.md'])
    expect(filterRows(rows, 'local', mounts, false).map((r) => r.path)).toEqual(['notes/b.md'])
    expect(filterRows(rows, 'all', mounts, false)).toHaveLength(2)
  })

  it('counts every row as shared in a root-shared vault, and ignores the root mount entry', () => {
    const mounts: MountLike[] = [mount('', 'local')]
    expect(filterRows(rows, 'shared', mounts, true)).toHaveLength(2)
    expect(filterRows(rows, 'shared', mounts, false)).toHaveLength(0)
  })
})

describe('mountRoots', () => {
  it('is every shared subtree, whatever state it is in, never the root mount', () => {
    expect(
      mountRoots([
        mount('', 'local'),
        mount('team', 'carved'),
        mount('design', 'adopted', 'needs-token'),
      ])
    ).toEqual(['team', 'design'])
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

  it('refuses to drag a mount root out of where its share lives', () => {
    const plan = planDrop('team', 'archive', [], ['team'])
    expect(plan.ok).toBe(false)
    expect(plan).toMatchObject({ reason: expect.stringContaining('shared folder') })
    // Files INSIDE it still move freely, and other folders are unaffected.
    expect(planDrop('team/n.md', 'archive', [], ['team']).ok).toBe(true)
    expect(planDrop('notes', 'archive', [], ['team']).ok).toBe(true)
  })
})
