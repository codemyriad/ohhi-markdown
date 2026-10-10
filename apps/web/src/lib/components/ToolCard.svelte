<script lang="ts" module>
  /** A tool part as the AI SDK streams it (`tool-<name>` or `dynamic-tool`). */
  export interface ToolPart {
    type: string
    toolName?: string
    toolCallId?: string
    state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string
    input?: unknown
    output?: unknown
    errorText?: string
  }

  /** The tool's name: from the part type (`tool-ohhi_search`) or, for a dynamic tool, its field. */
  export function toolNameOf(part: Pick<ToolPart, 'type' | 'toolName'>): string {
    return part.type === 'dynamic-tool' ? (part.toolName ?? '') : part.type.replace(/^tool-/, '')
  }
</script>

<script lang="ts">
  /**
   * One tool call in the transcript (writing-harness-shaping B4), keyed on
   * `part.state`: working while the input streams, then a one-line account
   * of what the agent did — never the raw payload up front.
   *
   *  - `ohhi_search` → "Searched for “q”", its hits as references with *Open*
   *  - `ohhi_read` → "Read §Decisions of plan.md (1.2 kB)"
   *  - a proposal (`ohhi.proposal.v1`, F) → "Proposed an edit in plan.md",
   *    linking to the note — the suggestion is reviewed THERE, never applied
   *    from the chat
   *  - anything else → "Used ohhi_links"
   *
   * *Details* folds the input and output away for the curious. Opening a note
   * is the shell's verb (`ViewShell.openPath`); with no shell it is text.
   */
  import { FileText } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { formatBytes } from '../storage-persistence.js'
  import { getViewShell } from '../views.js'

  interface Props {
    part: ToolPart
  }

  let { part }: Props = $props()

  const shell = getViewShell()
  const t = $derived($LL.web.ai.session.tool)
  const name = $derived(toolNameOf(part))
  const input = $derived((part.input ?? {}) as Record<string, unknown>)
  const output = $derived((part.output ?? null) as Record<string, unknown> | null)
  const done = $derived(part.state === 'output-available')
  const failed = $derived(part.state === 'output-error')

  const hits = $derived(
    name === 'ohhi_search' && done && Array.isArray(output?.hits)
      ? (output.hits as { path: string; line: number | null }[])
      : []
  )
  const proposal = $derived(output?.schema === 'ohhi.proposal.v1' ? (output as { path: string; proposed: boolean }) : null)

  const summary = $derived.by((): string => {
    if (failed) return t.failed({ name, message: part.errorText ?? '' })
    if (!done) return t.running()
    if (proposal) return t.proposed({ path: proposal.path })
    if (name === 'ohhi_search') return t.search({ query: String(input.query ?? '') })
    if (name === 'ohhi_read' && output) {
      const path = String(output.path ?? input.path ?? '')
      const text = typeof output.text === 'string' ? output.text : null
      const size = formatBytes(text !== null ? new TextEncoder().encode(text).length : Number(output.size ?? 0))
      const what =
        typeof input.section === 'string'
          ? t.read_section({ section: input.section, path })
          : output.mode === 'lines' && typeof output.from === 'number' && typeof output.to === 'number'
            ? t.read_lines({ from: output.from, to: output.to, path })
            : path
      return t.read({ what, size })
    }
    return t.used({ name })
  })

  const json = (v: unknown): string => {
    try {
      return JSON.stringify(v, null, 2) ?? ''
    } catch {
      return String(v)
    }
  }
  const link = 'text-xs text-base-content/80 underline hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary'
</script>

<div
  data-testid="tool-card"
  data-tool={name}
  data-state={part.state}
  class="rounded-md border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs text-base-content/80"
>
  <p class="m-0 flex items-center gap-1.5 {failed ? 'text-error' : ''}">
    <span data-testid="tool-summary">{summary}</span>
    {#if hits.length}
      <span class="text-base-content/70">· {t.results({ count: hits.length })}</span>
    {/if}
    {#if proposal && shell}
      <button type="button" class={link} data-testid="tool-open" onclick={() => shell.openPath(proposal.path)}>{t.open()}</button>
    {/if}
  </p>
  {#if hits.length}
    <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0" data-testid="tool-hits">
      {#each hits.slice(0, 8) as hit (hit.path)}
        <li class="flex items-center gap-1.5">
          <FileText size={12} aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{hit.path}{hit.line ? `:${hit.line}` : ''}</span>
          {#if shell}
            <button type="button" class={link} onclick={() => shell.openPath(hit.path)}>{t.open()}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if done || failed}
    <details class="mt-1">
      <summary class="cursor-pointer text-base-content/70">{t.details()}</summary>
      <pre class="m-0 mt-1 max-h-48 overflow-auto font-ed-mono text-[11px] whitespace-pre-wrap">{json(part.input)}</pre>
      {#if done}
        <pre class="m-0 mt-1 max-h-48 overflow-auto font-ed-mono text-[11px] whitespace-pre-wrap">{json(part.output)}</pre>
      {/if}
    </details>
  {/if}
</div>
