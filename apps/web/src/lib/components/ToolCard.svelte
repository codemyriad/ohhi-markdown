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
   * One quiet row (QA round 1, feedback 13): a glyph per tool kind, the
 * summary, and *Details* ▸ at the right end — a real button with
 * `aria-expanded` that unfolds the input and output in a compact monospace
 * block under the row. Hits, a proposal's diff and its verbs sit indented
 * under the row. Opening a note
   * is the shell's verb (`ViewShell.openPath`); with no shell it is text.
   */
  import { ChevronRight, FileText, FolderTree, Link, PencilLine, Search, Sparkles, Wrench } from '@lucide/svelte'
  import { isProposalResult } from '@ohhi/harness'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { formatBytes } from '../storage-persistence.js'
  import { harnessWorkspace } from '../sessions.svelte.js'
  import { getViewShell } from '../views.js'
  import { META } from '../ui/styles.js'

  interface Props {
    part: ToolPart
  }

  let { part }: Props = $props()

  const shell = getViewShell()
  const detailsId = $props.id()
  /** *Details* open: per card, for as long as the transcript keeps it mounted. */
  let expanded = $state(false)
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
  /** The row's glyph, by what the tool does: find, read, list, write, a skill, links; else a wrench. */
  const Icon = $derived(
    proposal || /_(patch|write|append)$/.test(name)
      ? PencilLine
      : name === 'ohhi_search'
        ? Search
        : name === 'ohhi_read'
          ? FileText
          : name === 'ohhi_ls'
            ? FolderTree
            : name === 'ohhi_skill'
              ? Sparkles
              : /links/.test(name)
                ? Link
                : Wrench
  )
  /** The *Details* toggle: small, muted, at the row's right end. */
  const toggle =
    'inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[11px] text-base-content/70 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary'
  const link = 'text-xs text-base-content/80 underline hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary'
  const verb =
    'rounded border border-base-300 bg-base-100 px-2 py-0.5 text-xs font-medium text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
</script>

<div data-testid="tool-card" data-tool={name} data-state={part.state} class="{META} flex flex-col">
  <div class="flex min-h-5 items-center gap-1.5 {failed ? 'text-error' : ''}">
    <Icon size={14} class="shrink-0" aria-hidden="true" />
    <span data-testid="tool-summary" class="min-w-0 truncate">{summary}</span>
    {#if hits.length}
      <span class="shrink-0">· {t.results({ count: hits.length })}</span>
    {/if}
    {#if reviewable}
      <span
        data-testid="proposal-status"
        data-status={status}
        class="ms-auto shrink-0 rounded-full bg-base-200 px-2 text-[11px] text-base-content"
      >
        {t.proposal_status[status]()}
      </span>
    {:else if proposal?.proposed && shell}
      <button type="button" class={link} data-testid="tool-open" onclick={() => shell.openPath(proposal.path, { beside: true })}>{t.open()}</button>
    {/if}
    {#if done || failed}
      <button
        type="button"
        class="{reviewable ? '' : 'ms-auto'} {toggle}"
        aria-expanded={expanded}
        aria-controls={detailsId}
        data-testid="tool-details-toggle"
        onclick={() => (expanded = !expanded)}
        >{t.details()}<ChevronRight size={12} aria-hidden="true" class="transition-transform {expanded ? 'rotate-90' : ''}" /></button
      >
    {/if}
  </div>
  {#if (done || failed) && expanded}
    <div id={detailsId} data-testid="tool-details" class="ms-5 mt-0.5 mb-1 flex flex-col gap-1 rounded bg-base-200 px-2 py-1 text-base-content">
      <pre class="m-0 max-h-48 overflow-auto font-ed-mono text-[11px] whitespace-pre-wrap">{json(part.input)}</pre>
      {#if done}
        <pre class="m-0 max-h-48 overflow-auto border-t border-base-300 pt-1 font-ed-mono text-[11px] whitespace-pre-wrap">{json(part.output)}</pre>
      {/if}
    </div>
  {/if}
  {#if reviewable && record}
    <p class="proposal-diff m-0 ms-5 mt-0.5 border-l-2 border-base-300 bg-ed-surface py-0.5 pl-2 font-ed-mono text-[11px] whitespace-pre-wrap" data-testid="proposal-diff">
      {#if record.baseText}<del class:stale={status === 'stale'}>{clip(record.baseText)}</del>{/if}
      {#if record.baseText && record.proposedText}{' '}{/if}
      {#if record.proposedText}<ins class:stale={status === 'stale'}>{clip(record.proposedText)}</ins>{/if}
    </p>
  {/if}
  {#if reviewable && shell}
    <div class="ms-5 mt-1 mb-0.5 flex flex-wrap items-center gap-1.5" data-testid="proposal-actions">
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
    <ul class="m-0 ms-5 mt-0.5 flex list-none flex-col gap-0.5 p-0" data-testid="tool-hits">
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
