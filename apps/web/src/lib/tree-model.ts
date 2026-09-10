/**
 * Pure tree model for the file tree (M3): derives a nested, renderable tree
 * from the workspace's flat rows. Directories come from BOTH dir entries
 * (first-class since M3) and file-path prefixes — maps written before dir
 * entries existed still render a full tree.
 *
 * The menu labels, refusal reasons and drop refusals are dictionary keys
 * (`web.tree.*`), read through `getLL()` at call time: this module is not a
 * component, and the tests run it on node after `test-setup.ts` has loaded
 * the locale.
 */
import { getLL } from '@editor/i18n'
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
  /** Drag-and-drop arrange: destination already resolved by `planDrop`. */
  | { type: 'move-to'; from: string; to: string }
  | { type: 'delete'; path: string; kind: 'dir' | 'text' | 'binary' }
  | { type: 'share-folder'; path: string }
  | { type: 'unshare'; path: string }
  | { type: 'unmount'; path: string }
  /** Join someone's share as a new folder INSIDE `dir` ('' = vault root). */
  | { type: 'add-share'; dir: string }

// ---- provenance filter (R3.2, M4) ----

export type TreeFilter = 'all' | 'local' | 'shared'

/**
 * Filter rows by share provenance. `sharedRoots` are the mount roots; a
 * shared root vault makes everything shared. Ancestor dirs of surviving rows
 * re-derive inside buildTree, so filtering never breaks the tree shape.
 */
export function filterRows(
  rows: { path: string; kind: string }[],
  filter: TreeFilter,
  sharedRoots: string[],
  rootShared: boolean
): typeof rows {
  if (filter === 'all') return rows
  const isShared = (path: string): boolean =>
    rootShared || sharedRoots.some((root) => path === root || path.startsWith(`${root}/`))
  return rows.filter((r) => (filter === 'shared' ? isShared(r.path) : !isShared(r.path)))
}

/** The directory a tree operation should target for a given selection. */
export function containingDir(path: string | null, kind?: 'dir' | 'text' | 'binary'): string {
  if (!path) return ''
  if (kind === 'dir') return path
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

// ---- context menu (2026-09-07) ----

/** The mount facts the menu needs; `MountInfo` satisfies it structurally. */
export interface MountLike {
  path: string
  provenance: 'local' | 'carved' | 'joined'
}

/** What was right-clicked: a row, or the tree's empty space (= vault root). */
export type TreeMenuTarget =
  | { kind: 'root' }
  | { kind: 'dir'; path: string }
  | { kind: 'text'; path: string }
  | { kind: 'binary'; path: string }

export type TreeMenuAction =
  | 'new-file'
  | 'new-folder'
  | 'rename'
  | 'move'
  | 'delete'
  | 'share'
  | 'manage'
  | 'unshare'
  | 'unmount'
  | 'add-share'

export interface TreeMenuItem {
  action: TreeMenuAction
  label: string
  /**
   * Rendered, focusable, and inert. Never *hidden*: a share rule the user
   * cannot see is the confusion this menu replaced (dogfood-shaping,
   * 2026-09-07) — `reason` is shown next to the item, not just as a title.
   */
  disabled?: boolean
  reason?: string
  danger?: boolean
  /** Draw a divider above this item. */
  separatorBefore?: boolean
}

/**
 * Why folder sharing is refused inside a whole-vault share. The V1 no-nested-
 * shares guard (spike S8, "The mount model") — stated in the menu rather than
 * enforced by an absent button.
 */
export const shareBlockedRootShared = (): string => getLL().web.tree.reason.share_root_shared()

function shareItem(path: string, ctx: { mounts: MountLike[]; rootShared: boolean }): TreeMenuItem {
  const t = getLL().web.tree
  const item: TreeMenuItem = { action: 'share', label: t.menu.share() }
  if (ctx.rootShared) return { ...item, disabled: true, reason: shareBlockedRootShared() }
  const inside = ctx.mounts.find((m) => m.path !== '' && path.startsWith(`${m.path}/`))
  if (inside) {
    return { ...item, disabled: true, reason: t.reason.share_inside({ path: inside.path }) }
  }
  const contains = ctx.mounts.find((m) => m.path.startsWith(`${path}/`))
  if (contains) {
    return { ...item, disabled: true, reason: t.reason.share_contains({ path: contains.path }) }
  }
  return item
}

export const addShareBlockedRootShared = (): string =>
  getLL().web.tree.reason.add_share_root_shared()

/**
 * "Add a shared folder here…" (chrome-shaping U3): joining lands a NEW mount
 * inside `dir`, so the same no-nesting rule as sharing applies — stated, not
 * hidden.
 */
function addShareItem(dir: string, ctx: { mounts: MountLike[]; rootShared: boolean }): TreeMenuItem {
  const t = getLL().web.tree
  const item: TreeMenuItem = { action: 'add-share', label: t.menu.add_share() }
  if (ctx.rootShared) return { ...item, disabled: true, reason: addShareBlockedRootShared() }
  const inside = ctx.mounts.find((m) => m.path !== '' && (dir === m.path || dir.startsWith(`${m.path}/`)))
  if (inside) {
    return { ...item, disabled: true, reason: t.reason.add_share_inside({ path: inside.path }) }
  }
  return item
}

/**
 * The context-menu items for a tree target. Pure: the menu component renders
 * whatever this returns and maps `action` back to a `TreeOp`.
 */
export function treeMenuItems(
  target: TreeMenuTarget,
  ctx: { mounts: MountLike[]; rootShared: boolean }
): TreeMenuItem[] {
  const t = getLL().web.tree.menu
  if (target.kind === 'root') {
    return [
      { action: 'new-file', label: t.new_file() },
      { action: 'new-folder', label: t.new_folder() },
      { ...addShareItem('', ctx), separatorBefore: true },
    ]
  }
  if (target.kind !== 'dir') {
    return [
      { action: 'rename', label: t.rename() },
      { action: 'move', label: t.move() },
      { action: 'delete', label: t.delete(), danger: true, separatorBefore: true },
    ]
  }
  const mount = ctx.mounts.find((m) => m.path === target.path) ?? null
  const items: TreeMenuItem[] = [
    { action: 'new-file', label: t.new_file() },
    { action: 'new-folder', label: t.new_folder() },
    { action: 'rename', label: t.rename(), separatorBefore: true },
    { action: 'move', label: t.move() },
  ]
  if (mount) {
    items.push({ action: 'manage', label: t.manage_tokens(), separatorBefore: true })
    items.push({ action: 'unshare', label: t.unshare() })
    if (mount.provenance === 'joined') items.push({ action: 'unmount', label: t.unmount() })
  } else {
    items.push({ ...shareItem(target.path, ctx), separatorBefore: true })
  }
  items.push(addShareItem(target.path, ctx))
  items.push({ action: 'delete', label: t.delete(), danger: true, separatorBefore: true })
  return items
}

// ---- drag-and-drop arrange (2026-09-07) ----

/** Where a drag may land, and why it may not. */
export type DropPlan = { ok: true; to: string } | { ok: false; reason: string }

/**
 * Validate dropping `from` into the directory `toDir` ('' = vault root).
 *
 * Pure on purpose: the refusals (a folder into its own descendant, a same-
 * parent no-op, a name collision) are the whole safety story of drag-arrange,
 * and they are cheaper to prove here than through a browser.
 */
export function planDrop(
  from: string,
  toDir: string,
  existing: Iterable<string> = []
): DropPlan {
  const t = getLL().web.tree.drop
  if (!from) return { ok: false, reason: t.nothing() }
  const cut = from.lastIndexOf('/')
  const name = from.slice(cut + 1)
  const parent = cut === -1 ? '' : from.slice(0, cut)
  if (toDir === from) return { ok: false, reason: t.onto_itself({ name }) }
  // Covers every descendant: only a folder can be a path prefix of a dir.
  if (toDir.startsWith(`${from}/`)) {
    return { ok: false, reason: t.inside_itself({ name }) }
  }
  if (toDir === parent) return { ok: false, reason: t.already_there({ name }) }
  const to = toDir ? `${toDir}/${name}` : name
  // A Set stays a Set: this runs on every `dragover`, which fires constantly.
  const taken = existing instanceof Set ? existing : new Set(existing)
  if (taken.has(to)) return { ok: false, reason: t.exists({ path: to }) }
  return { ok: true, to }
}
