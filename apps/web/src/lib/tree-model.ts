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
import { getLL } from '@ohhi/i18n'
import type { MountLike } from './share-status.js'
import type { FileRow, MountUiStatus } from './workspace.svelte.js'

/**
 * One `MountLike` for the whole shell: `share-status.ts` owns it (it needs
 * every field), and this module re-exports it so the tree's callers import
 * the mount shape from wherever they already are. Two structural copies of
 * "what a mount looks like" is how the tree and the rail come to disagree
 * about the same folder — `MountInfo` satisfies this one.
 */
export type { MountLike }

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

  // Dir entries first so explicit dirs exist even when empty. A 'mount' row
  // (N1) is a nested share's root: a directory on disk, owned by another mount
  // session — it renders as the folder it is (the badge is N1's UI half).
  for (const row of rows) {
    if (row.kind === 'dir' || row.kind === 'mount') dirNode(row.path).guid = row.guid
  }
  for (const row of rows) {
    if (row.kind === 'dir' || row.kind === 'mount') continue
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
    if (row.kind === 'dir' || row.kind === 'mount') out.add(row.path)
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
  /**
   * Paste the link for a mount this device holds no token for (N1,
   * `status:'needs-token'`) — activates it in place, no re-seed.
   */
  | { type: 'add-link'; path: string }
  /** Show the pre-image journal for this note in the rail (W3). */
  | { type: 'history'; path: string }

// ---- provenance filter (R3.2, M4) ----

export type TreeFilter = 'all' | 'local' | 'shared'

/**
 * Filter rows by share provenance.
 *
 * Classification is by `ui.mounts` — the mount roots and their status — and
 * never by whether a mount session is relay-attached (`isShared()`): a
 * `needs-token` mount has no relay, no link and no providers, and its files
 * are SHARED all the same (spike S10 Q2). A shared root vault makes
 * everything shared. Ancestor dirs of surviving rows re-derive inside
 * buildTree, so filtering never breaks the tree shape.
 */
export function filterRows(
  rows: { path: string; kind: string }[],
  filter: TreeFilter,
  mounts: MountLike[],
  rootShared: boolean
): typeof rows {
  if (filter === 'all') return rows
  const roots = mountRoots(mounts)
  const isShared = (path: string): boolean =>
    rootShared || roots.some((root) => path === root || path.startsWith(`${root}/`))
  return rows.filter((r) => (filter === 'shared' ? isShared(r.path) : !isShared(r.path)))
}

/** Every shared subtree's root path, whatever state the mount is in. */
export function mountRoots(mounts: MountLike[]): string[] {
  return mounts.filter((m) => m.path !== '' && m.provenance !== 'local').map((m) => m.path)
}

/** The directory a tree operation should target for a given selection. */
export function containingDir(path: string | null, kind?: 'dir' | 'text' | 'binary'): string {
  if (!path) return ''
  if (kind === 'dir') return path
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

// ---- context menu (2026-09-07) ----

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
  | 'add-link'
  | 'history'

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
 * Sharing a folder of a shared vault is no longer refused: with depth-1
 * nesting (device-link-shaping A5) the root mount is the one mount that may
 * contain mounts, so the V1 "this vault is already shared as a whole" reason
 * is gone along with the guard. Folder-in-folder nesting is still refused,
 * and still says so.
 */
function shareItem(path: string, ctx: { mounts: MountLike[]; rootShared: boolean }): TreeMenuItem {
  const t = getLL().web.tree
  const item: TreeMenuItem = { action: 'share', label: t.menu.share() }
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

/**
 * The folders *Share a folder…* can offer when no folder is in hand (the
 * Shared view's door, sharing E2): every directory the tree menu would let
 * you share — the same `shareItem` rule, so the two never disagree — minus
 * the mount roots, which are shared already.
 */
export function shareableDirs(rows: FileRow[], mounts: MountLike[]): string[] {
  return dirPaths(rows).filter(
    (d) => d !== '' && !mounts.some((m) => m.path === d) && !shareItem(d, { mounts, rootShared: false }).disabled
  )
}

/**
 * "Add a shared folder here…" (chrome-shaping U3): joining lands a NEW mount
 * inside `dir`, so the same folder-in-folder no-nesting rule as sharing
 * applies — stated, not hidden. A shared (device-linked) root is fine:
 * depth-1 nesting (device-link-shaping A5) lets the root hold mounts, and
 * `joinMount` announces the new mount to the root's peers.
 */
function addShareItem(dir: string, ctx: { mounts: MountLike[] }): TreeMenuItem {
  const t = getLL().web.tree
  const item: TreeMenuItem = { action: 'add-share', label: t.menu.add_share() }
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
      // Notes only: the journal holds pre-images of files Editor writes, and
      // Editor never writes a binary (they are excluded from sync entirely).
      ...(target.kind === 'text' ? [{ action: 'history' as const, label: t.history() }] : []),
      { action: 'delete', label: t.delete(), danger: true, separatorBefore: true },
    ]
  }
  const mnt = getLL().web.mounts
  const mount = ctx.mounts.find((m) => m.path === target.path && m.provenance !== 'local') ?? null
  const status: MountUiStatus = mount?.status ?? 'active'
  const busy = status === 'adopting' || status === 'absorbing'
  /**
   * A mount root is a folder owned by ANOTHER mount session: renaming, moving
   * or deleting it from the tree would pull the share out from under itself —
   * and inside a shared parent it would tell every peer something untrue
   * (spike S10 Q5, the rename races). Refused where the user asks, with the
   * reason, never by an absent item.
   */
  const rootRule = (reason: string): Pick<TreeMenuItem, 'disabled' | 'reason'> =>
    mount ? { disabled: true, reason } : {}
  const items: TreeMenuItem[] = [
    { action: 'new-file', label: t.new_file() },
    { action: 'new-folder', label: t.new_folder() },
    {
      action: 'rename',
      label: t.rename(),
      separatorBefore: true,
      ...rootRule(mnt.reason.mount_root_rename({ path: target.path })),
    },
    { action: 'move', label: t.move(), ...rootRule(mnt.reason.mount_root_move({ path: target.path })) },
  ]
  if (mount && status === 'needs-token') {
    // Keep + mark (shaping decision 4): the files are here and usable, the
    // share is real, only the key is missing — so the only sharing action is
    // the one that supplies it, and the rest say why they are inert.
    items.push({ action: 'add-link', label: mnt.add_link(), separatorBefore: true })
    items.push({
      action: 'manage',
      label: t.manage_tokens(),
      disabled: true,
      reason: mnt.reason.link_needed(),
    })
    items.push({ action: 'unmount', label: t.unmount() })
  } else if (mount && busy) {
    items.push({
      action: 'manage',
      label: t.manage_tokens(),
      disabled: true,
      reason: status === 'absorbing' ? mnt.reason.folding_back() : mnt.reason.attaching(),
      separatorBefore: true,
    })
  } else if (mount) {
    items.push({ action: 'manage', label: t.manage_tokens(), separatorBefore: true })
    items.push({ action: 'unshare', label: t.unshare() })
    // 'adopted' is someone else's carve arriving through the parent room — it
    // drops the same way a joined mount does.
    if (mount.provenance === 'joined' || mount.provenance === 'adopted') {
      items.push({ action: 'unmount', label: t.unmount() })
    }
  } else {
    items.push({ ...shareItem(target.path, ctx), separatorBefore: true })
  }
  items.push(addShareItem(target.path, ctx))
  items.push({
    action: 'delete',
    label: t.delete(),
    danger: true,
    separatorBefore: true,
    ...rootRule(mnt.reason.mount_root_delete({ path: target.path })),
  })
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
  existing: Iterable<string> = [],
  mountRootPaths: Iterable<string> = []
): DropPlan {
  const t = getLL().web.tree.drop
  if (!from) return { ok: false, reason: t.nothing() }
  // A mount root belongs to its own mount session (N1): dragging it would move
  // the share out from under itself, so the drag refuses for the same reason
  // the menu disables Move… — stated on the row the pointer is over.
  for (const root of mountRootPaths) {
    if (root !== '' && root === from) {
      return { ok: false, reason: getLL().web.mounts.reason.mount_root_move({ path: from }) }
    }
  }
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
