<script lang="ts">
  /**
   * The transcript (writing-harness-shaping B4): the `Chat`'s messages,
   * rendered part by part with our own components — the AI SDK's `parts` are
   * the model, Melt + tokens the chrome.
   *
   *  - `text` → the person's words as typed (their chips are `@label` text,
   *    with the references listed under them); the agent's through
   *    `SessionMarkdown`, streaming while it is the open message
   *  - `reasoning` → folded into a `<details>`
   *  - `tool-*` / `dynamic-tool` → `ToolCard`, keyed on its state
   *  - anything else (step boundaries, sources, data parts) → nothing
   *
   * A `log` region, so a screen reader hears new turns without the stream
   * being read character by character (the log role's polite default).
   */
  import type { UIMessage } from 'ai'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Mention } from '@ohhi/harness'
  import SessionMarkdown from './SessionMarkdown.svelte'
  import ToolCard, { type ToolPart } from './ToolCard.svelte'

  interface Props {
    messages: UIMessage[]
    /** The last message is still arriving. */
    streaming?: boolean
  }

  let { messages, streaming = false }: Props = $props()

  const t = $derived($LL.web.ai.session)

  const isTool = (part: { type: string }): boolean => part.type.startsWith('tool-') || part.type === 'dynamic-tool'
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
      {#each message.parts as part, j (j)}
        {#if part.type === 'text'}
          {#if message.role === 'user'}
            <p class="m-0 whitespace-pre-wrap">{part.text}</p>
          {:else}
            <SessionMarkdown source={part.text} streaming={open && j === message.parts.length - 1} />
          {/if}
        {:else if part.type === 'reasoning'}
          <details class="text-xs text-base-content/80" data-testid="session-reasoning">
            <summary class="cursor-pointer text-base-content/70">{t.reasoning()}</summary>
            <p class="m-0 mt-1 whitespace-pre-wrap">{part.text}</p>
          </details>
        {:else if isTool(part)}
          <ToolCard part={part as unknown as ToolPart} />
        {/if}
      {/each}
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
