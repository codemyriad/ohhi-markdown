/**
 * Svelte shim over @ohhi/workspace: the host-neutral orchestration lives in
 * MountSession (libs/workspace — one mount = one vault subtree bound to a
 * room); this module owns only the reactive view state. It builds the $state
 * ui object, injects stable per-guid record factories, mirrors session events
 * into runes, and preserves the public Workspace surface App.svelte renders.
 *
 * Multi-mount (M4): the workspace boots EVERY mount in mounts.json — the root
 * mount over an ignoringAdapter (a live set of mount roots) plus one
 * MountSession per carved/joined mount over a scopedAdapter — and routes all
 * per-path operations through the registry's longest-prefix resolve.
 * carveFolder() runs the spike S8 Q1 state machine: mint (caller-supplied
 * secret via config), statuses in mounts.json, seed → detach → activate, then
 * mounts the new session live. Tokens live in config only (never in descs).
 *
 * Nested mounts, depth 1 (N1, device-link-shaping A2/A3/A5): the root mount
 * may be relay-attached, so a carve or a join inside it ANNOUNCES itself as a
 * `kind:'mount'` entry in the root map, and this shim runs the peer side of
 * that announcement — `reconcileMountEntries` from libs/workspace, wired to
 * the root's live mount-entry hook and to a boot pass. Two derived things
 * follow: the ignore set is `mounts.json ∪ the root map's mount entries`
 * (recomputed, never accumulated), and `ui.mounts` is a projection of
 * mounts.json, so a mount being adopted, waiting for a key, or folded back
 * says so rather than appearing and disappearing.
 */
import { getLL } from '@ohhi/i18n'
import type { DivergenceReview, PreImageJournal, StoreDir, VaultAdapter } from '@ohhi/vault'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  isRecoverable,
  JsonFileLcaStore,
  lcaGuard,
  MountsFile,
  mountRootsFrom,
  scopedAdapter,
  scopedStoreDir,
  type MountDesc,
  type MountProvenance,
  type MountStatus,
} from '@ohhi/vault'
import { createYjsEngine, type EngineDoc } from '@ohhi/sync'
import type { Awareness } from 'y-protocols/awareness'
import { createUndoManager, type CollabUndoManager, type CollabUser } from '@ohhi/editor'
import {
  activateMount,
  bootFlagsFor,
  carveFolder as runCarve,
  resolveRoomRelay,
  roomRelayUrl,
  FOLDER_RECORD_KEY,
  joinMount,
  mountInvariants,
  MountRegistry,
  MountSession,
  reconcileMountEntries,
  recoverMounts,
  unmountMount,
  unshareMount,
  EventLog,
  RelayRefusedError,
  mergeNewestFirst,
  upsertEvent,
  type AdoptContext,
  type AdoptNotice,
  type AppEvent,
  type EventInput,
  type DocInspection,
  type MountInspection,
  type PathInspection,
  type PathPeek,
  type FileRow,
  type MountStats,
  type PreImageInfo,
  type PullProgress,
  type RelayConfig,
  type DocPeer,
} from '@ohhi/workspace'
import {
  defaultRelay,
  getVault,
  upsertVault,
  grantsForBundle,
  operatorSecret,
  purgeRooms,
  roomRelay,
  roomToken,
  roomTokenKind,
  setRoomToken,
} from './config.js'
import { colorFor } from './params.js'
import { byPath as presenceByPathOf, type PresenceByPath } from './presence.js'
import { attachmentCandidates, attachmentType, imageCandidates } from './read.svelte.js'
import { mintShare } from './relay-admin.js'
import { realClock } from './real-clock.js'
import { createSyncRecord, type SyncRecord } from './sync-record.svelte.js'
import { appendFlash, type Flash, type FlashInput, type NoticeInput } from './notices.js'
import { decodeShareLink, encodeDeviceLink, encodeShareLink, type ShareKind } from './share-link.js'
import { isForeignMount } from './share-status.js'
import { createThreadRegistry, writeReviewCopy, type NewComment } from './threads.svelte.js'
import type { CommentRecord, ThreadRecord, ThreadStore } from '@ohhi/workspace'
import type { SuggestionRecord, SuggestionSpan } from '@ohhi/workspace'
import type { ProposeEditInput } from '@ohhi/harness'

export { resolveRoomRelay }
export { FOLDER_RECORD_KEY, type FileRow, type PullProgress, type RelayConfig }

/**
 * The notes in a file list — everything the vault does not hold as a binary.
 * Asked by the live-view derivation, the link candidates, the wikilink
 * resolver and the daily walk, all of which must agree on what a note is.
 */
export function textPaths(files: readonly FileRow[]): string[] {
  return files.filter((f) => f.kind === 'text').map((f) => f.path)
}

/**
 * The index's write side, as the workspace needs it. Structurally
 * `IndexWriter` from @ohhi/index minus `rebuild` — typed here so
 * libs/workspace stays index-agnostic and the app owns the wiring.
 */
export interface IndexSink {
  upsert(doc: { guid: string; path: string; text: string }): void
  remove(guid: string): void
  rename(guid: string, path: string): void
}

export interface WorkspaceConfig {
  adapter: VaultAdapter
  /** The vault's durable store namespace (spike S8 layout; Mem for memory mode). */
  storeDir: StoreDir
  user: string
  /** Root folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /** Bootstrap by pulling the relay room when no durable state exists (see boot.ts). */
  firstJoin?: boolean
  /** Present → connect the ROOT mount to the relay (background, except a firstJoin pull). */
  relay?: RelayConfig
  /** Seed demo notes before enrolling — memory demo / e2e only. */
  seedDemo?: boolean
  /**
   * Kept in step with every text doc in every mount (V2b). Fed from the file
   * list (creates/deletes/renames) and from MountEvents.onDocChanged, which
   * fires for local, remote AND disk-origin edits — so the index sees
   * Obsidian, git and Claude Code writing the same files.
   */
  index?: IndexSink
  /**
   * First-join progress for the ROOT mount, reported BEFORE this promise
   * resolves (device-link N2). `ui.pull` carries the same value, but a linked
   * device spends its whole first minute inside `setupWorkspace` — there is no
   * `ui` to read yet, so the panel is fed through here and told `null` when
   * the boot is done.
   */
  onPull?: (progress: PullProgress | null) => void
  /**
   * Workspace-absolute renames, as the mounts report them. `ui.selectedPath`
   * is followed here; the pane tree follows its own tabs and per-tab
   * histories through this (tab-groups B6/S9-Q4).
   */
  onPathsRenamed?: (moves: { from: string; to: string }[]) => void
}

/** A shared subtree of this workspace, for badges/filter/share management. */
/**
 * UI-facing mount state (device-link N1). 'needs-token' = a mount whose
 * stores exist but this device holds no token: a fully functional LOCAL
 * mount that knows where its room lives — never rendered as "offline"
 * (spike S10 Q2). 'adopting' / 'absorbing' = the peer-side machines running.
 */
export type MountUiStatus = 'active' | 'needs-token' | 'adopting' | 'absorbing'

export interface MountInfo {
  /** Workspace-relative mount root ('' = the whole vault). */
  path: string
  room: string
  provenance: MountProvenance
  link: string | null
  status: MountUiStatus
  /**
   * Someone ELSE's share, mounted here — as opposed to a folder of this vault
   * shared by you (device-link N2, the gap share-status.ts recorded in N1).
   * See `isForeignMount`: a joined mount is always foreign; an adopted one is
   * foreign when its room lives on a relay other than this vault's.
   */
  foreign: boolean
  /**
   * The relay this room lives on — the SAME resolution its session connects
   * with (`roomRelayUrl`): the share sheet lists and revokes links here, the
   * Shared view and the breadcrumb name its host from it.
   */
  relay: string
}

/** Re-exported so the shell can type a History row without reaching past the facade. */
export type { PreImageInfo }
/**
 * `resolveRoomRelay` is re-exported, not defined here.
 *
 * The rule — exact token ▸ the vault's DEVICE token for a room on the vault's
 * OWN relay ▸ nothing — lives in `libs/workspace/src/resolve-relay.ts` so the
 * device-link harness can drive the same function instead of paraphrasing it.
 * It had paraphrased it, with raw `===` on the relay URLs, so a trailing
 * slash made two different answers to the one question that decides who gets
 * a credential. Re-exported here because this module is where the shell's
 * tests reach for it, and because the binding below is what a vault actually
 * uses.
 */

/**
 * A relay refusal on an ADOPTED mount is a MISSING KEY, not a broken relay
 * (A1's second half — device-link N3's residual case).
 *
 * `resolveRoomRelay` can still hand the vault's device token to one kind of
 * mount that will be refused: an adopted share that is somebody ELSE'S but
 * happens to live on this vault's own relay — the case `isForeignMount`
 * documents as its honest limit, since only the relay's ancestry edge knows
 * the difference and the client cannot query it. Without this the mount sits
 * in a permanent error at status `active`: "shared, not syncing", forever,
 * with no action offered. Golden rule 4 forbids exactly that. Degrading to
 * `needs-token` is the honest reading — a fully functional LOCAL mount that
 * knows where its room lives and offers "Add link…" — and one paste fixes it.
 *
 * Only `adopted`: a `joined` or `carved` mount was given its exact token by
 * this device, so a refusal there means the share was revoked or deleted, and
 * "the relay said no" is the true story to leave on screen.
 *
 * Matched on the error's TYPE (`RelayRefusedError`, which
 * `MountSession.reportAuthFailure` raises), with its diagnostic wording as the
 * fallback for an error that crossed a boundary that drops the class.
 */
export function isAuthRefusalForAdoptedMount(
  desc: { provenance: MountProvenance; status: MountStatus } | undefined,
  err: unknown
): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (!(err instanceof RelayRefusedError) && !message.includes('relay rejected this token')) return false
  return !!desc && desc.provenance === 'adopted' && desc.status !== 'needs-token'
}

export interface WorkspaceUi {
  phase: 'connecting' | 'ready'
  /**
   * The vault is not in a settled state right now (M3): still booting, a
   * mount still coming up, or a carve/unshare/unmount/add-link surgery in
   * flight. `ui.files` during any of those is a partial picture — a subtree
   * can be absent between a mount's teardown and the rebuild that puts it
   * back — so anything that DELETES state derived from the file list (the
   * shell's tab prune, above all) must wait for this to go false.
   *
   * It is the same guard the record prune has always applied internally
   * (`ui.phase === 'ready' && mountsBooting === 0`), named and exported,
   * plus the surgeries — which the internal one did not cover because the
   * surgery machines rebuild sessions one at a time.
   */
  settling: boolean
  /**
   * The session's event log, newest first (spike S22, Stage 4a): every notice
   * the shell raises and every mount/relay change it reports, as codes +
   * params on the injected clock — the words come at render time
   * (`event-text.ts`). In memory, capped at 500; the Log view and the drawer
   * read it.
   */
  events: AppEvent[]
  /**
   * Transient gesture feedback, newest first: toasted once by the shell and
   * NOT logged (a refused drop, a copy confirmation). A queue, not a history.
   */
  flashes: Flash[]
  files: FileRow[]
  /** Names online per room, so the shell can say WHICH shared folder someone is in (chrome U4). */
  presenceByRoom: Record<string, string[]>
  /**
   * Who is IN each note (sharing E1): per-doc awareness of every relay-attached
   * doc, the peers whose client says a view holds it (`here`), ourselves
   * excluded. A note nobody is in is absent — so `{}` when you are alone (R6).
   * Read through the pure helpers in `presence.ts`.
   */
  presenceByPath: PresenceByPath
  reviews: DivergenceReview[]
  selectedPath: string | null
  /** Per-doc sync records keyed by doc GUID (+ per-mount folder keys) — guids are rename-stable (M3). */
  records: Record<string, SyncRecord>
  /**
   * True once the ROOT mount has a relay — the whole vault syncs to this
   * person's own devices. It is *device linking*, not sharing (device-link
   * N2, decision 2): the copy reads "Synced to your devices", never "shared",
   * because sharing is what you do with other people, folder by folder
   * (dogfood decision #8 stands). Set by `linkDevice()`, by joining a device
   * link, or by the memory URL contract.
   *
   * Load-bearing beyond the copy: the tree's provenance filter treats
   * everything as relay-backed, and the rollup is fed by every doc.
   */
  linked: boolean
  /**
   * A first join in flight (root mount), else null — the two-phase panel's
   * whole input. Cleared when the boot resolves.
   */
  pull: PullProgress | null
  /** Shared subtrees (carved/joined mounts), excluding the root mount. */
  mounts: MountInfo[]
  /** Held mass-change batch awaiting confirm/dismiss (M3), else null. */
  breaker: { paths: string[] } | null
}

/**
 * The only directories `readAppFile` will read. Both are ignored by the vault
 * adapters, so nothing here is ever enrolled, synced or shown in the tree.
 */
const APP_FILE_DIRS = ['.ohhi/', '.obsidian/'] as const

/**
 * The one directory `writeAppFile` writes: Editor's own. `.obsidian/` is
 * Obsidian's state — read, never written (see `readAppFile`).
 */
const APP_WRITE_DIR = '.ohhi/'

/**
 * One save is temp + rename, i.e. several watcher events; a burst of them is
 * one change to a subscriber (spike-resource-root Q1). On the injected clock.
 */
const APP_FILE_DEBOUNCE_MS = 150

/** Throws unless `path` is under one of `dirs`; returns it vault-relative. */
function appFilePath(path: string, dirs: readonly string[], op: string): string {
  const rel = path.replace(/^\/+/, '')
  if (!dirs.some((dir) => rel.startsWith(dir)) || rel.split('/').includes('..')) {
    throw new Error(`${op} is for ${dirs.join(' / ')} only`)
  }
  return rel
}

export interface Workspace {
  ui: WorkspaceUi
  user: CollabUser
  /**
   * When this session began, on the shell's clock. Events older than this
   * are stored history (a room log merged on mount open): the Log reads
   * them, the toasts and the unread count never do.
   */
  startedAt: number
  /**
   * The relay the ROOT room lives on, resolved as its session resolves it
   * (`roomRelayUrl`) — where its device links are listed and minted.
   */
  rootRelayUrl(): string
  room: string
  /**
   * Log a notice for the session: a `notice` event with a code the shell words
   * at render time (errors and warnings toast once; info never toasts).
   */
  notify(input: NoticeInput): void
  /** Toast gesture feedback without logging it (spike S22: the six gesture sites). */
  flash(input: FlashInput): void
  /** Forget the session's events (the Log view's "Clear"), every room's stored log included. */
  clearEvents(): void
  docForPath(path: string): EngineDoc | null
  awarenessForPath(path: string): Awareness | null
  /**
   * The open-doc refcount (tab-groups B3, spike S9 Q1): the paths that
   * currently have a live CodeMirror view — the active tab of every pane on
   * screen. Diffed per mount and handed to `MountSession.setOpenPaths`, so
   * the LAST view to leave a note is what closes its doc.
   */
  setLiveViews(paths: ReadonlySet<string>): void
  /**
   * The undo manager for a note's doc, minted on first ask and shared by
   * every view of it (tab-groups B2). Owned here rather than by a view, so
   * undo survives a tab switch and two panes on one note share a stack.
   * Null for a path with no doc (a folder, an unknown path).
   */
  undoManagerFor(path: string): CollabUndoManager | null
  // ---- the agent's suggestions (writing-harness B7; `MountSession` does the work) ----
  /**
   * Pin an agent's proposed edit to a note as a pending suggestion. Rejects
   * with `SuggestionConflictError` when the text at `[from, to)` is not
   * `baseText` (the agent read a stale copy), and with an Error when the
   * path has no live doc.
   */
  proposeEdit(input: ProposeEditInput): Promise<SuggestionRecord>
  /** Apply a pending suggestion (`accepted`, or `stale` when its text moved); null when there is none. */
  acceptSuggestion(path: string, id: string): SuggestionRecord | null
  /** Drop a suggestion; the text is never touched. */
  rejectSuggestion(path: string, id: string): boolean
  /** Every suggestion record on a note, newest first. */
  suggestionsFor(path: string): SuggestionRecord[]
  /** The pending and stale suggestions on a note, resolved to offsets now (what the editor draws). */
  suggestionSpans(path: string): SuggestionSpan[]
  /** Called after any change to a note's text or suggestions. */
  subscribeSuggestions(path: string, cb: () => void): () => void
  /**
   * Undo everything agent run `runId` wrote (the newest run accepted this
   * session when absent). Only the agent's items go (spike S14 Q2).
   */
  undoAgent(runId?: string): boolean
  /**
   * Create a note inside `dir` ('' = vault root) and answer with its
   * workspace path. With no `name` the note is auto-named `untitled-N.md`;
   * with one it is created at that path (wikilink create-on-click, daily
   * notes). An existing note at that path is opened, not overwritten.
   *
   * It does NOT open the note: with a pane tree, WHERE a new note opens is
   * the shell's call (tab-groups B5), so the path comes back instead.
   */
  createFile(dir?: string, name?: string, text?: string): Promise<string | null>
  createDir(path: string): Promise<void>
  /** Rename or move a file/folder WITHIN one mount (same shared scope). */
  renamePath(from: string, to: string): Promise<void>
  /**
   * Move across mounts (spike S8 Q5): copy bytes into the target mount with
   * a FRESH guid, then tombstone the source (peers of the source room see a
   * delete). The confirm affordance is the caller's job.
   */
  movePath(from: string, to: string): Promise<void>
  /** Do `from` and `to` live in different mounts (needs the move confirm)? */
  isCrossMount(from: string, to: string): boolean
  deletePath(path: string): Promise<void>
  /**
   * Pre-images the journal holds for a note, newest first (W3). Metadata only
   * — the bytes stay in the journal until `restorePreImage` asks for them.
   */
  fileHistory(path: string): Promise<PreImageInfo[]>
  /**
   * Put one pre-image back. It travels the vault's own write path (CRDT diff →
   * journal → atomic rename), so peers see an edit and the bytes replaced are
   * themselves journaled — never a raw disk write (golden rule 1).
   */
  restorePreImage(path: string, seq: number): Promise<void>
  resolveReview(guid: string, mergedText: string): Promise<void>
  /** Resolve a 'vanished' review: restore from CRDT or confirm the removal. */
  resolveVanished(guid: string, action: 'restore' | 'remove'): Promise<void>
  /** Join a share link as a mount at `destPath` (empty/new folder). */
  addShareMount(link: string, destPath: string): Promise<void>
  /**
   * Paste a share link for an existing `needs-token` mount at `path` (spike
   * S10 Q2): stores the token and activates the mount in place — no re-seed.
   * The link's room must equal the mount's room; otherwise refused with the
   * reason.
   */
  addMountLink(path: string, link: string): Promise<void>
  /** Fold a shared mount back into the vault (files stay, sharing ends). */
  unshare(path: string): Promise<void>
  /** Drop a joined mount; its files stay and become local notes. */
  unmount(path: string): Promise<void>
  /**
   * Link a device (device-link-shaping A1, slice N2): mint a `kind:'device'`
   * token for the ROOT room, attach the root to the relay if it is not
   * already, and return the copyable link — the root token plus the grants
   * this device holds for its mounts (A4-B), so shared folders arrive already
   * connected on the other device.
   *
   * The ONE place the root is promoted. It is not "share this vault": a
   * device link is a full-access credential for one person's own devices, and
   * the copy beside it says so (R5).
   */
  linkDevice(label: string): Promise<string>
  /**
   * Carve `path` (a folder of the root mount) into its own shared mount:
   * mints a token (operator secret from Settings), runs the spike S8 Q1
   * machine, mounts the new session. Returns the copyable share link.
   */
  carveFolder(path: string): Promise<string>
  confirmBreaker(): Promise<void>
  dismissBreaker(): void
  /** Read-only devtools inspection of one file (M6); null for unknown/binary/dir. */
  inspect(path: string): Promise<WorkspaceInspection | null>
  /** Read-only per-mount devtools counts (root mount included). */
  mountStats(): Promise<MountStats[]>
  /**
   * The whole workspace for the inspector (devtools-shaping D4/D5): one entry
   * per live mount, root first, each with its `mounts.json` desc, its counts,
   * every row prefixed back into workspace space, and the LCA records its
   * map no longer names. Read-only; three store reads per mount.
   */
  inspectMounts(): Promise<WorkspaceMountInspection[]>
  /**
   * `mountInvariants()` over this shim's live inputs (devtools-shaping D4):
   * the violations, or an empty list. The checker has always existed for the
   * tests; this is its first caller in the product.
   */
  mountInvariants(): string[]
  /** The three texts behind one file for the inspector's peek (D3); null for unknown/binary/dir. */
  peek(path: string): Promise<PathPeek | null>
  /**
   * Read a file from a configuration directory in the vault: Editor's own
   * `.ohhi/` (custom themes) or Obsidian's `.obsidian/` (daily-notes.json,
   * W3). Deliberately narrow, and read-only: the vault adapters IGNORE both,
   * so they are invisible to enrollment, the tree and sync — but they are
   * still inside the vault, so they travel with the folder. Obsidian's
   * directory especially is *its* state; Editor reads it and never writes it.
   * Returns null when absent.
   */
  readAppFile(path: string): Promise<string | null>
  /**
   * The files directly inside one app directory (`.ohhi/layouts`), as
   * vault-relative paths; `[]` when it is absent or the adapter cannot list
   * ignored directories. Same guard as `readAppFile`.
   */
  listAppDir(dir: string): Promise<string[]>
  /**
   * Write a file under `.ohhi/` (layouts from Settings, quiet-shell F8): the
   * pre-image goes to a journal first, then the adapter's atomic temp+rename
   * write (golden rule 1). Never `.obsidian/`. Listeners of
   * `onAppFileChange` (this tab, and other tabs over a BroadcastChannel)
   * hear about it.
   */
  writeAppFile(path: string, text: string): Promise<void>
  /**
   * Remove a file under `.ohhi/` (Settings › Layout's *Delete*): the same
   * guard and the same pre-image journal as `writeAppFile`, then the
   * adapter's remove; listeners hear about it. Never `.obsidian/`.
   */
  deleteAppFile(path: string): Promise<void>
  /**
   * Subscribe to changes under an app-dir prefix (`.ohhi/layouts/`):
   * the adapter's `watchAppDir` on desktop, in-app writes everywhere,
   * debounced on the injected clock. Never fed into the map, index or CRDT.
   */
  onAppFileChange(prefix: string, cb: (paths: string[]) => void): () => void
  /**
   * The bytes behind `![[name.png]]` (read-shaping B2.3), or null when this
   * device does not hold them — a joined peer holds no binaries until D2f, so
   * "absent" is a normal answer and the editor draws a placeholder for it.
   *
   * `name` is resolved beside `fromPath` first and then at the vault root,
   * Obsidian's own order. It never leaves the vault: a name that is absolute,
   * Windows-shaped or climbs out through `..` is refused before the adapter
   * sees it, because the name comes out of a file a peer or an agent wrote.
   *
   * Binaries live on disk and never in a Y.Text, so this reads the adapter
   * directly — there is no doc to ask.
   */
  readAttachment(
    name: string,
    fromPath?: string | null,
    /** `markdown`: the `src` of `![alt](src)`, a path relative to the note (`imageCandidates`). */
    form?: 'wikilink' | 'markdown'
  ): Promise<Blob | null>
  /**
   * Write a pasted or dropped attachment (editor-usability E5) at `path`, a
   * workspace path the caller placed (`placeAttachment`). Routed to the mount
   * that owns the path, journaled and atomic there, enrolled as a binary —
   * which is NOT synced (D2f), so the caller must not say it was. A taken name
   * moves aside (`name 1.png`) rather than replacing bytes; a path outside the
   * vault or in an app folder is refused. Answers the path actually written,
   * or null (the reason is logged as the session's error).
   */
  writeAttachment(path: string, bytes: Uint8Array): Promise<string | null>
  /** A file's bytes from the mount that owns it, or null (writing-harness B3: the agent's reads). */
  readFileBytes(path: string): Promise<Uint8Array | null>
  /** The pre-image journal of the mount that owns `path` ('' = the root's), read-only use (B3). */
  journalFor(path: string): PreImageJournal | null
  /**
   * Comment threads (writing-harness B8; `threads.svelte.ts`): the note's
   * store, or null when it has no doc. Not AI-gated — comments work with no
   * provider. `reply` is how F appends the agent's answer.
   */
  threadsFor(path: string): ThreadStore | null
  addThread(path: string, input: NewComment): ThreadRecord | null
  reply(path: string, threadId: string, comment: Omit<CommentRecord, 'id' | 'at' | 'author'> & { author?: string }): CommentRecord | null
  resolveThread(path: string, threadId: string, resolved?: boolean): void
  /** Write `<note> (review).md` beside the note with its open threads as CriticMarkup; never the note. */
  exportCriticMarkup(path: string): Promise<{ path: string | null; written: number; skipped: number }>
  dispose(): void
}

/** DocInspection plus which mount owns the path (workspace-level view). */
export interface WorkspaceInspection extends DocInspection {
  mount: { path: string; room: string }
}

/** A `PathInspection` with its path in workspace space. */
export type WorkspacePathInspection = PathInspection

/** One live mount as the inspector sees it: session facts + the desc that boot reads. */
export interface WorkspaceMountInspection extends MountInspection {
  /** Workspace-relative mount root ('' = the root mount). */
  mountPath: string
  /**
   * The `mounts.json` row for this mount, or null when the table has none —
   * which is itself a finding (`mountInvariants` names it too).
   */
  desc: {
    status: MountStatus
    provenance: MountProvenance
    relay: string | null
    neverHeld: boolean
    absorbInto: string | null
  } | null
  rows: WorkspacePathInspection[]
}

function seedDemoFiles(adapter: VaultAdapter): Promise<void[]> {
  const enc = new TextEncoder()
  const welcome = [
    '# Welcome to Editor',
    '',
    'This is the V1 tracer-bullet vault. Everything you type here lands in a',
    'CRDT and syncs through the relay to anyone else in the room.',
    '',
    'Kill the relay and keep typing — the pill goes offline honestly and the',
    'edits exchange on reconnect.',
    '',
  ].join('\n')
  const ideas = [
    '# Ideas',
    '',
    '- wikilinks land in V2',
    '- live preview later, plain markdown first',
    '- the pill never lies',
    '',
  ].join('\n')
  // Fake PNG: magic bytes plus a null byte so looksBinary() flags it even
  // without the extension check.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x42, 0x17, 0x99])
  return Promise.all([
    adapter.writeAtomic('notes/welcome.md', enc.encode(welcome)),
    adapter.writeAtomic('notes/ideas.md', enc.encode(ideas)),
    adapter.writeAtomic('notes/img.png', png),
  ])
}

export async function setupWorkspace(cfg: WorkspaceConfig): Promise<Workspace> {
  const startedAt = realClock.now()
  const ui = $state<WorkspaceUi>({
    phase: 'connecting',
    settling: true,
    events: [],
    flashes: [],
    files: [],
    presenceByRoom: {},
    presenceByPath: {},
    reviews: [],
    selectedPath: null,
    records: {},
    linked: false,
    pull: null,
    mounts: [],
    breaker: null,
  })

  // ---- the event log (spike S22, Stage 4a): one writer path, the injected clock ----
  const eventLog = new EventLog({ clock: realClock })
  /**
   * Each mount's room log (sharing E3), by room then id: loaded from the
   * session on mount open, kept current by `MountEvents.onEvent` (a fold
   * re-reports the same id). `ui.events` is the app log and these, merged
   * newest first. Each map is kept OLDEST FIRST and capped at
   * `EVENT_LOG_CAP` (`upsertEvent`), so a publish is a merge of sorted
   * lists, never a sort per peer keystroke.
   */
  const roomEvents = new Map<string, Map<string, AppEvent>>()
  const publishEvents = (): void => {
    ui.events = mergeNewestFirst([eventLog.oldestFirst(), ...[...roomEvents.values()].map((m) => [...m.values()])])
  }
  const log = (input: EventInput): void => {
    eventLog.append(input)
    publishEvents()
  }
  const notify = (input: NoticeInput): void => {
    const scope = {
      ...(input.room !== undefined ? { room: input.room } : {}),
      ...(input.mount !== undefined ? { mount: input.mount } : {}),
      ...(input.path !== undefined ? { path: input.path } : {}),
    }
    log({
      kind: 'notice',
      level: input.level,
      scope,
      payload: { code: input.code, ...(input.params ? { params: input.params } : {}) },
    })
  }
  const flash = (input: FlashInput): void => {
    ui.flashes = appendFlash(ui.flashes, input)
  }
  const clearEvents = (): void => {
    eventLog.clear()
    // Empty each room's map IN PLACE: every mount's `onEvent` closes over its
    // own map, so a detached one would never publish again.
    for (const byId of roomEvents.values()) byId.clear()
    const sessions = new Set([...registry.all().map((h) => h.session), ...(rootSession ? [rootSession] : [])])
    for (const s of sessions) void s.clearRoomEvents().catch((err) => console.error('[workspace]', err))
    ui.events = []
  }

  const user: CollabUser = { name: cfg.user, color: colorFor(cfg.user) }
  const engine = createYjsEngine()

  if (cfg.seedDemo) await seedDemoFiles(cfg.adapter)

  /** Stable per-key $state record — providers/session mutate it in place. */
  const recordFor = (key: string): SyncRecord => {
    let rec = ui.records[key]
    if (!rec) {
      rec = createSyncRecord()
      ui.records[key] = rec
    }
    return rec
  }

  const registry = new MountRegistry()
  /** Agent runs whose suggestions were accepted this session, newest last (`undoAgent()`'s default). */
  let agentRuns: string[] = []
  const appFiles = createAppFiles(cfg.adapter, cfg.storeDir, cfg.room)
  /**
   * The root mount. Declared here, before anything derived from it: the ignore
   * set reads the root's map on every refresh, and the FIRST refresh happens
   * during boot, before the session exists.
   */
  let rootSession: MountSession | null = null
  /** Sessions currently booting before their registry.add (pruning guard). */
  let mountsBooting = 0
  /** Mount surgeries in flight (carve/unshare/unmount/add-link) — see `ui.settling`. */
  let surgeries = 0

  /** `ui.settling` is derived, never set: one rule, three inputs (M3). */
  const refreshSettling = (): void => {
    ui.settling = ui.phase !== 'ready' || mountsBooting > 0 || surgeries > 0
  }

  /**
   * Bracket one mount surgery. Everything inside it can leave `ui.files`
   * describing a vault that is half-taken-apart, and the shell must not act
   * destructively on that picture (M3).
   */
  const duringSurgery = async <T>(run: () => Promise<T>): Promise<T> => {
    surgeries++
    refreshSettling()
    try {
      return await run()
    } finally {
      surgeries--
      refreshSettling()
    }
  }

  /**
   * Live mount roots the root adapter must ignore. Derived, never accumulated:
   * `mounts.json ∪ the root map's kind:'mount' entries` (spike S10 Q6). Both
   * terms are load-bearing and in opposite directions — the map term covers
   * the window between a peer's carve landing and this device writing a desc
   * (which is exactly when a boot delta scan would re-enrol the subtree), the
   * desc term covers the mirror-image window in an absorb. MUTATED IN PLACE,
   * never reassigned: ignoringAdapter closes over this object and consults it
   * on every call, including inside the watch callback.
   */
  const ignoreSet = new Set<string>()
  /** Copyable link per room, kept across mount-list rebuilds. */
  const linkByRoom = new Map<string, string>()
  /** Which session owns a review's doc (resolveReview routing). */
  const reviewOwner = new Map<string, MountSession>()
  /** Which session raised the held breaker batch. */
  let breakerOwner: MountSession | null = null
  /** Per-room presence, published as ui.presenceByRoom. */
  const presenceByRoom = new Map<string, string[]>()
  /** Per-doc presence by guid (rename-stable), mapped to paths through the rows. */
  const docPresence = new Map<string, DocPeer[]>()
  const refreshPresenceByPath = (): void => {
    if (docPresence.size === 0 && Object.keys(ui.presenceByPath).length === 0) return
    ui.presenceByPath = presenceByPathOf(docPresence, ui.files)
  }

  /**
   * The ROOT mount's relay. Mutable because `linkDevice()` attaches one to a
   * vault that booted without: `rebuildRoot` (unshare/absorb surgery) reads
   * this, and a root that quietly lost its relay would stop announcing carves
   * and stop hearing peers — sync state lying by omission (N1's rule, N2's
   * new way of reaching it).
   */
  let rootRelay: RelayConfig | undefined = cfg.relay

  const mountsFile = new MountsFile(cfg.storeDir.io('mounts.json'))
  await recoverMounts(cfg.storeDir, mountsFile, engine)

  /** mounts.json as this shim last read it (the ignore set's first term). */
  let descs: MountDesc[] = await mountsFile.load()

  /** A desc's lifecycle status, as the tree and rail say it (N1). */
  const uiStatus = (status: MountStatus): MountUiStatus => {
    if (status === 'needs-token') return 'needs-token'
    if (status === 'active') return 'active'
    if (status === 'absorbing' || status.startsWith('unsharing:')) return 'absorbing'
    return 'adopting' // carving:* / joining / adopting:* — a mount being made
  }

  const refreshIgnore = (): void => {
    const next = mountRootsFrom(descs, rootSession?.mapEntries() ?? [])
    ignoreSet.clear()
    for (const p of next) ignoreSet.add(p)
  }

  /**
   * This vault's own relay — the one its rooms are minted on. A mount whose
   * room lives somewhere else is somebody else's share (see isForeignMount).
   */
  const rootRelayUrl = (): string => roomRelayUrl(rootRelay?.url, roomRelay(cfg.room), defaultRelay())
  /** Where a mount's room lives: the one resolution (`roomRelayUrl`) its session uses too. */
  const mountRelayUrl = (m: { room: string; relay?: string }): string =>
    roomRelayUrl(m.relay, roomRelay(m.room), defaultRelay())

  /** ui.mounts is a projection of mounts.json — statuses included. */
  const refreshMounts = (): void => {
    const rootRelay = rootRelayUrl()
    ui.mounts = descs
      .filter((d) => d.path !== '')
      .map((d) => {
        const relay = mountRelayUrl({ room: d.room, ...(d.relay?.url ? { relay: d.relay.url } : {}) })
        return {
          path: d.path,
          room: d.room,
          provenance: d.provenance,
          link: linkByRoom.get(d.room) ?? null,
          status: uiStatus(d.status),
          // A room with no recorded relay is not "elsewhere": judged on what
          // was recorded, never on the default the session falls back to.
          foreign: isForeignMount({ provenance: d.provenance, relay: d.relay?.url || roomRelay(d.room) }, rootRelay),
          relay,
        }
      })
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Re-read the mount table after any lifecycle write, then re-derive. */
  const reloadMounts = async (): Promise<void> => {
    descs = await mountsFile.load()
    refreshIgnore()
    refreshMounts()
  }

  /** guid → path, as the index last saw it. Drives the create/delete/rename diff. */
  const indexed = new Map<string, string>()

  /**
   * Reconcile the index's document set with the tree.
   *
   * Text is read from the doc (in-memory Y.Text), never from disk: every
   * enrolled text file has a live doc for the whole session, so this costs no
   * I/O. Directories and binaries have no doc and are deliberately absent.
   */
  const syncIndexRows = (rows: FileRow[]): void => {
    const sink = cfg.index
    if (!sink) return
    const live = new Map<string, string>()
    for (const row of rows) {
      if (row.kind !== 'text') continue
      live.set(row.guid, row.path)
      const was = indexed.get(row.guid)
      if (was === row.path) continue
      if (was === undefined) {
        const doc = resolveDoc(row.path)
        // A row can appear before its doc instance exists — a carve or an
        // unshare destroys and rebuilds every doc in a mount, and refreshTree
        // can run in between. Skip it rather than indexing empty text and
        // recording it as done: the next refresh (or the doc's first change)
        // picks it up with real content.
        if (!doc) continue
        sink.upsert({ guid: row.guid, path: row.path, text: doc.getText() })
      } else {
        // Same guid, new path: a rename. Keep the derived text, move the path
        // — re-deriving would drop nothing but cost a full re-tokenize.
        sink.rename(row.guid, row.path)
      }
      indexed.set(row.guid, row.path)
    }
    for (const guid of [...indexed.keys()]) {
      if (live.has(guid)) continue
      sink.remove(guid)
      indexed.delete(guid)
    }
  }

  const resolveDoc = (path: string): EngineDoc | null => {
    const r = registry.resolve(path)
    return r ? r.session.docForPath(r.rel) : null
  }

  const refreshTree = (): void => {
    const rows = registry.files()
    // A mount root with no children is invisible in the merged rows (its own
    // map is subtree-relative) — synthesize its dir row so the tree always
    // shows the shared folder.
    for (const info of ui.mounts) {
      if (!rows.some((r) => r.path === info.path)) {
        // 'mount', not 'dir' (N1): inside a relay-attached root this row comes
        // from the parent map as a mount entry, and a mount root should not
        // change kind depending on whether the vault happens to be shared.
        rows.push({ path: info.path, guid: `mount:${info.room}`, kind: 'mount' })
      }
    }
    rows.sort((a, b) => a.path.localeCompare(b.path))
    ui.files = rows
    // A rename moves a peer with their note: presence is guid-keyed.
    refreshPresenceByPath()
    syncIndexRows(rows)
    // Records exist for every text row before the tree renders pills for them.
    for (const row of rows) if (row.kind === 'text') recordFor(row.guid)
    // Prune records for guids that no longer exist (deletes) so the global
    // rollup never aggregates a dead file's stale status. NEVER while any
    // session boots outside the registry (initial boot, a carve's new mount):
    // pruning then orphans record objects its providers already captured.
    // Nor during a surgery: a join's session has finished booting but is not
    // in the registry yet, so its docs look dead here — pruning them left the
    // providers writing to orphaned records and every pill in a freshly
    // joined folder reading "offline" while it synced (golden rule 4).
    if (ui.phase === 'ready' && mountsBooting === 0 && surgeries === 0) {
      const live = new Set(rows.map((r) => r.guid))
      // Folder records live per room; prune the ones for dead rooms too (an
      // unshared mount's stale offline record would pin the global pill).
      const liveRooms = new Set([cfg.room, ...ui.mounts.map((m) => m.room)])
      for (const key of Object.keys(ui.records)) {
        if (key.startsWith('//folder')) {
          const room = key.slice('//folder:'.length)
          if (key !== FOLDER_RECORD_KEY && !liveRooms.has(room)) delete ui.records[key]
        } else if (!live.has(key)) {
          delete ui.records[key]
        }
      }
    }
  }

  const refreshPresence = (): void => {
    ui.presenceByRoom = Object.fromEntries(
      [...presenceByRoom.entries()].map(([room, list]) => [room, [...list].sort()])
    )
  }

  interface MountOpts {
    room: string
    path: string
    provenance: MountProvenance
    relay?: RelayConfig
    firstJoin?: boolean
    /**
     * Boot with an empty map and no delta scan: a mount this device has never
     * held and has no key for. Its files stay on disk, untouched and
     * unmanaged, until a paste turns it into a firstJoin (spike S10 Q2 + N3).
     */
    neverHeld?: boolean
    /** Progress for a pull a person is waiting on (the paste). */
    onPullProgress?: (progress: PullProgress) => void
    onShared?: (link: string) => void
  }

  /** Each mount's pre-image journal, by room (`journalFor`, writing-harness B3). */
  const journals = new Map<string, PreImageJournal>()
  const buildMount = async (opts: MountOpts): Promise<MountSession> => {
    mountsBooting++
    refreshSettling()
    try {
      return await buildMountInner(opts)
    } finally {
      mountsBooting--
      refreshSettling()
    }
  }

  const buildMountInner = (opts: MountOpts): Promise<MountSession> => {
    const mountDir = scopedStoreDir(cfg.storeDir, `${opts.room}/`)
    const docStore = new BlobDocStore(engine, mountDir, realClock)
    const lcaStore = lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json')))
    const journal = new FileJournal(mountDir, { now: () => realClock.now() })
    journals.set(opts.room, journal)
    const adapter =
      opts.path === ''
        ? ignoringAdapter(cfg.adapter, ignoreSet)
        : scopedAdapter(cfg.adapter, opts.path)
    const prefixMoves = (moves: { from: string; to: string }[]) =>
      opts.path === '' ? moves : moves.map((m) => ({ from: `${opts.path}/${m.from}`, to: `${opts.path}/${m.to}` }))
    // This room's log (sharing E3): what the session reports as it happens,
    // replaced by id (a fold re-reports its id)…
    const roomLog = new Map<string, AppEvent>()
    roomEvents.set(opts.room, roomLog)
    const session = MountSession.create({
      engine,
      adapter,
      user,
      room: opts.room,
      eventsIo: mountDir.io('events.json'),
      firstJoin: opts.firstJoin,
      neverHeld: opts.neverHeld,
      relay: opts.relay,
      clock: realClock,
      lcaStore,
      journal,
      docStore,
      mountsFile,
      mountPath: opts.path,
      provenance: opts.provenance,
      // Folder records are per mount; every other key is a globally unique guid.
      recordFor: (key) => recordFor(key === FOLDER_RECORD_KEY ? `//folder:${opts.room}` : key),
      makeShareLink: (relay, room) => encodeShareLink({ relay: relay.url, room, token: relay.token }),
      events: {
        onFiles: () => refreshTree(),
        onDocChanged: (guid, path) => {
          if (!cfg.index) return
          const full = opts.path === '' ? path : `${opts.path}/${path}`
          const doc = resolveDoc(full)
          if (!doc) return
          cfg.index.upsert({ guid, path: full, text: doc.getText() })
          indexed.set(guid, full)
        },
        onPathsRenamed: (moves) => {
          const full = prefixMoves(moves)
          for (const { from, to } of full) {
            if (ui.selectedPath === from) ui.selectedPath = to
          }
          cfg.onPathsRenamed?.(full)
        },
        onBreaker: (paths) => {
          breakerOwner = sessionOf(opts.room)
          ui.breaker = {
            paths: opts.path === '' ? paths : paths.map((p) => `${opts.path}/${p}`),
          }
        },
        onPresence: (names) => {
          presenceByRoom.set(opts.room, names)
          refreshPresence()
        },
        onDocPresence: (guid, peers) => {
          if (peers.length === 0 && !docPresence.has(guid)) return
          if (peers.length === 0) docPresence.delete(guid)
          else docPresence.set(guid, peers)
          refreshPresenceByPath()
        },
        onReview: (review) => {
          const owner = sessionOf(opts.room)
          if (owner) reviewOwner.set(review.guid, owner)
          ui.reviews = [...ui.reviews.filter((r) => r.guid !== review.guid), review]
        },
        onReviewCleared: (guid) => {
          reviewOwner.delete(guid)
          ui.reviews = ui.reviews.filter((r) => r.guid !== guid)
        },
        onShared: (link) => opts.onShared?.(link),
        // A nested mount's own pull, when someone is waiting on it (the paste
        // — `activateMount`). The root's own line below wins for the root.
        ...(opts.onPullProgress ? { onPullProgress: opts.onPullProgress } : {}),
        ...(opts.path === ''
          ? {
              // The two-phase first-join line (N2). Root only: this is the
              // whole-vault pull the joiner stares at, and it is reported
              // BEFORE setupWorkspace resolves — hence the config callback
              // alongside the ui field. A nested mount's own pull gets its own
              // line later (spike S10 Q4, acceptance note on Q1 step 6).
              onPullProgress: (progress) => {
                ui.pull = progress
                cfg.onPull?.(progress)
              },
              // Synchronous, inside the observer: the derived ignore set must
              // hide a mount root the instant a peer announces it, not at the
              // end of the adopt (spike S10 Q6).
              onMapChanged: () => refreshIgnore(),
              // The adopt machine's LIVE entry point. The session queues this
              // on its map-work chain AHEAD of its own map scan, and awaits
              // the promise — so no scan adopts the guids an adopt is moving.
              onMountEntries: () => (adoptReady ? runReconcile() : undefined),
            }
          : {}),
        onEvent: (event) => {
          upsertEvent(roomLog, event)
          publishEvents()
        },
        onError: (err) => {
          console.error('[workspace]', err)
          // The room is in hand here: the event says WHICH shared folder (S22 Q1).
          const scope = { room: opts.room, mount: opts.path, ...(opts.path ? { path: opts.path } : {}) }
          // A refusal is already in the room's log: the session wrote
          // `relay.state refused` with the reason (`onEvent` above).
          if (!(err instanceof RelayRefusedError)) {
            notify({
              level: 'error',
              code: 'mount_error',
              params: { message: err instanceof Error ? err.message : String(err) },
              ...scope,
            })
          }
          // A relay refusal on an adopted mount is a missing key: degrade the
          // mount honestly instead of leaving it 'active' and permanently
          // broken (A1's second half — see degradeOnAuthRefusal).
          degradeOnAuthRefusal(opts.room, err)
        },
      },
    })
    // …and, once open, the stored history the session loaded before booting.
    return session.then((s) => {
      const stored = s.roomEvents().filter((e) => !roomLog.has(e.id))
      if (stored.length > 0) {
        // Stored history predates what arrived live: rebuild oldest first, once.
        const all = [...stored, ...roomLog.values()].sort((a, b) => a.at - b.at)
        roomLog.clear()
        for (const e of all) upsertEvent(roomLog, e)
      }
      if (roomEvents.get(opts.room) === roomLog) publishEvents()
      return s
    })
  }

  const sessionOf = (room: string): MountSession | null =>
    registry.all().find((h) => h.session.room === room)?.session ??
    (rootSession?.room === room ? rootSession : null)

  // ---- the peer-side adopt / absorb machine (N1) ----

  /** False until the first boot finishes: the machine needs a live root. */
  let adoptReady = false

  /**
   * Every adopt outcome is a `mount.changed` event carrying its room (S22 Q1).
   * The ones a person must act on or would not otherwise notice warn; the
   * rest — including the four that used to be dropped because "the tree says
   * it" (adopted, absorbed, adopt-cancelled, ghosts-held) — are logged at
   * info, which never toasts.
   */
  const ADOPT_LEVEL: Record<AdoptNotice['kind'], 'warn' | 'info'> = {
    'needs-token': 'warn',
    'depth-limit': 'warn',
    'room-repointed': 'warn',
    'mount-moved': 'info',
    adopted: 'info',
    absorbed: 'info',
    'adopt-cancelled': 'info',
    'ghosts-held': 'info',
  }
  const adoptNotice = (n: AdoptNotice): void => {
    log({
      kind: 'mount.changed',
      level: ADOPT_LEVEL[n.kind],
      scope: { room: n.room, mount: n.path, path: n.path },
      payload: { what: n.kind },
    })
  }

  const adoptContext = (): AdoptContext => ({
    vaultDir: cfg.storeDir,
    mountsFile,
    engine,
    root: () => rootSession!,
    rootRoom: cfg.room,
    mounts: () =>
      new Map(
        registry
          .all()
          .filter((h) => h.mountPath !== '')
          .map((h) => [h.mountPath, h.session])
      ),
    relayFor: relayForRoom,
    buildSession: (o) =>
      buildMount({
        room: o.room,
        path: o.path,
        provenance: o.provenance,
        ...(o.relay ? { relay: o.relay } : {}),
        ...(o.firstJoin ? { firstJoin: true } : {}),
        ...(o.neverHeld ? { neverHeld: true } : {}),
        ...(o.onPullProgress ? { onPullProgress: o.onPullProgress } : {}),
        onShared: (link) => {
          linkByRoom.set(o.room, link)
          refreshMounts()
        },
      }),
    attachMount: (path, session) => {
      registry.add(path, session)
      refreshTree()
    },
    detachMount: (path) => {
      const resolved = registry.resolve(path)
      const session = resolved?.mountPath === path ? resolved.session : null
      registry.remove(path)
      return session
    },
    withRootDown: async (fn) => {
      registry.remove('')
      await rootSession!.shutdown()
      await fn()
      await rebuildRoot()
    },
    refreshIgnore: reloadMounts,
    notify: adoptNotice,
  })

  /** One pass at a time: the live hook and the boot pass share this chain. */
  let adoptWork: Promise<void> = Promise.resolve()
  const runReconcile = (): Promise<void> => {
    adoptWork = adoptWork
      .then(() => reconcileMountEntries(adoptContext()))
      .then(() => reloadMounts())
      .then(() => refreshTree())
      .catch((err) => {
        console.error('[workspace] mount reconcile', err)
        notify({ level: 'error', code: 'adopt_failed', params: { message: err instanceof Error ? err.message : String(err) } })
      })
    return adoptWork
  }

  // ---- boot every mount from mounts.json ----

  /** `resolveRoomRelay` bound to this vault's config (see the rule above it). */
  const relayForRoom = (m: {
    room: string
    relay?: string
    provenance: MountProvenance
  }): RelayConfig | null =>
    resolveRoomRelay({
      url: mountRelayUrl(m),
      provenance: m.provenance,
      exactToken: roomToken(m.room),
      rootToken: roomToken(cfg.room),
      rootTokenKind: roomTokenKind(cfg.room),
      rootRelayUrl: rootRelayUrl(),
    })

  /** `isAuthRefusalForAdoptedMount` + the status write it implies (A1). */
  const degradeOnAuthRefusal = (room: string, err: unknown): void => {
    if (!isAuthRefusalForAdoptedMount(descs.find((d) => d.room === room), err)) return
    void mountsFile
      .setStatus(room, 'needs-token')
      .then(() => reloadMounts())
      .then(() => refreshTree())
      .catch((e) => console.error('[workspace]', e))
  }

  refreshIgnore()
  rootSession = await buildMount({
    room: cfg.room,
    path: '',
    provenance: 'local',
    relay: rootRelay,
    firstJoin: cfg.firstJoin,
    onShared: () => (ui.linked = true),
  })
  registry.add('', rootSession)
  refreshIgnore()

  for (const desc of descs) {
    // Settled mounts only: an interrupted one was already rolled back or
    // forward by recoverMounts, and a duplicate path is a re-point that
    // crashed mid-swap — the map names the winner, so leave the other alone
    // (the boot pass below resolves it).
    if (desc.path === '' || isRecoverable(desc.status)) continue
    if (registry.resolve(desc.path)?.mountPath === desc.path) continue
    const relay = desc.relay
      ? relayForRoom({ room: desc.room, relay: desc.relay.url, provenance: desc.provenance })
      : null
    if (!relay && desc.provenance !== 'local') {
      // No credential — because none is held, or because nothing anywhere
      // says where the room lives. Both are the same state to a person and
      // the same action fixes them: paste the link, which carries the relay
      // URL as well as the token.
      //
      // Statusing only the `desc.relay && !relay` half left the other one
      // sitting at `active` with no relay: the tree drew it as a shared
      // folder and `mountHasRelay` counted it into the sync rollup, which
      // then reported the whole vault offline because a mount that can never
      // connect never does. Sync state that lies (golden rule 4).
      if (desc.status !== 'needs-token') await mountsFile.setStatus(desc.room, 'needs-token')
      notify({
        level: 'warn',
        code: 'no_token',
        params: { path: desc.path },
        path: desc.path,
        room: desc.room,
        mount: desc.path,
      })
    }
    const session = await buildMount({
      room: desc.room,
      path: desc.path,
      provenance: desc.provenance,
      ...(relay ? { relay } : {}),
      // Never held: PULL with a credential, wait empty without one — derived
      // together, because the third combination (neither flag) drops an
      // adopted mount into the fresh-vault enrol and mints new guids for the
      // room's own files (N3's empty-adopt finding).
      ...bootFlagsFor(desc, relay),
      onShared: (link) => {
        linkByRoom.set(desc.room, link)
        refreshMounts()
      },
    })
    registry.add(desc.path, session)
  }
  await reloadMounts()

  // The adopt machine's BOOT pass (spike S10 Q1, entry point 2): after
  // recoverMounts and after the root has restored its folder blob, join the
  // root map's mount entries against mounts.json. This is what gives a device
  // that was closed during a peer's carve its trigger on reopen — and what
  // turns an `adopting:seeding` rollback into a retry rather than a subtree
  // stranded in the wrong namespace.
  adoptReady = true
  await runReconcile()

  ui.phase = 'ready'
  refreshSettling()
  ui.pull = null
  cfg.onPull?.(null)
  refreshTree()

  // The open-doc refcount lives HERE (spike S9 Q1): the pane model stays pure
  // and knows nothing about docs, `MountSession` stays per-mount and knows
  // nothing about panes, and this shim is the only thing that sees both.

  /** Workspace paths with a live view right now. */
  let liveViews: ReadonlySet<string> = new Set<string>()
  /** What each session was last told to hold open (which mounts to un-tell). */
  let liveByMount = new Map<MountSession, Set<string>>()
  const NO_RELS: ReadonlySet<string> = new Set<string>()

  const setLiveViews = (paths: ReadonlySet<string>): void => {
    const next = new Map<MountSession, Set<string>>()
    for (const path of paths) {
      const resolved = registry.resolve(path)
      if (!resolved) continue // no mount owns it: nothing to hold open
      const rels = next.get(resolved.session)
      if (rels) rels.add(resolved.rel)
      else next.set(resolved.session, new Set([resolved.rel]))
    }
    const mounted = new Set(registry.all().map((h) => h.session))
    for (const session of liveByMount.keys()) {
      // The empty set is not a no-op: it is what runs the last view's
      // reconcileClosedDoc (S9 Q2). A session already OUT of the registry is
      // being torn down and must not be spoken to again.
      if (!next.has(session) && mounted.has(session)) session.setOpenPaths(NO_RELS)
    }
    for (const [session, rels] of next) session.setOpenPaths(rels)
    liveByMount = next
    liveViews = new Set(paths)
  }

  /**
   * Re-tell every mount which of its files a view holds, adding back the paths
   * a surgery released (`dropLiveViewsUnder`'s return).
   *
   * Two things are going on and both are load-bearing (C1):
   *
   *  - the unshare/unmount/activate machines REPLACE session objects, and a
   *    fresh MountSession's open set is empty, so every mount has to be told
   *    again — hence clearing `liveByMount` rather than diffing against it;
   *  - the views released before the surgery are still on screen. They were
   *    taken out of `liveViews` so the doomed session would close their docs
   *    cleanly, and putting them back is what re-marks them on the session
   *    that now owns them. Replaying `liveViews` alone re-opens everything
   *    EXCEPT the subtree the surgery was about — which is the one place a
   *    pane is left rendering a buffer the reconciler believes is closed.
   */
  const reapplyLiveViews = (held: readonly string[] = []): void => {
    liveByMount = new Map()
    setLiveViews(new Set([...liveViews, ...held]))
  }

  /**
   * One Y.UndoManager per doc guid (tab-groups B2). Keyed by GUID, not path,
   * so a rename keeps the stack and two panes on one note share it.
   */
  const undoManagers = new Map<string, CollabUndoManager>()

  const undoManagerFor = (path: string): CollabUndoManager | null => {
    const resolved = registry.resolve(path)
    const doc = resolved ? resolved.session.docForPath(resolved.rel) : null
    if (!doc) return null
    let manager = undoManagers.get(doc.guid)
    if (!manager) {
      manager = createUndoManager(doc)
      undoManagers.set(doc.guid, manager)
    }
    return manager
  }

  /** Drop the managers for a subtree whose doc instances are about to die. */
  const releaseUndoManagersUnder = (prefix: string): void => {
    for (const row of ui.files) {
      if (row.path !== prefix && !row.path.startsWith(`${prefix}/`)) continue
      undoManagers.get(row.guid)?.destroy()
      undoManagers.delete(row.guid)
    }
  }

  /**
   * Release every live view at or under `prefix` (and the selection with it),
   * and drop the undo stacks that go with them. The carve/unshare/unmount/
   * cross-move machines DESTROY the doc instances underneath, so the views
   * must let go first — the last one out is what cancels the pending flush
   * debounce and closes the doc (spike S9 Q3). Returns the paths released, so
   * a caller that means to re-open them after the surgery can.
   */
  const dropLiveViewsUnder = (prefix: string): string[] => {
    const under = (p: string): boolean => p === prefix || p.startsWith(`${prefix}/`)
    const held = [...liveViews].filter(under)
    if (held.length > 0) setLiveViews(new Set([...liveViews].filter((p) => !under(p))))
    if (ui.selectedPath && under(ui.selectedPath)) ui.selectedPath = null
    releaseUndoManagersUnder(prefix)
    return held
  }

  const doCarve = async (path: string): Promise<string> => {
    const t = getLL().web.workspace
    const row = ui.files.find((f) => f.path === path)
    // A mount root is already its own share — sharing it again would be a
    // mount inside a mount, which depth 1 forbids.
    if (row?.kind === 'mount') throw new Error(t.overlaps())
    if (!row || row.kind !== 'dir') throw new Error(t.only_folders())
    const resolved = registry.resolve(path)
    if (!resolved || resolved.mountPath !== '') {
      throw new Error(t.inside_shared())
    }
    for (const m of ui.mounts) {
      if (m.path === path || m.path.startsWith(`${path}/`) || path.startsWith(`${m.path}/`)) {
        throw new Error(t.overlaps())
      }
    }
    // ui.mounts is what THIS device runs; the root map is what everyone
    // agreed. A folder another peer carved seconds ago is a mount entry here
    // before it is a desc, and carving into it would make a mount inside a
    // mount on every device (spike S10 Q5 row 11's prevention-at-the-source).
    for (const entry of rootSession!.mountEntries()) {
      if (
        entry.path === path ||
        entry.path.startsWith(`${path}/`) ||
        path.startsWith(`${entry.path}/`)
      ) {
        throw new Error(t.overlaps())
      }
    }
    const secret = operatorSecret()
    if (!secret) {
      throw new Error(t.needs_secret())
    }
    const relayUrl = defaultRelay()
    const room = crypto.randomUUID()
    const vaultName = getVault(cfg.room)?.name ?? 'vault'
    // Mint FIRST: a mint failure aborts with nothing persisted anywhere.
    const minted = await mintShare(relayUrl, secret, {
      folderGuid: room,
      label: `${vaultName}/${path}`,
      // Ancestry, ALWAYS — not only when this vault is relay-attached
      // (spike S10 Q3). The edge is advisory structure, not a credential, and
      // recording it now is what lets a device linked LATER connect to a
      // folder carved EARLIER without a paste.
      parent: cfg.room,
    })
    setRoomToken(room, minted.token, relayUrl, 'folder')

    // The carve destroys the root's doc instances for the subtree — release
    // every view holding one, and re-open them through the new mount after.
    const reselect =
      ui.selectedPath && (ui.selectedPath === path || ui.selectedPath.startsWith(`${path}/`))
        ? ui.selectedPath
        : null
    const held = dropLiveViewsUnder(path)

    await runCarve({
      root: rootSession!,
      vaultDir: cfg.storeDir,
      mountsFile,
      mountPath: path,
      room,
      relayUrl,
      addIgnore: (prefix) => ignoreSet.add(prefix),
    })

    await reloadMounts()
    const session = await buildMount({
      room,
      path,
      provenance: 'carved',
      relay: { url: relayUrl, token: minted.token },
      onShared: (link) => {
        linkByRoom.set(room, link)
        refreshMounts()
      },
    })
    registry.add(path, session)
    await reloadMounts()
    refreshTree()
    reapplyLiveViews(held) // the subtree's docs live in the NEW mount now
    if (reselect) ui.selectedPath = reselect
    return session.shareLink() ?? encodeShareLink({ relay: relayUrl, room, token: minted.token })
  }

  /**
   * Above this many held tokens the bundle stops being a link and starts
   * being a payload (spike S10 Q7 §Size): emit the device link WITHOUT
   * grants and say so — the ancestry grant (A4-A) covers this vault's own
   * carves anyway, and a foreign share costs one paste.
   */
  const MAX_BUNDLED_GRANTS = 50

  /**
   * Link a device (A1 + A4-B). Mint a DEVICE token for the root room, promote
   * the root to relay-attached if it is not already — the one place that
   * happens — remember the credential, and hand back the link with the grants
   * this device holds. R5 lives in the copy beside the link, not here.
   */
  const doLinkDevice = async (label: string): Promise<string> => {
    const t = getLL().web.workspace
    const secret = operatorSecret()
    if (!secret) throw new Error(t.needs_secret())
    const relayUrl = rootRelayUrl()
    const vaultName = getVault(cfg.room)?.name ?? 'vault'
    // Mint FIRST: a failure leaves nothing promoted and nothing persisted.
    const minted = await mintShare(relayUrl, secret, {
      folderGuid: cfg.room,
      kind: 'device',
      label: label.trim() || vaultName,
    })
    setRoomToken(cfg.room, minted.token, relayUrl, 'device')
    const relay: RelayConfig = { url: relayUrl, token: minted.token }
    rootRelay = relay
    if (!rootSession!.isShared()) {
      rootSession!.enableSharing(relay)
      ui.linked = true
    }
    // The next boot reads the root's relay off the VAULT ENTRY (boot.ts), not
    // off mounts.json — without this the link works for one session and the
    // vault reopens unlinked.
    const entry = getVault(cfg.room)
    if (entry) upsertVault({ ...entry, relay })
    refreshMounts()
    // The codec drops a grant for the link's own room, so the root token is
    // never doubled; a device that holds too many is told, never truncated.
    const held = grantsForBundle().filter((g) => g.room !== cfg.room)
    const tooMany = held.length > MAX_BUNDLED_GRANTS
    if (tooMany) {
      notify({ level: 'warn', code: 'too_many_grants', params: { count: held.length }, room: cfg.room })
    }
    return encodeDeviceLink({
      relay: relayUrl,
      room: cfg.room,
      token: minted.token,
      grants: tooMany ? [] : held,
    })
  }

  // ---- M5: join-as-mount, unshare/unmount, cross-mount moves ----

  /**
   * "Add a shared folder here…": join someone's FOLDER share as a subtree.
   *
   * Two refusals before anything is persisted:
   *
   *  - a DEVICE link is not a folder share (A2, R5). It is a full-access key
   *    to a whole vault; joining it here would mount a vault inside a vault
   *    and store a device-kind credential for a non-root room. It has its own
   *    route — "Link this device…" in the vault manager — and the dictionary
   *    says so in those words.
   *  - a destination at or under a `kind:'mount'` entry in the ROOT MAP (M10),
   *    the guard `doCarve` has had since N1. `ui.mounts` is what THIS device
   *    runs; the map is what every peer of the root agreed, and a folder
   *    another of this person's devices carved seconds ago is a mount entry
   *    here before it is a desc. Joining into it would make a mount inside a
   *    mount on every device (spike S10 Q5 row 11).
   *
   * Grants are NOT merged here, and that is deliberate: a folder link carries
   * none (the codec refuses them, R5), so `mergeGrants` on this path could
   * only ever act on a device link — the very thing the first refusal now
   * rejects. Grants belong to the device-link join.
   */
  const doJoinMount = async (link: string, destPath: string): Promise<void> => {
    const target = decodeShareLink(link)
    const dest = destPath.trim().replace(/^\/+|\/+$/g, '')
    if (target.kind !== 'folder') {
      throw new Error(getLL().web.mounts.dialog.device_link_refused())
    }
    if (target.room === cfg.room || ui.mounts.some((m) => m.room === target.room)) {
      throw new Error(getLL().web.workspace.already_joined())
    }
    const mapEntries = rootSession!.mountEntries()
    for (const entry of mapEntries) {
      if (
        dest === entry.path ||
        dest.startsWith(`${entry.path}/`) ||
        entry.path.startsWith(`${dest}/`)
      ) {
        throw new Error(getLL().web.workspace.overlaps())
      }
    }
    try {
      const session = await joinMount({
        vaultDir: cfg.storeDir,
        mountsFile,
        root: rootSession!,
        baseAdapter: cfg.adapter,
        existingMountPaths: ui.mounts.map((m) => m.path),
        mapEntries,
        mountPath: dest,
        room: target.room,
        // The FOREIGN relay: inside a shared root the destination detach
        // announces this mount to the root's peers, and they must be told
        // where it actually lives (spike S10 Q7).
        relayUrl: target.relay,
        addIgnore: (p) => ignoreSet.add(p),
        removeIgnore: (p) => ignoreSet.delete(p),
        buildSession: async () => {
          // Visible (with its badge row) while the pull runs: the 'joining'
          // desc renders as a mount being made.
          await reloadMounts()
          return buildMount({
            room: target.room,
            path: dest,
            provenance: 'joined',
            relay: { url: target.relay, token: target.token },
            firstJoin: true,
            onShared: (l) => {
              linkByRoom.set(target.room, l)
              refreshMounts()
            },
          })
        },
      })
      setRoomToken(target.room, target.token, target.relay, 'folder')
      registry.add(dest, session)
      await reloadMounts()
      refreshTree()
    } catch (err) {
      await reloadMounts()
      refreshTree()
      throw err
    }
  }

  /**
   * Rebuild the root session from its (surgically updated) durable stores.
   * The relay goes back on (N1): a rebuilt root that quietly lost it would
   * stop announcing carves and stop hearing peers — sync state that lies by
   * omission, and the mechanism the whole nested-mount machine rides on.
   */
  const rebuildRoot = async (): Promise<void> => {
    rootSession = await buildMount({
      room: cfg.room,
      path: '',
      provenance: 'local',
      ...(rootRelay ? { relay: rootRelay } : {}),
      onShared: () => (ui.linked = true),
    })
    registry.add('', rootSession)
    refreshIgnore()
  }

  const mountAt = (path: string): MountInfo => {
    const info = ui.mounts.find((m) => m.path === path)
    if (!info) throw new Error(getLL().web.workspace.not_shared({ path }))
    return info
  }

  /**
   * Stop sharing a folder this vault owns: the room is DISSOLVED and its
   * content folds back into the root.
   *
   * The credential goes with it (A4). `tokensByRoom`/`relayByRoom` used to
   * keep the room's bearer token forever, which is a live key to a room this
   * vault no longer has any relationship with — it would ride out in the next
   * device link's `grants` bundle, and a mount entry that re-named the room
   * would find an "exact token" waiting and reconnect without a paste.
   * `purgeRooms` drops the token, the relay URL and the remembered link.
   */
  const doUnshare = async (path: string): Promise<void> => {
    const info = mountAt(path)
    // Captured, not discarded (C1): these notes are still open in their panes,
    // and the root this surgery rebuilds starts knowing nothing about them.
    const held = dropLiveViewsUnder(path)
    const mount = registry.resolve(path)!.session
    // Both sessions leave the registry before the stop-the-world surgery.
    registry.remove(path)
    registry.remove('')
    await unshareMount({
      vaultDir: cfg.storeDir,
      mountsFile,
      engine,
      rootRoom: cfg.room,
      desc: { room: info.room, path },
      mount,
      root: rootSession!,
      removeIgnore: (p) => ignoreSet.delete(p),
    })
    purgeRooms([info.room])
    linkByRoom.delete(info.room)
    await rebuildRoot()
    await reloadMounts()
    refreshTree()
    // The root is a NEW session: views elsewhere still hold it, and the
    // unshared subtree's notes are its files now.
    reapplyLiveViews(held)
  }

  /**
   * Drop someone else's share from THIS device (the room lives on without
   * us). Same credential rule as unshare (A4): this device gave the share up,
   * so it keeps no key for it — otherwise the token outlives the mount in
   * config, travels in the next device link's grants, and silently
   * reconnects the room the moment an entry for it reappears. Re-joining is
   * one paste of the link the sharer still holds.
   */
  const doUnmount = async (path: string): Promise<void> => {
    const info = mountAt(path)
    // The files stay on disk and the root re-enrols them below, so the views
    // that were released are re-opened against the root (C1).
    const held = dropLiveViewsUnder(path)
    const mount = registry.resolve(path)!.session
    registry.remove(path)
    await unmountMount({
      vaultDir: cfg.storeDir,
      mountsFile,
      engine,
      rootRoom: cfg.room,
      desc: { room: info.room, path },
      mount,
      removeIgnore: (p) => ignoreSet.delete(p),
    })
    purgeRooms([info.room])
    linkByRoom.delete(info.room)
    await reloadMounts()
    // The files are on disk and newly visible to the root — enroll them now
    // (a big folder legitimately trips the breaker dialog here).
    await rootSession!.rescan()
    refreshTree()
    reapplyLiveViews(held)
  }

  /**
   * Paste the link for a mount this device holds but has no key for (spike
   * S10 Q2, A4-C).
   *
   * The RULE — merge in place through `enableSharing`, or rebuild as a
   * `firstJoin` and pull — is `activateMount` in libs/workspace, not this
   * shim: it is a lifecycle machine with a durable status and a rollback, and
   * the N3 device-link harness drives the same one, so the two cannot drift.
   * It also picks the branch on `MountDesc.neverHeld` rather than on "does
   * this session list any files", which was wrong in the direction that loses
   * data — see the header of `activate.ts`.
   *
   * What stays here is the shell's half: decoding the link, refusing the wrong
   * kind of link, storing the token, the registry, and the progress line.
   *
   * A DEVICE link is refused (R5, the same rule `doJoinMount` applies): a
   * device token is a credential for a whole vault that the relay also honours
   * in rooms carved out of it, and storing one against a single folder's room
   * would file vault-wide access under a folder — where `relayForRoom`'s
   * exact-match rule would then hand it to that room, and the next device
   * link's `grants` bundle would carry it onward. Grants are not merged here
   * for the same reason: a folder link carries none (the codec refuses them),
   * so merging could only ever act on the link this refusal rejects.
   */
  const doAddMountLink = async (path: string, link: string): Promise<void> => {
    const t = getLL().web.workspace
    const info = ui.mounts.find((m) => m.path === path)
    if (!info) throw new Error(t.not_shared({ path }))
    const target = decodeShareLink(link)
    if (target.kind !== 'folder') {
      throw new Error(getLL().web.mounts.dialog.device_link_refused())
    }
    if (target.room !== info.room) {
      throw new Error(getLL().web.mounts.dialog.wrong_room({ path }))
    }
    const resolved = registry.resolve(path)
    const session = resolved?.mountPath === path ? resolved.session : null
    const desc = descs.find((d) => d.room === info.room && d.path === path)
    if (!session || !desc) throw new Error(t.not_shared({ path }))

    setRoomToken(target.room, target.token, target.relay, target.kind)

    /**
     * Views released by `detachMount`, waiting for `attachMount` (C1).
     *
     * `activateMount` detaches ONLY to replace the session (the pull branch,
     * and its rollback) — it shuts the old one down and destroys its docs, so
     * the views must let go first, and the replacement starts with an empty
     * open set, so they must be re-applied to it. The merge branch calls
     * neither hook, which is exactly right: it keeps the same session and the
     * same guids, and a note open in a pane is never disturbed.
     */
    let held: string[] = []

    try {
      await activateMount({
        vaultDir: cfg.storeDir,
        mountsFile,
        desc,
        session,
        relay: { url: target.relay, token: target.token },
        buildSession: (o) =>
          buildMount({
            room: o.room,
            path: o.path,
            provenance: o.provenance,
            ...(o.relay ? { relay: o.relay } : {}),
            ...(o.firstJoin ? { firstJoin: true } : {}),
            ...(o.neverHeld ? { neverHeld: true } : {}),
            ...(o.onPullProgress ? { onPullProgress: o.onPullProgress } : {}),
            onShared: (l) => {
              linkByRoom.set(info.room, l)
              refreshMounts()
            },
          }),
        detachMount: (p) => {
          registry.remove(p)
          held = dropLiveViewsUnder(p)
        },
        attachMount: (p, next) => {
          registry.add(p, next)
          reapplyLiveViews(held)
          held = []
        },
        // The pull is awaited and can take a while on a real vault (spike S10
        // Q4), so it gets the same two-phase line a whole-vault link gets.
        onPullProgress: (progress) => {
          ui.pull = progress
          cfg.onPull?.(progress)
        },
      })
    } finally {
      ui.pull = null
      // Both the pull and its rollback re-attach, so this is normally empty.
      // If neither could build a session the views would be stranded with no
      // mount to hold them — put them back, and the next thing that resolves
      // them re-marks them (C1).
      if (held.length > 0) reapplyLiveViews(held)
      await reloadMounts()
      refreshTree()
    }
  }

  const isCrossMount = (from: string, to: string): boolean => {
    const a = registry.resolve(from)
    const b = registry.resolve(to)
    return !!a && !!b && a.session !== b.session
  }

  const doMovePath = async (from: string, to: string): Promise<void> => {
    const src = registry.resolve(from)
    const dst = registry.resolve(to)
    if (!src || !dst) return
    if (src.session === dst.session) {
      await src.session.renamePath(src.rel, dst.rel)
      return
    }
    dropLiveViewsUnder(from)
    const row = ui.files.find((f) => f.path === from)
    if (!row) return
    if (row.kind === 'mount') {
      throw new Error(getLL().web.mounts.reason.mount_root_move({ path: from }))
    }
    // Import into the target FIRST, tombstone the source after — a crash in
    // between leaves a visible duplicate (both journaled), never a loss.
    if (row.kind === 'dir') {
      const childPrefix = `${from}/`
      const children = ui.files.filter((f) => f.path.startsWith(childPrefix))
      const rebase = (p: string): string => `${dst.rel}${p.slice(from.length)}`
      await dst.session.createDir(dst.rel)
      for (const child of children.filter((c) => c.kind === 'dir')) {
        await dst.session.createDir(rebase(child.path))
      }
      for (const child of children.filter((c) => c.kind !== 'dir')) {
        const bytes = await src.session.readFileBytes(child.path.slice(src.mountPath ? src.mountPath.length + 1 : 0))
        if (bytes) await dst.session.importFile(rebase(child.path), bytes)
      }
    } else {
      const bytes = await src.session.readFileBytes(src.rel)
      if (bytes === null) throw new Error(getLL().web.workspace.cannot_read({ path: from }))
      await dst.session.importFile(dst.rel, bytes)
    }
    await src.session.deletePath(src.rel)
    refreshTree()
  }

  // Comment threads (writing-harness B8): one store per note, materialized
  // through this facade's own app-file seam.
  const threads = createThreadRegistry({
    clock: realClock,
    docForPath: resolveDoc,
    guidFor: (p) => ui.files.find((f) => f.path === p)?.guid ?? null,
    pathFor: (g) => ui.files.find((f) => f.guid === g)?.path ?? null,
    files: { read: (p) => facade.readAppFile(p), write: (p, text) => facade.writeAppFile(p, text) },
  })

  const facade: Workspace = {
    ui,
    startedAt,
    rootRelayUrl,
    notify,
    flash,
    clearEvents,
    user,
    room: cfg.room,
    docForPath: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.docForPath(r.rel) : null
    },
    awarenessForPath: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.awarenessForPath(r.rel) : null
    },
    setLiveViews,
    undoManagerFor,
    proposeEdit: async (input) => {
      const r = registry.resolve(input.path)
      if (!r) throw new Error(getLL().web.workspace.cannot_read({ path: input.path }))
      const record = r.session.proposeEdit({ ...input, path: r.rel })
      return { ...record, path: input.path }
    },
    acceptSuggestion: (path, id) => {
      const r = registry.resolve(path)
      const record = r ? r.session.acceptSuggestion(r.rel, id) : null
      if (record?.status === 'accepted') agentRuns = [...agentRuns.filter((run) => run !== record.origin.runId), record.origin.runId]
      return record ? { ...record, path } : null
    },
    rejectSuggestion: (path, id) => {
      const r = registry.resolve(path)
      return r ? r.session.rejectSuggestion(r.rel, id) : false
    },
    suggestionsFor: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.suggestionsFor(r.rel).map((record) => ({ ...record, path })) : []
    },
    suggestionSpans: (path) => {
      const r = registry.resolve(path)
      return r ? r.session.suggestionSpans(r.rel) : []
    },
    subscribeSuggestions: (path, cb) => {
      const r = registry.resolve(path)
      return r ? r.session.subscribeSuggestions(r.rel, cb) : () => {}
    },
    undoAgent: (runId) => {
      // A run can write in several mounts; each session undoes its own part.
      const id = runId ?? agentRuns.at(-1)
      if (!id) return false
      let any = false
      for (const { session } of registry.all()) any = session.undoAgent(id) || any
      agentRuns = agentRuns.filter((run) => run !== id)
      return any
    },
    createFile: async (dir = '', name, text) => {
      // Route on the FULL TARGET PATH, never on `dir` alone. A prefixed name
      // (`[[team/plan]]` → name='team/plan.md', dir='') targets a path that a
      // carved mount may own; routing by `dir` sent it to the root session,
      // whose adapter is pass-through, so the bytes landed inside the mount's
      // directory while the map entry went into the root room — two rooms,
      // two guids, two LCAs over one file on disk.
      const target = name ? (dir ? `${dir}/${name}` : name) : dir
      const r = target ? registry.resolve(target) : null
      const owner = r?.session ?? rootSession!
      const mountPath = r?.mountPath ?? ''
      // The owner speaks mount-relative paths: split the resolved target back
      // into (dir, name) in its own space.
      let relDir = ''
      let relName = name
      if (name) {
        const rel = r ? r.rel : target
        const cut = rel.lastIndexOf('/')
        relDir = cut === -1 ? '' : rel.slice(0, cut)
        relName = cut === -1 ? rel : rel.slice(cut + 1)
      } else {
        relDir = r ? r.rel : dir
      }
      const path = await owner.createFile(relDir, relName, text)
      return path ? (mountPath ? `${mountPath}/${path}` : path) : null
    },
    createDir: async (path) => {
      const r = registry.resolve(path)
      if (r) await r.session.createDir(r.rel)
    },
    renamePath: async (from, to) => {
      if (ui.files.find((f) => f.path === from)?.kind === 'mount') {
        throw new Error(getLL().web.mounts.reason.mount_root_rename({ path: from }))
      }
      const r = registry.resolve(from)
      const rTo = registry.resolve(to)
      if (!r || !rTo) return
      if (r.session !== rTo.session) {
        // Cross-mount: the caller must route through movePath (confirm first).
        // Gesture feedback (S22 Q1): toasted where the drop happened, not logged.
        flash({ level: 'error', text: getLL().web.workspace.cross_mount_move(), path: from })
        return
      }
      await r.session.renamePath(r.rel, rTo.rel)
    },
    movePath: doMovePath,
    isCrossMount,
    deletePath: async (path) => {
      if (ui.files.find((f) => f.path === path)?.kind === 'mount') {
        throw new Error(getLL().web.mounts.reason.mount_root_delete({ path }))
      }
      const r = registry.resolve(path)
      if (r) await r.session.deletePath(r.rel)
    },
    fileHistory: async (path) => {
      const r = registry.resolve(path)
      return r ? r.session.fileHistory(r.rel) : []
    },
    restorePreImage: async (path, seq) => {
      const r = registry.resolve(path)
      if (r) await r.session.restorePreImage(r.rel, seq)
    },
    resolveReview: (guid, mergedText) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveReview(guid, mergedText),
    resolveVanished: (guid, action) =>
      (reviewOwner.get(guid) ?? rootSession!).resolveVanished(guid, action),
    addShareMount: (link, dir) => duringSurgery(() => doJoinMount(link, dir)),
    // Every mount surgery is bracketed HERE rather than inside each machine:
    // one place, and `ui.settling` cannot be left true by an early return
    // from one of them (M3).
    addMountLink: (path, link) => duringSurgery(() => doAddMountLink(path, link)),
    unshare: (path) => duringSurgery(() => doUnshare(path)),
    unmount: (path) => duringSurgery(() => doUnmount(path)),
    carveFolder: (path) => duringSurgery(() => doCarve(path)),
    linkDevice: doLinkDevice,
    confirmBreaker: async () => {
      ui.breaker = null
      await (breakerOwner ?? rootSession!).confirmBreaker()
      breakerOwner = null
    },
    dismissBreaker: () => {
      ui.breaker = null
      ;(breakerOwner ?? rootSession!).dismissBreaker()
      breakerOwner = null
    },
    inspect: async (path) => {
      const r = registry.resolve(path)
      if (!r) return null
      const insp = await r.session.inspectPath(r.rel)
      // Report the workspace-level path, not the mount-relative one.
      return insp ? { ...insp, path, mount: { path: r.mountPath, room: r.session.room } } : null
    },
    mountStats: () => Promise.all(registry.all().map((h) => h.session.mountStats())),
    inspectMounts: async () => {
      const hosts = [...registry.all()].sort((a, b) => a.mountPath.localeCompare(b.mountPath))
      return Promise.all(
        hosts.map(async ({ mountPath, session }) => {
          const m = await session.inspectMount()
          const d = descs.find((x) => x.path === mountPath) ?? null
          return {
            ...m,
            mountPath,
            desc: d
              ? {
                  status: d.status,
                  provenance: d.provenance,
                  relay: d.relay?.url ?? null,
                  neverHeld: d.neverHeld === true,
                  absorbInto: d.absorbInto ?? null,
                }
              : null,
            rows: m.rows.map((r) => ({ ...r, path: mountPath ? `${mountPath}/${r.path}` : r.path })),
            lcaOrphans: m.lcaOrphans.map((o) => ({
              ...o,
              path: mountPath ? `${mountPath}/${o.path}` : o.path,
            })),
          }
        })
      )
    },
    mountInvariants: () => mountInvariants({ descs, ignore: ignoreSet, mounts: registry.all() }),
    peek: async (path) => {
      const r = registry.resolve(path)
      return r ? r.session.peekPath(r.rel) : null
    },
    readFileBytes: async (path) => {
      const r = registry.resolve(path)
      return r ? r.session.readFileBytes(r.rel) : null
    },
    journalFor: (path) => {
      const r = registry.resolve(path)
      return r ? (journals.get(r.session.room) ?? null) : null
    },
    writeAttachment: async (path, bytes) => {
      const r = registry.resolve(path)
      if (!r) return null
      const written = await r.session.writeAttachment(r.rel, bytes)
      if (written) refreshTree()
      return written ? (r.mountPath ? `${r.mountPath}/${written}` : written) : null
    },
    readAttachment: async (name, fromPath, form = 'wikilink') => {
      // Vault-wide by name, like Obsidian (E5): the binary rows are the files
      // an embed can name; the list is in workspace space, as `fromPath` is.
      const known = ui.files.filter((f) => f.kind === 'binary').map((f) => f.path)
      const candidates =
        form === 'markdown'
          ? imageCandidates(name, fromPath, known)
          : attachmentCandidates(name, fromPath, known)
      for (const candidate of candidates) {
        const bytes = await cfg.adapter.read(candidate).catch(() => null)
        if (bytes) return new Blob([bytes as BlobPart], { type: attachmentType(candidate) })
      }
      return null
    },
    readAppFile: async (path) => {
      // The same guard as the writer: a `..` (a palette template name
      // `../../x`) must not climb out of `.ohhi/` (correctness #23).
      const rel = appFilePath(path, APP_FILE_DIRS, 'readAppFile')
      const bytes = await cfg.adapter.read(rel)
      return bytes ? new TextDecoder().decode(bytes) : null
    },
    listAppDir: async (dir) => {
      const rel = appFilePath(dir.endsWith('/') ? dir : `${dir}/`, APP_FILE_DIRS, 'listAppDir')
      return (await cfg.adapter.listAppDir?.(rel.replace(/\/+$/, ''))) ?? []
    },
    writeAppFile: async (path, text) => {
      const rel = appFilePath(path, [APP_WRITE_DIR], 'writeAppFile')
      // Golden rule 1: the bytes this write replaces are journaled first.
      await appFiles.journal().record(rel, await cfg.adapter.read(rel))
      await cfg.adapter.writeAtomic(rel, new TextEncoder().encode(text))
      appFiles.changed([rel])
      appFiles.broadcast([rel])
    },
    deleteAppFile: async (path) => {
      const rel = appFilePath(path, [APP_WRITE_DIR], 'deleteAppFile')
      const before = await cfg.adapter.read(rel)
      if (before === null) return
      // Golden rule 1: the bytes a delete loses are journaled first.
      await appFiles.journal().record(rel, before)
      await cfg.adapter.remove(rel)
      appFiles.changed([rel])
      appFiles.broadcast([rel])
    },
    onAppFileChange: (prefix, cb) => appFiles.subscribe(prefix, cb),
    threadsFor: (path) => threads.storeFor(path),
    addThread: (path, { author, sendTo, ...rest }) =>
      threads.storeFor(path)?.add({ ...rest, author: author ?? user.name, ...(sendTo ? { sendTo } : {}) }) ?? null,
    reply: (path, threadId, comment) =>
      threads.storeFor(path)?.reply(threadId, { ...comment, author: comment.author ?? user.name }) ?? null,
    resolveThread: (path, threadId, resolved = true) => threads.storeFor(path)?.resolve(threadId, resolved),
    exportCriticMarkup: async (path) => {
      const store = threads.storeFor(path)
      if (!store) return { path: null, written: 0, skipped: 0 }
      return writeReviewCopy(store, path, {
        exists: (p) => ui.files.some((f) => f.path === p),
        createFile: (dir, name, text) => facade.createFile(dir, name, text),
      })
    },
    dispose: () => {
      for (const manager of undoManagers.values()) manager.destroy()
      undoManagers.clear()
      void threads.dispose()
      registry.dispose()
      appFiles.dispose()
    },
  }
  return facade
}

/**
 * The `.ohhi/` side channel (foundations Stage 1, F8/F9): its journal, its
 * change listeners, and the three ways a change arrives — the adapter's
 * `watchAppDir` (desktop), this tab's own writes, another tab's writes over
 * a BroadcastChannel (the browser has no other change source). Nothing here
 * touches a mount, the path map, the index or a CRDT.
 */
function createAppFiles(adapter: VaultAdapter, storeDir: StoreDir, room: string) {
  const listeners = new Set<{ prefix: string; cb: (paths: string[]) => void }>()
  const pending = new Set<string>()
  let cancel: (() => void) | null = null
  let journal: FileJournal | null = null

  function flush(): void {
    cancel = null
    const batch = [...pending]
    pending.clear()
    for (const { prefix, cb } of [...listeners]) {
      const mine = batch.filter((p) => p.startsWith(prefix))
      if (mine.length > 0) cb(mine)
    }
  }
  function changed(paths: readonly string[]): void {
    for (const p of paths) pending.add(p)
    cancel ??= realClock.schedule(flush, APP_FILE_DEBOUNCE_MS)
  }

  const stopWatch = adapter.watchAppDir?.(APP_WRITE_DIR.slice(0, -1), changed) ?? null
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`ohhi-app-files:${room}`)
  if (channel) {
    channel.onmessage = (e: MessageEvent<unknown>) => {
      if (Array.isArray(e.data)) changed(e.data.filter((p): p is string => typeof p === 'string'))
    }
  }

  return {
    /** A journal of its own (`<room>/app-files/journal/`), so its seq never races a mount's. */
    journal(): FileJournal {
      journal ??= new FileJournal(scopedStoreDir(storeDir, `${room}/app-files/`), {
        now: () => realClock.now(),
      })
      return journal
    },
    changed,
    broadcast(paths: string[]): void {
      channel?.postMessage(paths)
    },
    subscribe(prefix: string, cb: (paths: string[]) => void): () => void {
      const entry = { prefix: prefix.replace(/^\/+/, ''), cb }
      listeners.add(entry)
      return () => listeners.delete(entry)
    },
    dispose(): void {
      stopWatch?.()
      channel?.close()
      cancel?.()
      cancel = null
      listeners.clear()
    },
  }
}
