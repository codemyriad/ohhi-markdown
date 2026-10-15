<script lang="ts" module>
  import type { TranslationFunctions } from '@ohhi/i18n'
  import { isProposalResult } from '@ohhi/harness'
  import { toolNameOf, type ToolPart } from './ToolCard.svelte'

  /** What a call counts as in the run's line; `failed` is counted apart, in the error tone. */
  type Kind = 'read' | 'search' | 'list' | 'proposed' | 'edited' | 'other'

  const kindOf = (part: ToolPart): Kind => {
    const name = toolNameOf(part)
    if (isProposalResult(part.output)) return !part.output.proposed ? 'other' : part.output.applied ? 'edited' : 'proposed'
    if (name === 'ohhi_read') return 'read'
    if (name === 'ohhi_search') return 'search'
    if (name === 'ohhi_ls') return 'list'
    if (/_(patch|write|append)$/.test(name)) return 'proposed'
    return 'other'
  }

  /**
   * A run's one line: a phrase per kind of call, in the order the agent first
   * did each ("Read 3 notes · searched twice · listed a folder · proposed 1
   * edit"), and how many calls failed. Thinking is never counted.
   */
  export function runSummary(parts: ToolPart[], LL: TranslationFunctions): { text: string; failed: string } {
    const r = LL.web.ai.session.run_line
    const counts = new Map<Kind, number>()
    let failed = 0
    for (const part of parts) {
      if (part.state === 'output-error') failed++
      else counts.set(kindOf(part), (counts.get(kindOf(part)) ?? 0) + 1)
    }
    const phrase = (kind: Kind, count: number): string => {
      switch (kind) {
        case 'read':
          return r.read({ count })
        case 'search':
          return count === 1 ? r.search_once() : count === 2 ? r.search_twice() : r.search_many({ count })
        case 'list':
          return r.list({ count })
        case 'proposed':
          return r.proposed({ count })
        case 'edited':
          return r.edited({ count })
        default:
          return r.other({ count })
      }
    }
    const joined = [...counts].map(([kind, count]) => phrase(kind, count)).join(' · ')
    const text = joined ? joined.charAt(0).toLocaleUpperCase() + joined.slice(1) : ''
    const failedText = failed ? r.failed({ count: failed }) : ''
    return { text, failed: text ? failedText : failedText.charAt(0).toLocaleUpperCase() + failedText.slice(1) }
  }

  /** A run's expanded state, by `<message id>:<first part>`, for as long as the page is open. */
  const remembered = new Map<string, boolean>()
</script>

<script lang="ts">
  /**
   * A run of tool calls and Thinking in the transcript (QA round 1, "a bit
   * busy"): folded by default to ONE quiet line — what the agent did, counted
   * per kind, the failed calls in the error tone, and › at the right end. The
   * whole line is the toggle, a real button with `aria-expanded`; it unfolds
   * into the rows (`ToolCard`, `ThinkingRow`), each with its own *Details*.
   *
   * The run in progress is open, so the calls can be watched, and folds once
   * the answer arrives; a press is remembered per run while the page is open.
   * A run of Thinking alone is its own line already — no summary over it.
   * Folded rows stay mounted (`hidden`), so a row keeps its *Details* open.
   */
  import { ChevronRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { UIMessage } from 'ai'
  import { META } from '../ui/styles.js'
  import ThinkingRow from './ThinkingRow.svelte'
  import ToolCard from './ToolCard.svelte'

  type Part = UIMessage['parts'][number]

  interface Props {
    /** `<message id>:<first part's index>`: the run's identity while the page is open. */
    runKey: string
    items: { j: number; part: Part }[]
    /** Still arriving: the agent is working in this run, nothing after it yet. */
    live?: boolean
  }

  let { runKey, items, live = false }: Props = $props()

  const rowsId = $props.id()
  const isTool = (part: { type: string }): boolean => part.type.startsWith('tool-') || part.type === 'dynamic-tool'
  const tools = $derived(items.filter((i) => isTool(i.part)).map((i) => i.part as unknown as ToolPart))
  const summary = $derived(runSummary(tools, $LL))
  /** A press here, else one remembered from an earlier mount; else open while live. */
  let chosen = $state<boolean | undefined>(undefined)
  const expanded = $derived(chosen ?? remembered.get(runKey) ?? live)

  function toggle(): void {
    chosen = !expanded
    remembered.set(runKey, chosen)
  }
</script>

<div class="flex flex-col gap-0.5" data-testid="session-tool-run" data-expanded={tools.length ? expanded : true}>
  {#if tools.length}
    <button
      type="button"
      class="{META} group flex min-h-5 w-full items-center gap-1.5 rounded text-start hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      aria-expanded={expanded}
      aria-controls={rowsId}
      data-testid="session-run-toggle"
      onclick={toggle}
    >
      <span class="min-w-0 truncate"
        ><span data-testid="session-run-summary">{summary.text}</span>{#if summary.failed}{summary.text ? ' · ' : ''}<span
            class="text-error"
            data-testid="session-run-failed">{summary.failed}</span
          >{/if}</span
      >
      <ChevronRight size={12} aria-hidden="true" class="ms-auto shrink-0 transition-transform {expanded ? 'rotate-90' : ''}" />
    </button>
  {/if}
  <div
    id={rowsId}
    class="{tools.length && !expanded ? 'hidden' : 'flex'} flex-col gap-0.5"
    hidden={tools.length ? !expanded : false} data-testid="session-run-rows">
    {#each items as item (item.j)}
      {#if item.part.type === 'reasoning'}
        <ThinkingRow text={(item.part as { text: string }).text} />
      {:else}
        <ToolCard part={item.part as unknown as ToolPart} />
      {/if}
    {/each}
  </div>
</div>
