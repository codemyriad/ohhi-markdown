<script lang="ts">
  /**
   * The comment bubble (writing-harness-shaping B8): `ui/Popover` hung off
   * the selection (or a thread's gutter marker). Two faces:
   *
   * - **new** — a textarea and two buttons: *Comment* (primary: saves the
   *   thread, nothing else) and *Send to agent* (secondary, the one AI-gated
   *   thing here: shown only when `ai`, a provider exists, R1), which saves
   *   the thread with `to: ['agent']` AND asks the agent; the reply lands in
   *   the thread.
   * - **thread** — its comments in order, *Reply*, *Resolve* / *Reopen*,
   *   and any edit the agent proposed answering it (a suggestion carrying
   *   the thread's id) with *Accept* / *Reject*.
   *
   * Where *Send to agent* goes is implicit and said quietly under the buttons
   * (QA round 1, round 2: no checkbox, no select): "Sends to ‹the current
   * session›", or "Starts a new session" when there is none. With more than
   * one session that line is a small text button opening a `DropdownMenu` of
   * the sessions and *New session*; with one or none it is plain text. Once
   * sent, the thread's "Sent to the agent" / "Answered" carries *Open session*.
   *
   * *Send to agent* starts the run from here — the gesture, never a store
   * change, so a synced copy of the comment does not start a second one
   * (`thread-agent.ts`).
   *
   * Comments themselves are not an AI feature and work with no provider.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { SuggestionRecord, ThreadRecord } from '@ohhi/workspace'
  import { melt } from '@melt-ui/svelte'
  import { ChevronDown } from '@lucide/svelte'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import Field from '../ui/Field.svelte'
  import Popover from '../ui/Popover.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { META, OUTLINE_BUTTON } from '../ui/styles.js'
  import { liveThreads, type BubbleRequest } from '../threads.svelte.js'
  import { agentSessions, sendThreadToAgent, sessionForThread, type AgentTarget } from '../thread-agent.js'
  import { openSession } from '../sessions.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'

  type SuggestionVerbs = 'suggestionsFor' | 'acceptSuggestion' | 'rejectSuggestion' | 'subscribeSuggestions' | 'flash'

  interface Props {
    request: BubbleRequest
    workspace: Pick<Workspace, 'threadsFor' | 'addThread' | 'reply' | 'resolveThread'> & Partial<Pick<Workspace, SuggestionVerbs>>
    /** A provider exists: offer *Send to agent*. */
    ai: boolean
    onClose: () => void
    /** Ask the agent about a new thread; the app's run door (`thread-agent.ts`) unless a test hands one in. */
    onSendToAgent?: (path: string, threadId: string, target: AgentTarget) => void
  }

  let { request, workspace, ai, onClose, onSendToAgent }: Props = $props()

  const t = $derived($LL.web.ai.comments)
  const live = liveThreads(() => workspace.threadsFor(request.path))
  const thread = $derived<ThreadRecord | null>(
    request.kind === 'thread' ? (live.list.find((x) => x.id === request.threadId) ?? null) : null
  )
  /** Where the thread's passage is now; null = the text is gone. */
  const range = $derived(thread && live.store ? live.store.rangeOf(thread) : null)

  /** Bumped on every suggestion change in the note, so the list below re-reads. */
  let suggestionTick = $state(0)
  $effect(() => workspace.subscribeSuggestions?.(request.path, () => suggestionTick++))
  /** The agent's open proposals answering this thread (B8: shown in the bubble with accept/reject). */
  const proposals = $derived.by((): SuggestionRecord[] => {
    void suggestionTick
    if (!thread || !workspace.suggestionsFor) return []
    return workspace
      .suggestionsFor(request.path)
      .filter((sg) => sg.threadId === thread.id && (sg.status === 'pending' || sg.status === 'stale'))
  })
  function decide(sg: SuggestionRecord, accept: boolean): void {
    if (accept) workspace.acceptSuggestion?.(request.path, sg.id)
    else workspace.rejectSuggestion?.(request.path, sg.id)
    suggestionTick++
  }

  let body = $state('')
  /** The sessions it could go to, the current one first (empty with no provider). */
  const sessions = $derived(ai ? agentSessions() : [])
  /** The person's pick from the menu; null = the default (the current session, else a new one). */
  let picked = $state<string | 'new' | null>(null)
  const goesTo = $derived.by((): AgentTarget => {
    if (picked === 'new') return 'new'
    const id = picked ?? sessions[0]?.id
    return id ? { sessionId: id } : 'new'
  })
  const goesToTitle = $derived(
    typeof goesTo === 'object' ? (sessions.find((s) => s.id === goesTo.sessionId)?.title ?? null) : null
  )
  const whereLine = $derived(goesToTitle !== null ? t.sends_to({ title: goesToTitle }) : t.starts_new())
  /** The session the thread was sent to, for *Open session*. */
  const sentTo = $derived(thread ? sessionForThread(thread.id) : null)

  const primary = 'rounded bg-primary px-3 py-1 text-xs text-primary-content hover:bg-primary/90 disabled:opacity-50'
  const outline = `${OUTLINE_BUTTON} px-3 py-1 text-xs`

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    if (request.kind === 'new') {
      // *Send to agent* is the form's second submitter; *Comment* (and Mod+Enter) only saves.
      const asking = ai && (e.submitter as HTMLElement | null)?.dataset.send === 'agent'
      const added = workspace.addThread(request.path, {
        from: request.from,
        to: request.to,
        body: text,
        ...(asking ? { sendTo: ['agent'] as 'agent'[] } : {}),
      })
      if (added && asking) {
        if (onSendToAgent) onSendToAgent(request.path, added.id, goesTo)
        else void sendThreadToAgent(workspace, request.path, added.id, workspace.flash, goesTo)
      }
      onClose()
    } else if (thread) {
      workspace.reply(request.path, thread.id, { body: text })
      body = ''
    }
  }

  /** Mod+Enter sends, as a comment box does everywhere else. */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).closest('form')?.requestSubmit()
    }
  }
</script>

<Popover
  anchor={request.anchor}
  title={request.kind === 'new' ? t.bubble_new() : t.bubble_thread()}
  testid="comment-bubble"
  openFocus="textarea"
  {onClose}
>
  <form class="flex w-80 flex-col gap-2 p-3 text-sm" onsubmit={submit}>
    {#if request.kind === 'thread'}
      {#if thread}
        {#if range === null}
          <p class="text-xs text-base-content/70">{t.gone()}</p>
        {/if}
        <ol class="flex max-h-64 flex-col gap-2 overflow-y-auto" data-testid="comment-thread">
          {#each thread.comments as c (c.id)}
            <li class="flex flex-col gap-0.5" data-testid="comment:{c.id}">
              <span class="flex items-center gap-2 text-xs">
                <span class="font-semibold">{c.author}</span>
                {#if c.answered}
                  <span class="text-base-content/70">{t.answered()}</span>
                {:else if c.to?.includes('agent')}
                  <span class="text-base-content/70">{t.sent_to_agent()}</span>
                {/if}
                {#if (c.answered || c.to?.includes('agent')) && sentTo && ai}
                  <span class="text-base-content/70" aria-hidden="true">·</span>
                  <button
                    type="button"
                    class="text-xs text-base-content/80 underline hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                    data-testid="comment-open-session"
                    onclick={() => {
                      openSession(sentTo)
                      onClose()
                    }}>{t.open_session()}</button
                  >
                {/if}
              </span>
              <span class="whitespace-pre-wrap">{c.body}</span>
            </li>
          {/each}
        </ol>
        {#if proposals.length}
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {#each proposals as sg (sg.id)}
              <li class="flex flex-col gap-1 rounded border border-base-300 p-2 text-xs" data-testid="comment-suggestion">
                <span class="font-semibold">{t.thread_suggestion()}</span>
                {#if sg.baseText}
                  <del class="whitespace-pre-wrap text-base-content/70">{sg.baseText}</del>
                {/if}
                {#if sg.proposedText}
                  <ins class="whitespace-pre-wrap no-underline">{sg.proposedText}</ins>
                {/if}
                {#if sg.status === 'stale'}
                  <span class="text-base-content/70">{t.thread_suggestion_stale()}</span>
                {/if}
                <span class="flex justify-end gap-2">
                  <button type="button" class={outline} data-testid="comment-suggestion-reject" onclick={() => decide(sg, false)}
                    >{t.reject()}</button
                  >
                  {#if sg.status === 'pending'}
                    <button type="button" class={primary} data-testid="comment-suggestion-accept" onclick={() => decide(sg, true)}
                      >{t.accept()}</button
                    >
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if thread.resolved}
          <p class="text-xs text-base-content/70">{t.resolved()}</p>
        {/if}
      {/if}
      <Field name="reply">
        <TextControl label={t.reply_field()} bind:value={body} multiline rows={2} testid="comment-body" onkeydown={onKeydown} />
      </Field>
      <div class="flex items-center justify-end gap-2">
        {#if thread}
          <button
            type="button"
            class={outline}
            data-testid="comment-resolve"
            onclick={() => {
              const resolving = !thread.resolved
              workspace.resolveThread(request.path, thread.id, resolving)
              if (resolving) onClose()
            }}>{thread.resolved ? t.reopen() : t.resolve()}</button
          >
        {/if}
        <button type="submit" class={primary} disabled={!body.trim() || !thread} data-testid="comment-submit"
          >{t.reply()}</button
        >
      </div>
    {:else}
      <Field name="comment">
        <TextControl label={t.field()} bind:value={body} multiline rows={3} testid="comment-body" onkeydown={onKeydown} />
      </Field>
      <div class="flex items-center justify-end gap-2">
        <!-- No Cancel: Escape and a click outside close the bubble (QA round 2: two buttons). -->
        {#if ai}
          <button type="submit" class={outline} disabled={!body.trim()} data-send="agent" data-testid="comment-send-agent"
            >{t.send_agent()}</button
          >
        {/if}
        <button type="submit" class={primary} disabled={!body.trim()} data-testid="comment-submit">{t.comment()}</button>
      </div>
      {#if ai}
        {#if sessions.length > 1}
          <div class="flex justify-end">
            <DropdownMenu placement="bottom-end" testid="comment-send-target-menu">
              {#snippet trigger(attrs)}
                <button
                  use:melt={attrs}
                  type="button"
                  data-testid="comment-send-target"
                  class="{META} inline-flex max-w-full items-center gap-0.5 rounded hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span class="truncate">{whereLine}</span>
                  <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" class="shrink-0" />
                </button>
              {/snippet}
              {#snippet children({ item, separator })}
                {#each sessions as s (s.id)}
                  <MenuItem
                    {item}
                    checked={typeof goesTo === 'object' && goesTo.sessionId === s.id}
                    testid="comment-send-target:{s.id}"
                    onSelect={() => (picked = s.id)}>{s.title}</MenuItem
                  >
                {/each}
                <MenuSeparator {separator} />
                <MenuItem {item} checked={goesTo === 'new'} testid="comment-send-target:new" onSelect={() => (picked = 'new')}
                  >{t.new_session()}</MenuItem
                >
              {/snippet}
            </DropdownMenu>
          </div>
        {:else}
          <p class="{META} m-0 truncate text-right" data-testid="comment-send-target">{whereLine}</p>
        {/if}
      {/if}
    {/if}
  </form>
</Popover>
