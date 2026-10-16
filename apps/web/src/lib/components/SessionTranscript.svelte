<script lang="ts">
  /**
   * The transcript (writing-harness-shaping B4): the `Chat`'s messages,
   * rendered part by part with our own components — the AI SDK's `parts` are
   * the model, Melt + tokens the chrome.
   *
   *  - `text` → the person's words as typed (their chips are `@label` text,
   *    with the references listed under them); the agent's through
   *    `SessionMarkdown`, streaming while it is the open message
   *  - `reasoning` → a *Thinking* ▸ row (`ThinkingRow`), folded; an empty one, nothing
   *  - `tool-*` / `dynamic-tool` → a `ToolCard` row, keyed on its state
   *
   *    Consecutive reasoning and tool rows form ONE run (`ToolRun`): folded
   *    to one quiet line of what the agent did, open while it is the live
   *    one (QA round 1: one line per call, then one line per run).
   *  - anything else (step boundaries, sources, data parts) → nothing
   *
   * A turn a comment asked (*Send to agent*, `metadata.threadId`) says so
   * under it, with *Show thread*: the thread's bubble in its note, the note
   * opened beside when it is not on screen (`ViewShell.revealThread`, the
   * path *Show in note* takes).
   *
   * A `log` region, so a screen reader hears new turns without the stream
   * being read character by character (the log role's polite default).
   */
  import type { UIMessage } from 'ai'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Mention } from '@ohhi/harness'
  import { getViewShell } from '../views.js'
  import SessionMarkdown from './SessionMarkdown.svelte'
  import ToolRun from './ToolRun.svelte'

  interface Props {
    messages: UIMessage[]
    /** The last message is still arriving. */
    streaming?: boolean
  }

  let { messages, streaming = false }: Props = $props()

  const t = $derived($LL.web.ai.session)
  const c = $derived($LL.web.ai.comments)
  const shell = getViewShell()

  type Part = UIMessage['parts'][number]
  const isTool = (part: { type: string }): boolean => part.type.startsWith('tool-') || part.type === 'dynamic-tool'
  /** A row in a run: a tool call, or reasoning with something in it (an empty one is not worth a row). */
  const isRow = (part: Part): boolean => isTool(part) || (part.type === 'reasoning' && part.text.trim() !== '')
  /**
   * A message's parts as the transcript lays them out: each text part on its
   * own, and every stretch of tool calls and reasoning between them as ONE
   * tight run of rows. Keyed by the first part's index, which only appending
   * never moves — a row keeps its *Details* open while the stream grows.
   */
  type Segment =
    | { kind: 'text'; j: number; part: Extract<Part, { type: 'text' }> }
    | { kind: 'run'; j: number; items: { j: number; part: Part }[] }
  const segmentsOf = (parts: Part[]): Segment[] => {
    const out: Segment[] = []
    parts.forEach((part, j) => {
      if (part.type === 'text') out.push({ kind: 'text', j, part })
      else if (isRow(part)) {
        const last = out.at(-1)
        if (last?.kind === 'run') last.items.push({ j, part })
        else out.push({ kind: 'run', j, items: [{ j, part }] })
      }
    })
    return out
  }
  /** The comment thread a turn answers, and its note (the turn's first reference). */
  const threadOf = (m: UIMessage): { id: string; path: string } | null => {
    const id = (m.metadata as { threadId?: string } | undefined)?.threadId
    const path = refsOf(m)[0]?.ref.path
    return typeof id === 'string' && path ? { id, path } : null
  }
  const refsOf = (m: UIMessage): Mention[] => {
    const refs = (m.metadata as { refs?: Mention[] } | undefined)?.refs
    return Array.isArray(refs) ? refs : []
  }
</script>

<div role="log" aria-label={t.transcript()} data-testid="session-transcript" class="flex flex-col gap-3">
  {#each messages as message, i (message.id)}
    {@const open = streaming && i === messages.length - 1 && message.role === 'assistant'}
    <article
      data-testid="session-message"
      data-role={message.role}
      aria-label={message.role === 'user' ? t.you() : t.agent()}
      class={message.role === 'user'
        ? 'self-end max-w-[85%] rounded-lg bg-base-200 px-3 py-2 text-sm text-base-content'
        : 'flex flex-col gap-2'}
    >
      {#each segmentsOf(message.parts) as seg (seg.j)}
        {#if seg.kind === 'text'}
          {#if message.role === 'user'}
            <p class="m-0 whitespace-pre-wrap">{seg.part.text}</p>
          {:else}
            <SessionMarkdown source={seg.part.text} streaming={open && seg.j === message.parts.length - 1} />
          {/if}
        {:else}
          <ToolRun runKey="{message.id}:{seg.j}" items={seg.items} live={open && !message.parts.slice(seg.j).some((p) => p.type === 'text')} />
        {/if}
      {/each}
      {#if message.role === 'user' && threadOf(message)}
        {@const th = threadOf(message)!}
        <p class="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-base-content/80" data-testid="session-message-thread">
          <span>{c.from_comment({ note: th.path.split('/').pop() ?? th.path })}</span>
          {#if shell}
            <button
              type="button"
              class="underline hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
              data-testid="session-show-thread"
              onclick={() => void shell.revealThread(th.path, th.id)}>{c.show_thread()}</button
            >
          {/if}
        </p>
      {/if}
      {#if message.role === 'user' && refsOf(message).length}
        <ul class="m-0 mt-1 flex list-none flex-wrap gap-1 p-0" data-testid="session-message-refs">
          {#each refsOf(message) as ref (ref.id)}
            <li class="rounded bg-base-100 px-1.5 py-0.5 text-[11px] text-base-content/80">@{ref.label}</li>
          {/each}
        </ul>
      {/if}
    </article>
  {/each}
</div>
