/**
 * The tool loop over a host (writing-harness-shaping B2, Fork 1-A): AI SDK
 * 7's `ToolLoopAgent` with the harness's prompt and the contract's tools,
 * streamed as UI message chunks — what `@ai-sdk/svelte`'s `Chat` consumes in
 * the app and what `ohhi ask` prints in a terminal.
 *
 * The host owns time and the network: `host.fetch` reaches the provider,
 * `host.clock` schedules the provider's `timeoutSec`, the caller's `signal`
 * is the person's *Stop*.
 */
import {
  convertToModelMessages,
  isStepCount,
  ToolLoopAgent,
  toUIMessageStream,
  type ToolLoopAgentSettings,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { callSettings, createModel } from './model.js'
import { systemPrompt } from './prompt.js'
import { HarnessTimeoutError, withTimeout } from './timeout.js'
import { toolsFromContract } from './tools.js'
import type { AgentHost, AgentOrigin, Mention, ProviderConfig, RunRecord, SkillMeta, UIMessageJson } from './types.js'

/** The loop's step budget: enough to narrow, read and answer; not enough to wander. */
export const MAX_STEPS = 12

export interface HarnessAgent {
  stream(messages: UIMessageJson[], opts: { signal?: AbortSignal }): Promise<ReadableStream<UIMessageChunk>>
  /** The last finished run's token usage; undefined while running, after an error or a cancel. */
  lastUsage(): RunRecord['usage'] | undefined
}

/** The tool loop over a host. */
export function createHarnessAgent(
  host: AgentHost,
  opts: { provider: ProviderConfig; skill?: { meta: SkillMeta; body: string }; refs: Mention[]; mutates: boolean; origin: AgentOrigin },
): HarnessAgent {
  let usage: RunRecord['usage'] | undefined

  return {
    async stream(messages, { signal }) {
      usage = undefined
      const instructions = systemPrompt({ skills: await host.skills.list(), skill: opts.skill, refs: opts.refs })
      const tools = toolsFromContract(host.backend, { mutates: opts.mutates, proposeEdit: host.proposeEdit, origin: opts.origin })
      const agent = new ToolLoopAgent<never, ToolSet>({
        model: createModel(opts.provider, host.fetch),
        instructions,
        tools,
        stopWhen: isStepCount(MAX_STEPS),
        ...callSettings(opts.provider),
        // The error reaches the caller as the stream's error part; without
        // this the SDK also dumps it on the console (and on `ohhi ask`'s stderr).
        onError: () => {},
      } as ToolLoopAgentSettings<never, ToolSet>)
      // The prompt is ours: a `system` message in a stored session is not
      // instructions to the model.
      const ui = messages.filter((m) => m.role !== 'system') as unknown as UIMessage[]
      const modelMessages = await convertToModelMessages(ui, { tools, ignoreIncompleteToolCalls: true })
      const timer = withTimeout(host.clock, opts.provider.timeoutSec, signal)
      let result
      try {
        result = await agent.stream({
          messages: modelMessages,
          abortSignal: timer.signal,
          onEnd: (event) => {
            usage = { input: event.totalUsage.inputTokens ?? 0, output: event.totalUsage.outputTokens ?? 0 }
          },
        })
      } catch (err) {
        timer.done()
        throw err
      }
      const chunks = toUIMessageStream({ stream: result.stream, tools, onError: errorText })
      // Release the timeout however the stream ends — finished, errored or cancelled.
      return chunks.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            if (chunk.type === 'error' || chunk.type === 'abort') usage = undefined
            // A timeout is a failure, not the person's Stop: the run says why.
            if (chunk.type === 'abort' && timer.timedOut()) {
              controller.enqueue({ type: 'error', errorText: new HarnessTimeoutError(opts.provider.timeoutSec ?? 0).message })
              return
            }
            controller.enqueue(chunk)
          },
          flush: () => timer.done(),
          cancel: () => timer.done(),
        } as Transformer<UIMessageChunk, UIMessageChunk>),
      )
    },
    lastUsage: () => usage,
  }
}

/**
 * The words an error chunk carries. The SDK's default is a generic "An
 * error occurred." — the person needs the provider's own message (a bad key,
 * an unknown model, a refused origin) to fix it.
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return typeof error === 'string' ? error : JSON.stringify(error)
}
