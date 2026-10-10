<script lang="ts">
  /**
   * The comment bubble (writing-harness-shaping B8): `ui/Popover` hung off
   * the selection (or a thread's gutter marker). Two faces:
   *
   * - **new** — a textarea, *Comment*, and *Send to agent*, which is the one
   *   AI-gated thing here: shown only when `ai` (a provider exists, R1). It
   *   sets `to: ['agent']` on the comment and nothing more — F starts the
   *   run and appends the reply.
   * - **thread** — its comments in order, *Reply*, *Resolve* / *Reopen*.
   *
   * Comments themselves are not an AI feature and work with no provider.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ThreadRecord } from '@ohhi/workspace'
  import CheckControl from '../ui/CheckControl.svelte'
  import Field from '../ui/Field.svelte'
  import Popover from '../ui/Popover.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import { liveThreads, type BubbleRequest } from '../threads.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'

  interface Props {
    request: BubbleRequest
    workspace: Pick<Workspace, 'threadsFor' | 'addThread' | 'reply' | 'resolveThread'>
    /** A provider exists: offer *Send to agent*. */
    ai: boolean
    onClose: () => void
  }

  let { request, workspace, ai, onClose }: Props = $props()

  const t = $derived($LL.web.ai.comments)
  const live = liveThreads(() => workspace.threadsFor(request.path))
  const thread = $derived<ThreadRecord | null>(
    request.kind === 'thread' ? (live.list.find((x) => x.id === request.threadId) ?? null) : null
  )
  /** Where the thread's passage is now; null = the text is gone. */
  const range = $derived(thread && live.store ? live.store.rangeOf(thread) : null)

  let body = $state('')
  let sendToAgent = $state(false)

  const primary = 'rounded bg-primary px-3 py-1 text-xs text-primary-content hover:bg-primary/90 disabled:opacity-50'
  const outline = `${OUTLINE_BUTTON} px-3 py-1 text-xs`

  function submit(e: SubmitEvent): void {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    if (request.kind === 'new') {
      workspace.addThread(request.path, {
        from: request.from,
        to: request.to,
        body: text,
        ...(ai && sendToAgent ? { sendTo: ['agent'] as 'agent'[] } : {}),
      })
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
              </span>
              <span class="whitespace-pre-wrap">{c.body}</span>
            </li>
          {/each}
        </ol>
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
      {/if}
      <div class="flex items-center justify-end gap-2">
        <button type="button" class={outline} onclick={onClose}>{$LL.common.cancel()}</button>
        <button type="submit" class={primary} disabled={!body.trim()} data-testid="comment-submit">{t.comment()}</button>
      </div>
    {/if}
  </form>
</Popover>
