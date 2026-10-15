<script lang="ts">
  /**
   * The comment bubble (writing-harness-shaping B8): `ui/Popover` hung off
   * the selection (or a thread's gutter marker). Two faces:
   *
   * - **new** — a textarea, *Comment*, and *Send to agent*, which is the one
   *   AI-gated thing here: shown only when `ai` (a provider exists, R1). It
   *   sets `to: ['agent']` on the comment and asks the agent; the reply
   *   lands in the thread.
   * - **thread** — its comments in order, *Reply*, *Resolve* / *Reopen*,
   *   and any edit the agent proposed answering it (a suggestion carrying
   *   the thread's id) with *Accept* / *Reject*.
   *
   * *Send to agent* says where it goes — the current session by its title,
   * else a new one — with a choice of the other (QA round 1); once sent, the
   * thread's "Sent to the agent" / "Answered" carries *Open session*.
   *
   * *Send to agent* starts the run from here — the gesture, never a store
   * change, so a synced copy of the comment does not start a second one
   * (`thread-agent.ts`).
   *
   * Comments themselves are not an AI feature and work with no provider.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { SuggestionRecord, ThreadRecord } from '@ohhi/workspace'
  import CheckControl from '../ui/CheckControl.svelte'
  import Field from '../ui/Field.svelte'
  import Popover from '../ui/Popover.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import { liveThreads, type BubbleRequest } from '../threads.svelte.js'
  import { currentAgentSession, sendThreadToAgent, sessionForThread, type AgentTarget } from '../thread-agent.js'
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
  let sendToAgent = $state(false)
  /** Where it goes: the current session when there is one, else a new one. */
  const current = $derived(ai ? currentAgentSession() : null)
  let target = $state<AgentTarget>('current')
  const goesTo = $derived<AgentTarget>(current ? target : 'new')
  /** The session the thread was sent to, for *Open session*. */
  const sentTo = $derived(thread ? sessionForThread(thread.id) : null)

  const primary = 'rounded bg-primary px-3 py-1 text-xs text-primary-content hover:bg-primary/90 disabled:opacity-50'
  const outline = `${OUTLINE_BUTTON} px-3 py-1 text-xs`

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    if (request.kind === 'new') {
      const asking = ai && sendToAgent
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
      {#if ai}
        <Field name="send-to-agent">
          <CheckControl label={t.send_agent()} bind:checked={sendToAgent} testid="comment-send-agent" />
        </Field>
        {#if sendToAgent}
          <label class="flex items-center gap-2 text-xs text-base-content/80">
            <span class="shrink-0">{t.send_to()}</span>
            {#if current}
              <select
                bind:value={target}
                data-testid="comment-send-target"
                class="min-w-0 flex-1 truncate rounded border border-base-300 bg-base-100 px-1 py-0.5 text-xs text-base-content focus-visible:outline-2 focus-visible:outline-primary"
              >
                <option value="current">{t.send_to_current({ title: current.title })}</option>
                <option value="new">{t.send_to_new()}</option>
              </select>
            {:else}
              <span class="text-base-content" data-testid="comment-send-target-new">{t.send_to_new()}</span>
            {/if}
          </label>
        {/if}
      {/if}
      <div class="flex items-center justify-end gap-2">
        <button type="button" class={outline} onclick={onClose}>{$LL.common.cancel()}</button>
        <button type="submit" class={primary} disabled={!body.trim()} data-testid="comment-submit">{t.comment()}</button>
      </div>
    {/if}
  </form>
</Popover>
