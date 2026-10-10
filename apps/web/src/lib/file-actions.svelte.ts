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
 *
 * Renames follow (collections DB6, bases-shaping A5.1): every rename or move
 * — the tree's dialog, a drop, the inline title, a command — goes through
 * `relocate`, which plans the link rewrites BEFORE the move (the index is
 * about to change under it), asks first when the plan is large, moves, and
 * then edits each referencing note on its own live doc, one `'local'`
 * transaction per note, so peers see it and the sync readout is each
 * note's own. The planner is `@ohhi/index`'s, the same one `ohhi mv` runs.
 */
import { COLLECTION_EXTENSION, newCollectionText } from '@ohhi/collections'
import { uniqueName } from './collection-cells.js'
import { getLL } from '@ohhi/i18n'
import { applyLinkEdits, collectMoveRefs, planLinkRewrites, type LinkRewrite, type MoveRefSource } from '@ohhi/index'
import type { EngineDoc } from '@ohhi/sync'
import type { FileRow } from '@ohhi/workspace'
import type { ShareActions } from './share-actions.svelte.js'
import type { TreeOp } from './tree-model.js'
import type { Workspace } from './workspace.svelte.js'

/** What file operations need from the rest of the shell. */
export interface FileHost {
  /** The open vault, or null between vaults. Read reactively — a getter, not a value. */
  workspace(): Workspace | null
  /** Every "open this note" in the shell goes through one door (Fork 1-B). */
  open(path: string): void
  share: Pick<ShareActions, 'move' | 'askUnshare' | 'askUnmount' | 'afterMove'> & {
    folderSharePath: string | null
    addShareOpen: { dir: string } | null
    addLinkPath: string | null
  }
  /** History… focuses the note and then makes sure the rail shows that section. */
  showHistory(): void
  /** A folder was just made: expand to it, scroll to it, make it the tree's context dir (P3). */
  reveal(path: string): void
  /** The vault index — who links where — for a rename to follow (DB6). Null between vaults. */
  index(): MoveRefSource | null
}

/** The confirm a large link rewrite asks first: what moves, and how many notes it would edit. */
export interface LinksConfirm {
  kind: 'rename' | 'move'
  path: string
  /** The basename, for the wording. */
  name: string
  notes: number
}

/**
 * Above this many referencing notes a rename or move asks first (the same
 * number `ohhi mv` refuses at without `--yes`, and the app's mass-change
 * breaker); at or under it the links just follow.
 */
export const LINK_CONFIRM_THRESHOLD = 20

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
  /** The confirm for a rename or move that would edit more notes than the threshold, else null. */
  readonly linksConfirm: LinksConfirm | null
  /** Go on: move, and update the links. */
  confirmLinks(): void
  /** Nothing moves. */
  cancelLinks(): void
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

/** Every file the vault holds, text and binary — what links resolve over. */
const filePaths = (files: readonly FileRow[]): string[] =>
  files.filter((f) => f.kind === 'text' || f.kind === 'binary').map((f) => f.path)

/** Is anything at `to` now — the moved file, or a moved folder's contents? */
const landed = (ws: Workspace, to: string): boolean =>
  ws.ui.files.some((f) => f.path === to || f.path.startsWith(`${to}/`))

/**
 * One note's edits as one transaction on its live doc, descending offsets so
 * none shifts another. False when the doc's text is not what the plan was
 * made from — the note changed under the index — and then nothing in it is
 * touched: a byte edit at a stale offset would corrupt a link, not fix one.
 */
export function applyLinkEditsToDoc(doc: Pick<EngineDoc, 'getText' | 'transact'>, note: LinkRewrite): boolean {
  if (applyLinkEdits(doc.getText(), note.edits) === null) return false
  doc.transact((t) => {
    for (const e of note.edits) {
      t.delete(e.from, e.to - e.from)
      t.insert(e.from, e.insert)
    }
  }, 'local')
  return true
}

export function createFileActions(host: FileHost): FileActions {
  let op = $state<TreeOp | null>(null)
  let linksConfirm = $state<LinksConfirm | null>(null)
  /** The confirm's answer, awaited by the relocate that asked. */
  let answerLinks: ((go: boolean) => void) | null = null
  /** A move handed to `share.move` whose landing `afterMove` reports — the plan waits here. */
  let pendingMove: { from: string; to: string; plan: LinkRewrite[] } | null = null

  host.share.afterMove = (from, to) => {
    const pending = pendingMove
    pendingMove = null
    const ws = host.workspace()
    if (!ws || !pending || pending.from !== from || pending.to !== to) return
    followPlan(ws, to, pending.plan)
  }

  /** What a move of `from` to `to` would rewrite, from the index as it is now. */
  async function planLinks(ws: Workspace, from: string, to: string): Promise<LinkRewrite[]> {
    const index = host.index()
    if (!index) return []
    const paths = filePaths(ws.ui.files)
    const refs = await collectMoveRefs(index, paths, from)
    return planLinkRewrites(refs, from, to, paths)
  }

  function askLinks(info: LinksConfirm): Promise<boolean> {
    // A second ask while one is up answers the first with "no".
    answerLinks?.(false)
    return new Promise((resolve) => {
      answerLinks = resolve
      linksConfirm = info
    })
  }

  function answer(go: boolean): void {
    const resolve = answerLinks
    answerLinks = null
    linksConfirm = null
    resolve?.(go)
  }

  /** The plan, applied now that the move has landed; a flash says how many notes changed. */
  function followPlan(ws: Workspace, to: string, plan: LinkRewrite[]): void {
    if (plan.length === 0 || !landed(ws, to)) return
    const t = getLL().web.link_follow
    let updated = 0
    const failed: string[] = []
    for (const note of plan) {
      const doc = ws.docForPath(note.path)
      if (doc && applyLinkEditsToDoc(doc, note)) updated++
      else failed.push(note.path)
    }
    if (updated) ws.flash({ level: 'info', text: t.updated({ count: updated }), path: to })
    if (failed.length) {
      ws.flash({ level: 'warn', text: t.not_updated({ count: failed.length }), ...(failed.length === 1 ? { path: failed[0] } : {}) })
    }
  }

  /**
   * A rename (same folder, within the mount) or a move (through the share
   * boundary check), with links following. The plan comes first because the
   * move changes the index it is read from; the ask comes before the move so
   * "no" means nothing happened; the apply waits for the move to have landed.
   */
  async function relocate(from: string, to: string, kind: 'rename' | 'move'): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    const plan = await planLinks(ws, from, to)
    if (plan.length > LINK_CONFIRM_THRESHOLD) {
      const go = await askLinks({ kind, path: from, name: from.slice(from.lastIndexOf('/') + 1), notes: plan.length })
      if (!go) return
    }
    const current = host.workspace()
    if (!current) return
    if (kind === 'rename') {
      await current.renamePath(from, to)
      followPlan(current, to, plan)
    } else {
      pendingMove = { from, to, plan }
      await host.share.move(from, to)
    }
  }

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
        void relocate(next.from, next.to, 'move')
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
      await relocate(current.path, parent ? `${parent}/${value}` : value, 'rename')
    } else if (current.type === 'move') {
      const base = current.path.slice(current.path.lastIndexOf('/') + 1)
      await relocate(current.path, value ? `${value}/${base}` : base, 'move')
    } else if (current.type === 'delete') {
      await ws.deletePath(current.path)
    }
  }

  async function renameNote(path: string, newName: string): Promise<string | null> {
    const ws = host.workspace()
    if (!ws) return null
    const slash = path.lastIndexOf('/')
    const base = path.slice(slash + 1)
    // The extension is kept whatever it is: a collection renamed from its
    // title stays a `.base`, a note stays a `.md`.
    const ext = /\.[^./]+$/.exec(base)?.[0] ?? ''
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
    await relocate(path, to, 'rename')
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
    get linksConfirm() {
      return linksConfirm
    },
    confirmLinks: () => answer(true),
    cancelLinks: () => answer(false),
  }
}
