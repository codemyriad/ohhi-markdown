import { describe, expect, it } from 'vitest'
import { buildTree, containingDir, dirPaths } from './tree-model.js'
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
