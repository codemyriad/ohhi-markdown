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
   * One tool call in the transcript, keyed on
   * `part.state`: working while the input streams, then a one-line account
   * of what the agent did — never the raw payload up front.
   *
   *  - `ohhi_search` → "Searched for “q”", its hits as references with *Open*
   *  - `ohhi_read` → "Read §Decisions of plan.md (1.2 kB)"
   *  - a proposal (`ohhi.proposal.v1`) → "Proposed an edit in plan.md",
   *    with the change as a diff, its status read from the ONE suggestion
   *    record (pending · changed since · applied · no longer proposed —
   *    `SuggestionStore` through the workspace, never a copy), and Accept /
   *    Reject / *Show in note* (QA round 1, Explorations D/C). Every verb
   *    reveals the suggestion in its note first (`ViewShell.revealSuggestion`:
   *    where the note is, else opened beside) and Accept / Reject then run
   *    the registry's caret rows — the same path as the pair and the keys
   *  - anything else → "Used ohhi_links"
   *
   * *Details* folds the input and output away for the curious. Opening a note
   * is the shell's verb (`ViewShell.openPath`); with no shell it is text.
   */
  import { FileText } from '@lucide/svelte'
  import { isProposalResult } from '@ohhi/harness'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { formatBytes } from '../storage-persistence.js'
  import { harnessWorkspace } from '../sessions.svelte.js'
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
  const proposal = $derived(isProposalResult(part.output) ? part.output : null)

  /** A proposal still to be reviewed through its record: proposed, not applied as it landed, with an id. */
  const reviewable = $derived(proposal?.proposed && !proposal.applied && proposal.suggestionId ? proposal : null)
  /** Bumped whenever the note's suggestions change: the record is re-read, never kept. */
  let recordTick = $state(0)
  $effect(() => {
    const p = reviewable?.path
    if (!p) return
    return harnessWorkspace()?.subscribeSuggestions(p, () => recordTick++)
  })
  const record = $derived.by(() => {
    void recordTick
    if (!reviewable) return null
    return harnessWorkspace()?.suggestionsFor(reviewable.path).find((r) => r.id === reviewable.suggestionId) ?? null
  })
  /** The record's status; `gone` when there is none (rejected, or the note's in-memory records were dropped). */
  const status = $derived(record?.status === 'rejected' ? 'gone' : (record?.status ?? 'gone'))
  let acting = $state(false)

  /** Reveal the suggestion in its note, then run a registry row on it (the caret is in it). */
  async function act(commandId: string): Promise<void> {
    if (!shell || !reviewable?.suggestionId || acting) return
    acting = true
    try {
      if (await shell.revealSuggestion(reviewable.path, reviewable.suggestionId)) shell.runCommand(commandId)
    } finally {
      acting = false
    }
  }

  /** *Show in note*: the suggestion revealed with the caret in it, so the keys act at once; else just the note. */
  async function show(): Promise<void> {
    if (!shell || !reviewable?.suggestionId) return
    const shown = await shell.revealSuggestion(reviewable.path, reviewable.suggestionId, { focus: true })
    if (!shown) shell.openPath(reviewable.path, { beside: true })
  }

  /** The record's change, cut to a glance. */
  const clip = (text: string): string => (text.length > 160 ? `${text.slice(0, 159)}…` : text)

  const summary = $derived.by((): string => {
    if (failed) return t.failed({ name, message: part.errorText ?? '' })
    if (!done) return t.running()
    if (proposal) {
      if (!proposal.proposed) return t.proposal_none({ path: proposal.path })
      return proposal.applied ? t.proposal_applied({ path: proposal.path }) : t.proposed({ path: proposal.path })
    }
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
  const verb =
    'rounded border border-base-300 bg-base-100 px-2 py-0.5 text-xs font-medium text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
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
    {#if reviewable}
      <span
        data-testid="proposal-status"
        data-status={status}
        class="ml-auto shrink-0 rounded-full bg-base-200 px-2 py-0.5 text-[11px] text-base-content"
      >
        {t.proposal_status[status]()}
      </span>
    {:else if proposal?.proposed && shell}
      <button type="button" class={link} data-testid="tool-open" onclick={() => shell.openPath(proposal.path, { beside: true })}>{t.open()}</button>
    {/if}
  </p>
  {#if reviewable && record}
    <p class="proposal-diff m-0 mt-1 border-l-2 border-base-300 bg-ed-surface py-0.5 pl-2 font-ed-mono text-[11px] whitespace-pre-wrap" data-testid="proposal-diff">
      {#if record.baseText}<del class:stale={status === 'stale'}>{clip(record.baseText)}</del>{/if}
      {#if record.baseText && record.proposedText}{' '}{/if}
      {#if record.proposedText}<ins class:stale={status === 'stale'}>{clip(record.proposedText)}</ins>{/if}
    </p>
  {/if}
  {#if reviewable && shell}
    <div class="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="proposal-actions">
      {#if status === 'pending'}
        <button type="button" class={verb} data-testid="proposal-accept" disabled={acting} onclick={() => void act('ai.accept-suggestion')}
          >{t.accept()}</button
        >
      {/if}
      {#if status === 'pending' || status === 'stale'}
        <button type="button" class={verb} data-testid="proposal-reject" disabled={acting} onclick={() => void act('ai.reject-suggestion')}
          >{t.reject()}</button
        >
      {/if}
      <button type="button" class="{link} ml-auto" data-testid="proposal-show" onclick={() => void show()}>{t.show_in_note()}</button>
    </div>
  {/if}
  {#if hits.length}
    <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0" data-testid="tool-hits">
      {#each hits.slice(0, 8) as hit (hit.path)}
        <li class="flex items-center gap-1.5">
          <FileText size={12} aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{hit.path}{hit.line ? `:${hit.line}` : ''}</span>
          {#if shell}
            <button type="button" class={link} onclick={() => shell.openPath(hit.path, { beside: true })}>{t.open()}</button>
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

<style>
  /* The proposal's diff, in the editor's suggestion colours (band B): each
     clears 4.5:1 on --ed-surface, which is why the diff sits on it. */
  .proposal-diff del {
    color: var(--ed-suggest-del);
    text-decoration: line-through;
  }
  .proposal-diff ins {
    color: var(--ed-suggest-add);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .proposal-diff .stale {
    color: var(--ed-suggest-stale);
    text-decoration-style: dashed;
  }
</style>
