<script lang="ts">
  /**
   * A reasoning part in the transcript: one quiet row, *Thinking* ▸, the same
   * shape as a tool call's row (`ToolCard`) so it sits in a run of them
   * (QA round 1, feedback 13). The toggle is a real button with
   * `aria-expanded`; the text unfolds under it, per row, while the session is
   * open.
   */
  import { Brain, ChevronRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { META, MUTED } from '../ui/styles.js'

  interface Props {
    text: string
  }

  let { text }: Props = $props()

  const id = $props.id()
  let expanded = $state(false)
</script>

<div data-testid="session-reasoning" class="{META} flex flex-col">
  <div class="flex min-h-5 items-center gap-1.5">
    <Brain size={14} class="shrink-0 {MUTED}" aria-hidden="true" />
    <button
      type="button"
      class="inline-flex items-center gap-0.5 rounded text-base-content/70 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      aria-expanded={expanded}
      aria-controls={id}
      data-testid="session-reasoning-toggle"
      onclick={() => (expanded = !expanded)}
      >{$LL.web.ai.session.reasoning()}<ChevronRight size={12} aria-hidden="true" class="transition-transform {expanded ? 'rotate-90' : ''}" /></button
    >
  </div>
  {#if expanded}
    <p {id} class="m-0 ms-5 mt-0.5 mb-1 rounded bg-base-200 px-2 py-1 text-[11px] whitespace-pre-wrap text-base-content">{text}</p>
  {/if}
</div>
