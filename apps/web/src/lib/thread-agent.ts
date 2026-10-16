/**
 * Send to agent (writing-harness-shaping B8): a comment sent with *Send to
 * agent* (`to: ['agent']`) becomes one run — the thread's passage as a
 * `lines` mention, the comment as the instruction, `threadId` on the run and
 * on its origin (so a proposal it makes carries the thread, and the bubble
 * shows it with accept/reject). When the run finishes, its answer is the
 * thread's reply and the comment is marked answered.
 *
 * Started from the gesture that wrote the comment (the bubble), never from a
 * store change: a peer's comment syncs into every open copy of the note, and
 * each of them answering it would be one run per device.
 *
 * Which session (QA round 1, "new or existing?"): the bubble says where it
 * will go — the current session by title, else a new one — and, with more
 * than one session, lets the person pick another or a new one (`AgentTarget`). A new session is titled after the
 * comment's place ("Comment on plan.md (lines 3–4)"), never the comment's
 * raw text. The session a thread went to is remembered on this device
 * (`sessionForThread`), so the thread can say *Open session* and the
 * session's turn can say *Show thread*.
 *
 * Kept out of `threads.svelte.ts` on purpose: the registry there is part of
 * the workspace's import graph, and this module reaches the harness (the AI
 * SDK) through `sessions.svelte.ts`.
 */
import { getLL } from '@ohhi/i18n'
import { SvelteMap } from 'svelte/reactivity'
import type { Mention, RunRecord } from '@ohhi/harness'
import type { ThreadStore } from '@ohhi/workspace'
import type { FlashInput } from './notices.js'
import { mentionOf } from './references.js'
import { captureNoteSelection, harness, runReply, sessionTitle, startRun, type RunHandle, type StartRunInput } from './sessions.svelte.js'
import type { Workspace } from './workspace.svelte.js'

export interface AskAgentDeps {
  workspace: Pick<Workspace, 'threadsFor' | 'reply'>
  startRun(input: StartRunInput): Promise<RunHandle | null>
  /** A finished run's answer. */
  reply(handle: RunHandle): string | null
  /** The thread's passage as a mention (snapshot, hash, anchor). */
  mention(path: string, store: ThreadStore, range: { from: number; to: number }): Promise<Mention>
  /** The session to run in first (the current one); a new one when it is busy or absent. */
  session(): string | null
  flash?(input: FlashInput): void
}

/** Where *Send to agent* sends: the current session, a new one, or a session the person picked. */
export type AgentTarget = 'current' | 'new' | { sessionId: string }

/** The session each thread was sent to, on this device (reactive: the bubble's *Open session* reads it). */
const threadSessions = new SvelteMap<string, string>()

/** The session a thread was sent to: remembered here, else the session whose last run answered it. */
export function sessionForThread(threadId: string): string | null {
  return threadSessions.get(threadId) ?? harness.list.find((s) => s.lastRun?.threadId === threadId)?.id ?? null
}

/** The session *Send to agent* would use as "current": its id and title, or null when there is none. */
export function currentAgentSession(): { id: string; title: string } | null {
  const id = harness.current
  return id ? { id, title: sessionTitle(id) ?? getLL().web.ai.session.untitled() } : null
}

/**
 * The sessions *Send to agent* can go to: the current one first (even before
 * its file exists — a tab opened but not yet sent from), then the vault's
 * others, newest activity first.
 */
export function agentSessions(): { id: string; title: string }[] {
  const untitled = getLL().web.ai.session.untitled()
  const current = currentAgentSession()
  const rest = harness.list.filter((s) => s.id !== current?.id).map((s) => ({ id: s.id, title: s.title ?? untitled }))
  return current ? [current, ...rest] : rest
}

/** A new session's title for a comment: the note's name and the passage's lines, never the comment's words. */
export function commentSessionTitle(path: string, ref: Mention): string {
  const w = getLL().web.ai.comments
  const note = path.split('/').pop() ?? path
  if (ref.ref.kind !== 'lines') return w.session_title({ note })
  const { from, to } = ref.ref.lines
  return from === to ? w.session_title_line({ note, line: from }) : w.session_title_lines({ note, from, to })
}

/**
 * Answer the thread's newest unanswered comment to the agent. Resolves with
 * the run's record once the reply is posted (or the run ended without one);
 * null when there was nothing to answer or no run could start.
 */
export async function askAgent(
  deps: AskAgentDeps,
  path: string,
  threadId: string,
  target: AgentTarget = 'current'
): Promise<RunRecord | null> {
  const w = getLL().web.ai.comments
  const store = deps.workspace.threadsFor(path)
  const thread = store?.threads().find((t) => t.id === threadId)
  const comment = thread ? [...thread.comments].reverse().find((c) => c.to?.includes('agent') && !c.answered) : undefined
  if (!store || !thread || !comment) return null

  const range = store.rangeOf(thread)
  const ref = range ? await deps.mention(path, store, range) : mentionOf({ kind: 'file', path })
  const input = { instruction: comment.body, refs: [ref], threadId, open: false } satisfies StartRunInput
  // The session asked for (the current one by default) when it is free; a new one otherwise.
  // Only a NEW session is named after the comment's place: one the person
  // already has open keeps its name (an untitled one stays untitled), so
  // its tab is still the tab they had — never retitled into what looks like
  // a different session (QA round 2, "I had a session open in a tab, now I don't").
  const current = target === 'new' ? null : target === 'current' ? deps.session() : target.sessionId
  const handle =
    (current ? await deps.startRun({ ...input, sessionId: current, title: null }) : null) ??
    (await deps.startRun({ ...input, title: commentSessionTitle(path, ref) }))
  if (!handle) {
    deps.flash?.({ level: 'info', text: w.thread_not_started() })
    return null
  }
  threadSessions.set(threadId, handle.sessionId)

  const run = await handle.done
  const answer = run.status === 'successful' ? deps.reply(handle) : null
  if (answer) {
    deps.workspace.reply(path, threadId, { author: getLL().web.ai.session.agent(), body: answer, answering: comment.id })
    deps.workspace.threadsFor(path)?.markAnswered(threadId, comment.id)
  } else if (run.status === 'failed') {
    deps.flash?.({ level: 'warn', text: w.thread_failed({ error: run.error ?? '' }) })
  }
  return run
}

/** In the app: `startRun`, the session last focused, the selection capture. */
export function sendThreadToAgent(
  workspace: AskAgentDeps['workspace'],
  path: string,
  threadId: string,
  flash?: (input: FlashInput) => void,
  target: AgentTarget = 'current'
): Promise<RunRecord | null> {
  return askAgent(
    {
      workspace,
      startRun,
      reply: runReply,
      mention: (p, store, range) => captureNoteSelection({ path: p, text: store.text(), ...range }),
      session: () => harness.current,
      ...(flash ? { flash } : {}),
    },
    path,
    threadId,
    target
  )
}
