/**
 * The harness's shell-owned state: the open vault's sessions, the run
 * registry, and `startRun` — the ONE door every caller starts a turn
 * through (the composer, `ai.add-selection`, `ai.run-skill`, a comment's
 * *Send to agent*).
 *
 * Owned by the shell, never by a view: `App.svelte` attaches it once with
 * what only the composition root holds (the workspace, the app's index, the
 * clock, `openView`), so a run outlives its tab and a command can start or
 * stop one with no Session view on screen. Everything is per vault — keyed
 * by the `Workspace` object — and a vault switch stops the old vault's runs.
 *
 * The sessions list is derived from the files (`session-store.ts`) and
 * refreshed on this store's own writes and on `onAppFileChange` under
 * `.ohhi/sessions/` (another tab, an agent with the CLI).
 */
import type { UIMessage } from 'ai'
import type { Chat } from '@ai-sdk/svelte'
import type { Mention, ProviderConfig, RunRecord, SkillSource } from '@ohhi/harness'
import type { VaultIndex } from '@ohhi/index'
import { decodeFile, hashBytes, type Clock } from '@ohhi/vault'
import { createAppBackend, workspaceBackendHost, type VaultBackend } from './agent-backend.js'
import { createRunRegistry, isLive, type RunHandle, type RunInput, type RunRegistry } from './ai-runs.svelte.js'
import { appAgentHost, type AgentFactory } from './ai-transport.js'
import { emptySkillSource } from '@ohhi/harness/skills'
import { aiConfig } from './ai-config.svelte.js'
import { editorFor, selectionOf } from './focused-editor.svelte.js'
import { decodeRange, encodeRange, ytextOf, type AgentPresenceSink } from '@ohhi/workspace'
import { getLL } from '@ohhi/i18n'
import { captureSelection, resolveMention } from './references.js'
import { createSessionStore, mintId, SESSIONS_DIR, type SessionStore, type SessionSummary } from './session-store.js'
import type { FlashInput } from './notices.js'
import type { Workspace } from './workspace.svelte.js'

export type { RunHandle, RunInput } from './ai-runs.svelte.js'

/** What the composition root hands the harness (`attachHarness`). */
export interface HarnessShell {
  /** The open vault, or null on the manager. Read live. */
  workspace(): Workspace | null
  /** The app's index (navigation's `MemoryIndex`) — never a second one. */
  index: VaultIndex
  clock: Clock
  /** Open (or focus) a Session tab. */
  openView(id: 'session', arg?: string): void
  /** The trusted, enabled skills (`currentSkills()?.source()`); absent → none. */
  skills?(): SkillSource
  /** Feedback when a run cannot start (`workspace.flash`). */
  flash?(input: FlashInput): void
  /** Injected for the tests; `createHarnessAgent` otherwise. */
  agentFactory?: AgentFactory
}

/** `startRun`'s input: a turn, in a session or a new one. */
export interface StartRunInput extends RunInput {
  /** The session to run in; absent → a new session, titled from the instruction. */
  sessionId?: string
  /** Open the session's tab (default true). */
  open?: boolean
}

interface VaultHarness {
  workspace: Workspace
  store: SessionStore
  registry: RunRegistry
  backend: VaultBackend
  /** Runs telling presence, per note path (`countedPresence`). */
  presence: Map<string, number>
  unsubscribe(): void
}

let shell: HarnessShell | null = null
let active: VaultHarness | null = null

/** The reactive half the views read. */
export const harness = $state({
  /** The open vault's sessions, newest activity first (archived ones excluded). */
  list: [] as SessionSummary[],
  /** The session last focused — what `app.session` reopens and `ai.stop-run` stops. */
  current: null as string | null,
  /** Mentions waiting for a session's composer (`ai.add-selection`), by session id. */
  inbox: {} as Record<string, Mention[]>,
})

/** Called once by `App.svelte`; null detaches (tests). */
export function attachHarness(next: HarnessShell | null): void {
  active?.registry.stopAll()
  active?.unsubscribe()
  active = null
  shell = next
}

/**
 * The open vault's harness when it is already built — what a READ asks
 * (inside a view's `$derived`, where nothing may be created or written).
 */
function built(): VaultHarness | null {
  const ws = shell?.workspace() ?? null
  return active && ws && active.workspace === ws ? active : null
}

/**
 * Build the open vault's harness now, outside any render — a view calls it
 * at init, before its first read. Idempotent.
 */
export function ensureHarness(): void {
  vault()
}

/** The open vault's harness, built on first use and rebuilt when the vault changes. */
function vault(): VaultHarness | null {
  const ws = shell?.workspace() ?? null
  if (!shell || !ws) return null
  if (active?.workspace === ws) return active
  if (active) {
    // Another vault was open: its runs stop and its state goes. Deferred,
    // because this can run inside a view's render (a `$derived` asking for a
    // run), where writing state is not allowed.
    active.registry.stopAll()
    active.unsubscribe()
    queueMicrotask(() => {
      harness.list = []
      harness.current = null
      harness.inbox = {}
    })
  }
  const { clock, index } = shell
  const store = createSessionStore(ws, { clock, vault: ws.room })
  const presence = new Map<string, number>()
  const backend = createAppBackend(workspaceBackendHost(ws, index, clock))
  const registry = createRunRegistry({
    store,
    clock,
    provider: resolveProvider,
    host: () =>
      appAgentHost({
        backend,
        clock,
        skills: skillSource(),
        // The agent's edits land as suggestions in the note; direct mode is
        // re-read per proposal, so a settings change applies mid-run.
        proposals: { proposeEdit: (input) => ws.proposeEdit(input), applyAgentEdit: (input) => ws.applyAgentEdit(input) },
        direct: () => aiConfig().directEdit === true,
        // The agent as a peer; absent on a test's partial workspace.
        ...(ws.agentPresence ? { presence: countedPresence(ws.agentPresence(), presence) } : {}),
      }),
    ...(shell.agentFactory ? { agentFactory: shell.agentFactory } : {}),
  })
  const unsubscribe = ws.onAppFileChange(`${SESSIONS_DIR}/`, () => {
    store.invalidate()
    void refreshSessions()
  })
  active = { workspace: ws, store, registry, backend, presence, unsubscribe }
  void refreshSessions()
  return active
}

/**
 * One run's presence, counted per note: while another run is still working
 * on the same note, this run finishing (`idle`, then the linger's leave)
 * tells nothing — the last run on a note is the one that clears it. `live`
 * is the vault's count, shared by its runs.
 */
export function countedPresence(sink: AgentPresenceSink, live: Map<string, number>): AgentPresenceSink {
  /** The note this run is counted on, while it is working; and the last one it was on. */
  let at: string | null = null
  let last = ''
  const leave = (): void => {
    if (at === null) return
    last = at
    const n = (live.get(at) ?? 1) - 1
    if (n > 0) live.set(at, n)
    else live.delete(at)
    at = null
  }
  return {
    set(state) {
      if (state && state.status !== 'idle') {
        const path = state.path ?? ''
        if (at !== path) {
          leave()
          at = path
          live.set(path, (live.get(path) ?? 0) + 1)
        }
        sink.set(state)
        return
      }
      const path = at ?? state?.path ?? last
      leave()
      if ((live.get(path) ?? 0) > 0) return
      sink.set(state)
    },
  }
}

/** The skills the agent and the `/` menu see (the trusted, enabled set). */
export function skillSource(): SkillSource {
  return shell?.skills?.() ?? emptySkillSource
}

/** The app's index, for the `@` menu's ranking. Null before `attachHarness`. */
export function harnessIndex(): VaultIndex | null {
  return shell?.index ?? null
}

/** The shell's clock (the run statuses' and elapsed times'). */
export function harnessClock(): Clock | null {
  return shell?.clock ?? null
}

/**
 * The provider a run uses, re-read every run: the asked-for one — null when
 * it no longer exists, never a silent switch to another host — else the
 * default, else the first.
 */
export function resolveProvider(id?: string): ProviderConfig | null {
  const cfg = aiConfig()
  if (id) return cfg.providers.find((p) => p.id === id) ?? null
  return cfg.providers.find((p) => p.id === cfg.defaultProvider) ?? cfg.providers[0] ?? null
}

/**
 * What a Retry of `run` sends: its instruction and references, its skill
 * (re-read by name — a skill no longer trusted or enabled is left out, never
 * run unreviewed) and the comment thread it answered.
 */
export async function retryInput(run: Pick<RunRecord, 'input' | 'threadId'>): Promise<RunInput> {
  const source = skillSource()
  const name = run.input.skill
  const meta = name ? (await source.list()).find((m) => m.name === name) : undefined
  const body = meta ? await source.body(meta.name) : null
  return {
    instruction: run.input.instruction,
    refs: run.input.refs,
    ...(meta && body !== null ? { skill: { meta, body } } : {}),
    ...(run.threadId ? { threadId: run.threadId } : {}),
  }
}

/** Re-derive the list from the files. */
export async function refreshSessions(): Promise<void> {
  const v = vault()
  if (!v) return
  const list = await v.store.list()
  if (active === v) harness.list = list
}

/** A fresh session id (the file is written on the first send). */
export function newSessionId(): string {
  return mintId(shell?.clock.now() ?? 0)
}

/** The session's title, when it has one (the tab's name). */
export function sessionTitle(id: string): string | undefined {
  return harness.list.find((s) => s.id === id)?.title
}

/** What `app.session` opens: the session last focused, else a fresh one. */
export function currentSessionArg(): string {
  return harness.current ?? newSessionId()
}

/** A Session view took focus. */
export function focusSession(id: string): void {
  harness.current = id
}

/** The session's chat (its transcript, loaded from the file once). Null with no vault. */
export function chatFor(id: string): Promise<Chat<UIMessage>> | null {
  return vault()?.registry.chat(id) ?? null
}

/** The session's latest run, live. */
export function runFor(id: string): RunRecord | null {
  return built()?.registry.current(id) ?? null
}

/** The live backend (reads the Y.Texts), for references and hashes. */
export function harnessBackend(): VaultBackend | null {
  return vault()?.backend ?? null
}

/** `hashBytes` of a note as the agent would read it — a mention's `hash`. */
export async function noteHash(path: string): Promise<string | undefined> {
  const bytes = await harnessBackend()?.adapter.read(path)
  return bytes ? hashBytes(bytes) : undefined
}

/** A note's text as the agent would read it (live Y.Text first). */
export async function noteText(path: string): Promise<string | null> {
  const bytes = await harnessBackend()?.adapter.read(path)
  return bytes ? decodeFile(bytes).text : null
}

/** Which of these mentions no longer match what they captured (the chip's *changed* badge). */
export async function changedMentions(refs: readonly Mention[]): Promise<Set<string>> {
  const changed = new Set<string>()
  for (const m of refs) {
    const text = await noteText(m.ref.path)
    const hash = m.ref.kind === 'lines' ? undefined : await noteHash(m.ref.path)
    if (resolveMention(m, text, { ...(hash ? { currentHash: hash } : {}), anchorRange: anchorRangeOf(m) }).changed) changed.add(m.id)
  }
  return changed
}

/** Where a mention's anchor pair says its range is now, on the enrolled doc. */
function anchorRangeOf(m: Mention): { from: number; to: number } | null {
  const doc = m.anchor?.yjs ? built()?.workspace.docForPath(m.ref.path) : null
  return doc && m.anchor?.yjs ? decodeRange(doc, m.anchor.yjs) : null
}

/** Re-read every mention at send (B5): re-pinned when anchored; the snapshot still goes. */
async function resolveAtSend(refs: readonly Mention[]): Promise<Mention[]> {
  const out: Mention[] = []
  for (const m of refs) out.push(resolveMention(m, await noteText(m.ref.path), { anchorRange: anchorRangeOf(m) }).mention)
  return out
}

/** Ensure a session file exists; titled from its first instruction. */
async function ensureSession(v: VaultHarness, id: string, title?: string): Promise<void> {
  if (await v.store.load(id)) return
  await v.store.create({ id, ...(title ? { title } : {}) })
}

/** A short title from an instruction: its first line, cut at a word near 48 characters. */
export function titleFrom(instruction: string): string | undefined {
  const line = instruction.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return undefined
  if (line.length <= 48) return line
  const cut = line.slice(0, 48)
  const space = cut.lastIndexOf(' ')
  return `${(space > 24 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Start a turn — THE entry point (`ai.run-skill`, *Send to agent*, the
 * composer). Creates the session when it does not exist, resolves the
 * references, opens the tab (unless `open: false`) and returns the handle;
 * null when no vault is open, no provider exists, the asked-for provider is
 * gone (said in a flash), or the session already has a turn in flight.
 */
export async function startRun(input: StartRunInput): Promise<RunHandle | null> {
  const v = vault()
  if (!v) return null
  if (!resolveProvider(input.providerId)) {
    if (input.providerId) shell?.flash?.({ level: 'error', text: getLL().web.ai.session.provider_gone() })
    return null
  }
  const sessionId = input.sessionId ?? newSessionId()
  if (isLive(v.registry.current(sessionId))) return null
  await ensureSession(v, sessionId, titleFrom(input.instruction))
  const refs = await resolveAtSend(input.refs ?? [])
  const handle = await v.registry.start(sessionId, { ...input, refs })
  harness.current = sessionId
  if (input.open !== false) shell?.openView('session', sessionId)
  void refreshSessions()
  void handle?.done.then(() => refreshSessions())
  return handle
}

/** A finished run's answer (the agent's last words) — send-to-agent's reply, a skill's findings. */
export function runReply(handle: Pick<RunHandle, 'runId'>): string | null {
  return built()?.registry.reply(handle.runId) ?? null
}

/** The open vault's workspace, as the harness holds it (a run's landing: threads, notes). */
export function harnessWorkspace(): Workspace | null {
  return vault()?.workspace ?? null
}

/** Stop a session's run (default: the current session's, else any running one). */
export function stopRun(sessionId?: string): boolean {
  const v = vault()
  if (!v) return false
  const id = sessionId ?? (harness.current && isLive(v.registry.current(harness.current)) ? harness.current : v.registry.active()[0])
  return id ? v.registry.stop(id) : false
}

export async function renameSession(id: string, title: string): Promise<void> {
  const v = vault()
  if (!v) return
  await ensureSession(v, id)
  await v.store.rename(id, title)
  await refreshSessions()
}

export async function archiveSession(id: string): Promise<void> {
  const v = vault()
  if (!v || !(await v.store.load(id))) return
  await v.store.archive(id)
  if (harness.current === id) harness.current = null
  await refreshSessions()
}

/** Hand a mention to a session's composer (it takes them on its next render). */
export function queueMention(sessionId: string, mention: Mention): void {
  harness.inbox[sessionId] = [...(harness.inbox[sessionId] ?? []), mention]
}

/** The composer takes its waiting mentions. */
export function takeMentions(sessionId: string): Mention[] {
  const waiting = harness.inbox[sessionId] ?? []
  if (waiting.length) delete harness.inbox[sessionId]
  return waiting
}

/** Open a session's tab through the shell (the commands' door). */
export function openSession(id: string): void {
  harness.current = id
  shell?.openView('session', id)
}

/**
 * The selection in the editor showing `path` (the focused one when it does)
 * as a `lines` mention — what `ai.new-session` / `ai.add-selection` /
 * `ai.run-skill` capture. Null when no editor shows it or nothing is selected.
 */
export async function captureFocusedSelection(path: string | null): Promise<Mention | null> {
  const editor = path ? editorFor(path) : null
  const sel = editor ? selectionOf(editor) : null
  return sel ? captureNoteSelection(sel) : null
}

/**
 * A selection in a note → a `lines` mention: snapshot, hash, and — on an
 * enrolled note, whose editor text IS its Y.Text — the anchor pair.
 */
export async function captureNoteSelection(sel: { path: string; text: string; from: number; to: number }): Promise<Mention> {
  const hash = await noteHash(sel.path)
  const doc = vault()?.workspace.docForPath(sel.path)
  const anchor = doc ? encodeRange(ytextOf(doc), sel.from, sel.to) : undefined
  return captureSelection({ ...sel, ...(hash ? { hash } : {}), ...(anchor ? { anchor } : {}) })
}
