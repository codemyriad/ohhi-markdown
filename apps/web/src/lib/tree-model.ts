/**
 * Pure tree model for the file tree (M3): derives a nested, renderable tree
 * from the workspace's flat rows. Directories come from BOTH dir entries
 * (first-class since M3) and file-path prefixes — maps written before dir
 * entries existed still render a full tree.
 */
import type { FileRow } from './workspace.svelte.js'

export interface TreeNode {
  /** Basename shown in the tree. */
  name: string
  /** Full workspace-relative path. */
  path: string
  kind: 'dir' | 'text' | 'binary'
  /** Doc guid for files; dir entries' guid (or '' for an implied dir). */
  guid: string
  children: TreeNode[]
}

/** Dirs first, then files; each group alphabetical (case-insensitive-ish). */
function nodeOrder(a: TreeNode, b: TreeNode): number {
  const ad = a.kind === 'dir' ? 0 : 1
  const bd = b.kind === 'dir' ? 0 : 1
  if (ad !== bd) return ad - bd
  return a.name.localeCompare(b.name)
}

export function buildTree(rows: FileRow[]): TreeNode[] {
  const dirNodes = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  const dirNode = (path: string): TreeNode => {
    let node = dirNodes.get(path)
    if (node) return node
    const i = path.lastIndexOf('/')
    node = { name: path.slice(i + 1), path, kind: 'dir', guid: '', children: [] }
    dirNodes.set(path, node)
    if (i === -1) roots.push(node)
    else dirNode(path.slice(0, i)).children.push(node)
    return node
  }

  // Dir entries first so explicit dirs exist even when empty.
  for (const row of rows) {
    if (row.kind === 'dir') dirNode(row.path).guid = row.guid
  }
  for (const row of rows) {
    if (row.kind === 'dir') continue
    const i = row.path.lastIndexOf('/')
    const node: TreeNode = {
      name: row.path.slice(i + 1),
      path: row.path,
      kind: row.kind,
      guid: row.guid,
      children: [],
    }
    if (i === -1) roots.push(node)
    else dirNode(row.path.slice(0, i)).children.push(node)
  }

  const sortDeep = (nodes: TreeNode[]): void => {
    nodes.sort(nodeOrder)
    for (const n of nodes) if (n.children.length) sortDeep(n.children)
  }
  sortDeep(roots)
  return roots
}

/** Every directory path, sorted — the move-target options ('' = vault root). */
export function dirPaths(rows: FileRow[]): string[] {
  const out = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'dir') out.add(row.path)
    const segs = row.path.split('/')
    for (let i = 1; i < segs.length; i++) out.add(segs.slice(0, i).join('/'))
  }
  return [...out].sort()
}

/** A tree operation requested from the file tree; App owns the dialogs. */
export type TreeOp =
  | { type: 'new-file'; dir: string }
  | { type: 'new-folder'; dir: string }
  | { type: 'rename'; path: string; kind: 'dir' | 'text' | 'binary' }
  | { type: 'move'; path: string; kind: 'dir' | 'text' | 'binary' }
  | { type: 'delete'; path: string; kind: 'dir' | 'text' | 'binary' }

/** The directory a tree operation should target for a given selection. */
export function containingDir(path: string | null, kind?: 'dir' | 'text' | 'binary'): string {
  if (!path) return ''
  if (kind === 'dir') return path
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}
