/**
 * File operations (M3, P3): the tree and the command table REQUEST them; this
 * layer owns the one dialog they share and decides where each request goes.
 *
 * Most tree ops want a value first — a name, a destination, a confirm — and
 * those open `TreeOpDialog` (`dialog`). The rest have their own affordance:
 * a share request is handed to `share-actions`, a history request to the
 * rail, a drag-and-drop move straight to the boundary check. Note creation
 * lives here too because every "make a note and show it" — the tree, the
 * command, an unresolved wikilink — lands in the same two lines.
 */
import { COLLECTION_EXTENSION, newCollectionText } from '@ohhi/collections'
import { uniqueName } from './collection-cells.js'
import { getLL } from '@ohhi/i18n'
import type { ShareActions } from './share-actions.svelte.js'
import type { TreeOp } from './tree-model.js'
import type { Workspace } from './workspace.svelte.js'

/** What file operations need from the rest of the shell. */
export interface FileHost {
  /** The open vault, or null between vaults. Read reactively — a getter, not a value. */
  workspace(): Workspace | null
  /** Every "open this note" in the shell goes through one door (Fork 1-B). */
  open(path: string): void
  share: Pick<ShareActions, 'move' | 'askUnshare' | 'askUnmount'> & {
    folderSharePath: string | null
    addShareOpen: { dir: string } | null
    addLinkPath: string | null
  }
  /** History… focuses the note and then makes sure the rail shows that section. */
  showHistory(): void
  /** A folder was just made: expand to it, scroll to it, make it the tree's context dir (P3). */
  reveal(path: string): void
}

/** Narrowed props for `TreeOpDialog` (ops with their own affordance never open it). */
export interface TreeOpDialogProps {
  mode: 'new-folder' | 'rename' | 'move' | 'delete'
  path: string
  kind: 'dir' | 'text' | 'binary'
}

export interface FileActions {
  /** The op waiting on the dialog, else null. */
  op: TreeOp | null
  readonly dialog: TreeOpDialogProps | null
  /** A request from the tree or a command: dispatched, or parked on the dialog. */
  handle(op: TreeOp): void
  /** The dialog's answer for the parked op. */
  confirm(value: string): Promise<void>
  cancel(): void
  /** Create an auto-named note in `dir` and open it. */
  createNote(dir: string): Promise<void>
  /**
   * Create a collection over `dir` — a `.base` file beside its notes, one
   * table view, named `Collection.base` or the next free number — and open it.
   */
  createCollection(dir: string): Promise<void>
  /**
   * Create the note an unresolved link points at, in the linking note's own
   * folder — matching where the link's author was working, which is what
   * Obsidian's default new-note location does in practice.
   */
  createFromLink(target: string): Promise<void>
  /**
   * Rename a note in place from its inline title (P3): `newName` is the
   * basename WITHOUT the extension, which is kept. Same checks and the same
   * journaled rename as the tree's dialog; a refusal flashes and resolves
   * `null`, so the title can revert. Resolves the new path (or the old one
   * when nothing changed).
   */
  renameNote(path: string, newName: string): Promise<string | null>
}

/** Characters no vault file name may hold on any of the platforms a vault syncs to. */
const ILLEGAL_NAME = /[\\/:*?"<>|\u0000-\u001f]/

/**
 * Why `name` cannot replace the basename of `from`, or null when it can: an
 * illegal character or a leading dot (a hidden file the tree would not show),
 * or another entry in the same folder already called that — compared without
 * case, because two files that differ only in case are one file on macOS and
 * Windows. `from` itself never collides (a case-only rename is allowed).
 */
export function renameRefusal(ws: Workspace, from: string, name: string): string | null {
  const t = getLL().web.tree_op
  if (ILLEGAL_NAME.test(name) || name.startsWith('.') || name !== name.trim()) return t.invalid_name({ name })
  const parent = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : ''
  const to = (parent ? `${parent}/${name}` : name).toLowerCase()
  const taken = ws.ui.files.some((f) => f.path !== from && f.path.toLowerCase() === to)
  return taken ? t.name_taken({ name }) : null
}

export function createFileActions(host: FileHost): FileActions {
  let op = $state<TreeOp | null>(null)

  const dialog = $derived.by((): TreeOpDialogProps | null => {
    if (!op) return null
    switch (op.type) {
      case 'new-folder':
        return { mode: 'new-folder', path: op.dir, kind: 'dir' }
      case 'rename':
      case 'move':
      case 'delete':
        return { mode: op.type, path: op.path, kind: op.kind }
      default:
        return null
    }
  })

  async function createNote(dir: string): Promise<void> {
    const created = await host.workspace()?.createFile(dir)
    if (created) host.open(created)
  }

  async function createCollection(dir: string): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    const taken = new Set(ws.ui.files.map((f) => f.path))
    const name = uniqueName(taken, dir, 'Collection', COLLECTION_EXTENSION)
    const created = await ws.createFile(dir, name, newCollectionText({ folder: dir }))
    if (created) host.open(created)
  }

  async function createFromLink(target: string): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    const clean = target.trim().replace(/^\/+/, '')
    if (!clean) return
    const from = ws.ui.selectedPath ?? ''
    const dir = clean.includes('/')
      ? ''
      : from.includes('/')
        ? from.slice(0, from.lastIndexOf('/'))
        : ''
    const name = clean.endsWith('.md') ? clean : `${clean}.md`
    const created = await ws.createFile(dir, name, `# ${clean.split('/').pop()}\n\n`)
    if (created) host.open(created)
  }

  function handle(next: TreeOp): void {
    if (!host.workspace()) return
    switch (next.type) {
      case 'new-file':
        void createNote(next.dir) // auto-named untitled-N; rename after
        return
      case 'new-collection':
        void createCollection(next.dir)
        return
      case 'share-folder':
        host.share.folderSharePath = next.path
        return
      case 'add-share':
        host.share.addShareOpen = { dir: next.dir }
        return
      case 'add-link':
        host.share.addLinkPath = next.path
        return
      case 'history':
        // The section reads the FOCUSED note, so History… focuses this one
        // and then makes sure the rail is showing that section.
        host.open(next.path)
        host.showHistory()
        return
      case 'unshare':
        host.share.askUnshare(next.path)
        return
      case 'unmount':
        host.share.askUnmount(next.path)
        return
      case 'move-to':
        // Drag-and-drop already resolved the destination; the boundary rules
        // are identical to the Move… dialog's, so both land in one place.
        void host.share.move(next.from, next.to)
        return
      default:
        op = next
    }
  }

  async function confirm(value: string): Promise<void> {
    const current = op
    op = null
    const ws = host.workspace()
    if (!current || !ws) return
    if (current.type === 'new-folder') {
      const path = current.dir ? `${current.dir}/${value}` : value
      await ws.createDir(path)
      // Show what was just made: reveal expands its ancestors, scrolls to it
      // AND focuses it as the tree's context dir, so the next New note lands
      // inside the folder the person was clearly working on (P3).
      host.reveal(path)
    } else if (current.type === 'rename') {
      const parent = current.path.includes('/')
        ? current.path.slice(0, current.path.lastIndexOf('/'))
        : ''
      if (value === current.path.slice(current.path.lastIndexOf('/') + 1)) return
      // Refused before the vault sees it: a rename onto an existing name
      // would replace that file on disk.
      const refusal = renameRefusal(ws, current.path, value)
      if (refusal) {
        ws.flash({ level: 'error', text: refusal, path: current.path })
        return
      }
      await ws.renamePath(current.path, parent ? `${parent}/${value}` : value)
    } else if (current.type === 'move') {
      const base = current.path.slice(current.path.lastIndexOf('/') + 1)
      await host.share.move(current.path, value ? `${value}/${base}` : base)
    } else if (current.type === 'delete') {
      await ws.deletePath(current.path)
    }
  }

  async function renameNote(path: string, newName: string): Promise<string | null> {
    const ws = host.workspace()
    if (!ws) return null
    const slash = path.lastIndexOf('/')
    const base = path.slice(slash + 1)
    const ext = base.toLowerCase().endsWith('.md') ? base.slice(-3) : ''
    const name = newName.trim()
    if (!name) return null
    const next = `${name}${ext}`
    if (next === base) return path
    const refusal = renameRefusal(ws, path, next)
    if (refusal) {
      ws.flash({ level: 'error', text: refusal, path })
      return null
    }
    const to = slash >= 0 ? `${path.slice(0, slash)}/${next}` : next
    await ws.renamePath(path, to)
    // The vault reports a failure itself (a notice); success is the file
    // being at its new path.
    return ws.ui.files.some((f) => f.path === to) ? to : null
  }

  return {
    get op() {
      return op
    },
    set op(next) {
      op = next
    },
    get dialog() {
      return dialog
    },
    handle,
    confirm,
    cancel: () => {
      op = null
    },
    createNote,
    createCollection,
    createFromLink,
    renameNote,
  }
}
