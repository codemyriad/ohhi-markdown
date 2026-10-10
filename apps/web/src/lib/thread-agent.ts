/**
 * Send to agent (writing-harness-shaping B8): a comment ticked *Send to
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
 * Kept out of `threads.svelte.ts` on purpose: the registry there is part of
 * the workspace's import graph, and this module reaches the harness (the AI
 * SDK) through `sessions.svelte.ts`.
 */
import { getLL } from '@ohhi/i18n'
import type { Mention, RunRecord } from '@ohhi/harness'
import type { ThreadStore } from '@ohhi/workspace'
import type { FlashInput } from './notices.js'
import { mentionOf } from './references.js'
import { captureNoteSelection, harness, runReply, startRun, type RunHandle, type StartRunInput } from './sessions.svelte.js'
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

/**
 * Answer the thread's newest unanswered comment to the agent. Resolves with
 * the run's record once the reply is posted (or the run ended without one);
 * null when there was nothing to answer or no run could start.
 */
export async function askAgent(deps: AskAgentDeps, path: string, threadId: string): Promise<RunRecord | null> {
  const w = getLL().web.ai.comments
  const store = deps.workspace.threadsFor(path)
  const thread = store?.threads().find((t) => t.id === threadId)
  const comment = thread ? [...thread.comments].reverse().find((c) => c.to?.includes('agent') && !c.answered) : undefined
  if (!store || !thread || !comment) return null

  const range = store.rangeOf(thread)
  const ref = range ? await deps.mention(path, store, range) : mentionOf({ kind: 'file', path })
  const input = { instruction: comment.body, refs: [ref], threadId, open: false } satisfies StartRunInput
  const current = deps.session()
  const handle = (current ? await deps.startRun({ ...input, sessionId: current }) : null) ?? (await deps.startRun(input))
  if (!handle) {
    deps.flash?.({ level: 'info', text: w.thread_not_started() })
    return null
  }

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
  flash?: (input: FlashInput) => void
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
    threadId
  )
}
