<script lang="ts">
  /**
   * The Session view (writing-harness-shaping B4): a view tab whose argument
   * is the session id — header, transcript, composer. Listed only while a
   * provider exists (`ViewContext.ai()`, R1); if the last provider goes while
   * it is open, it says where to add one instead of offering a composer.
   *
   * It holds nothing that must outlive it: the transcript is the run
   * registry's `Chat` and the turn is the registry's run
   * (`sessions.svelte.ts`), so closing the tab mid-run leaves the run going
   * and reopening the session shows it still streaming. With no messages the
   * body lists the vault's recent sessions.
   */
  import type { UIMessage } from 'ai'
  import type { Chat } from '@ai-sdk/svelte'
  import { selectionIn } from '@ohhi/editor/src/composer.js'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Mention } from '@ohhi/harness'
  import type { Clock } from '@ohhi/vault'
  import { aiConfig, aiEnabled, providerView } from '../config.js'
  import type { MentionSources } from '../composer-mentions.js'
  import { linesOfRange } from '../references.js'
  import { relativeTime, clockTick } from '../relative-time.js'
  import {
    archiveSession,
    captureNoteSelection,
    changedMentions,
    chatFor,
    ensureHarness,
    focusSession,
    harness,
    harnessClock,
    harnessIndex,
    newSessionId,
    openSession,
    renameSession,
    resolveProvider,
    runFor,
    sessionTitle,
    skillSource,
    startRun,
    stopRun,
    takeMentions,
  } from '../sessions.svelte.js'
  import { getViewShell, shellClock, type ViewProps } from '../views.js'
  import SessionComposer, { type ComposerSend } from './SessionComposer.svelte'
  import SessionHeader from './SessionHeader.svelte'
  import SessionTranscript from './SessionTranscript.svelte'

  interface Props extends ViewProps {
    /** Injected for the tests; the shell's clock otherwise. */
    clock?: Clock
  }

  let { workspace, tab, clock = harnessClock() ?? shellClock() }: Props = $props()

  // The vault's harness exists before anything below reads it (reads never build).
  ensureHarness()
  const shell = getViewShell()
  const t = $derived($LL.web.ai.session)
  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)

  /** A tab opened with no argument still needs one session: minted once. */
  // svelte-ignore state_referenced_locally -- seed only
  const fallbackId = tab.viewArg ? '' : newSessionId()
  const sessionId = $derived(tab.viewArg ?? fallbackId)

  // The session this view shows is the current one while it is on screen.
  $effect(() => focusSession(sessionId))

  let chat = $state.raw<Chat<UIMessage> | null>(null)
  $effect(() => {
    const id = sessionId
    chat = null
    let stale = false
    void chatFor(id)?.then((c) => {
      if (!stale) chat = c
    })
    return () => {
      stale = true
    }
  })

  const messages = $derived(chat?.messages ?? [])
  const streaming = $derived(chat?.status === 'streaming' || chat?.status === 'submitted')
  const run = $derived(runFor(sessionId))
  const busy = $derived(run?.status === 'scheduled' || run?.status === 'running')
  const title = $derived(sessionTitle(sessionId))
  const enabled = $derived(aiEnabled())
  const providers = $derived(enabled ? aiConfig().providers.map(providerView) : [])
  let chosenProvider = $state<string | null>(null)
  const providerId = $derived(chosenProvider ?? run?.provider ?? resolveProvider()?.id ?? '')
  const others = $derived(harness.list.filter((s) => s.id !== sessionId))

  /** The note the person was last in: this tab's own pane has none. */
  let lastNote = $state<string | null>(null)
  $effect(() => {
    const p = workspace.ui.selectedPath
    if (p) lastNote = p
  })

  /** A live selection in a note on screen (another pane), with that note's path. */
  function noteSelection(): { path: string; text: string; from: number; to: number } | null {
    for (const pane of document.querySelectorAll<HTMLElement>('[data-pane-id]')) {
      const editor = pane.querySelector<HTMLElement>('[data-testid^="editor-pane"]')
      const sel = selectionIn(editor)
      if (!sel) continue
      const path = pane.querySelector<HTMLElement>('[data-path]:has([role="tab"][aria-selected="true"])')?.dataset.path
      const known = path ?? lastNote
      if (known) return { path: known, ...sel }
    }
    return null
  }

  const sources: MentionSources = {
    quickOpen: async (q) => {
      const index = harnessIndex()
      if (!index) return []
      const page = await index.quickOpen(q, { limit: 20 })
      return page.items.map((h) => ({ path: h.path, spans: h.spans }))
    },
    folders: () => workspace.ui.files.filter((f) => f.kind === 'dir' || f.kind === 'mount').map((f) => f.path),
    currentNote: () => lastNote,
    headings: async (path) => {
      const guid = workspace.ui.files.find((f) => f.path === path)?.guid
      const index = harnessIndex()
      return guid && index ? index.headings(guid) : []
    },
    selection: () => {
      const sel = noteSelection()
      return sel ? { path: sel.path, lines: linesOfRange(sel.text, sel.from, sel.to) } : null
    },
    skills: () => skillSource().list(),
  }

  async function captureLines(): Promise<Mention | null> {
    const sel = noteSelection()
    return sel ? captureNoteSelection(sel) : null
  }

  async function send(s: ComposerSend): Promise<boolean> {
    const skill = s.skill ? { meta: s.skill, body: (await skillSource().body(s.skill.name)) ?? '' } : undefined
    const handle = await startRun({
      sessionId,
      instruction: s.text,
      refs: s.refs,
      ...(skill ? { skill } : {}),
      ...(providerId ? { providerId } : {}),
      open: false,
    })
    return handle !== null
  }

  function retry(): void {
    const last = run
    if (!last) return
    void startRun({ sessionId, instruction: last.input.instruction, refs: last.input.refs, providerId, open: false })
  }

  const incoming = $derived(harness.inbox[sessionId] ?? [])
  const lastAt = (at: number): string => relativeTime(at, $tick, $LL)
</script>

<section
  data-testid="session-view"
  data-session={sessionId}
  aria-label={title ? t.title_named({ name: title }) : t.title()}
  class="flex h-full min-h-0 flex-col bg-base-100 text-sm text-base-content"
>
  {#if !enabled}
    <div class="m-auto flex max-w-sm flex-col items-center gap-2 p-4 text-center" data-testid="session-no-provider">
      <p class="m-0 text-base-content/80">{t.no_provider()}</p>
      {#if shell}
        <button
          type="button"
          class="rounded border border-base-300 px-2 py-1 text-xs hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          onclick={() => shell.openSettings()}>{t.open_settings()}</button
        >
      {/if}
    </div>
  {:else}
    <SessionHeader
      {sessionId}
      {title}
      {run}
      sessions={harness.list}
      {providers}
      {providerId}
      {clock}
      onProvider={(id) => (chosenProvider = id)}
      onRename={(next) => void renameSession(sessionId, next)}
      onNew={() => openSession(newSessionId())}
      onPick={(id) => openSession(id)}
      onArchive={() => void archiveSession(sessionId)}
      onStop={() => stopRun(sessionId)}
      onRetry={retry}
    />
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {#if messages.length === 0}
        <div data-testid="session-empty" class="flex flex-col gap-3">
          <p class="m-0 text-base-content/80">{t.empty()}</p>
          {#if others.length}
            <div>
              <h3 class="m-0 mb-1 text-[11px] font-semibold tracking-wide text-base-content/70 uppercase">{t.recent()}</h3>
              <ul class="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="session-recent">
                {#each others.slice(0, 8) as s (s.id)}
                  <li>
                    <button
                      type="button"
                      data-testid="session-recent:{s.id}"
                      class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                      onclick={() => openSession(s.id)}
                    >
                      <span class="min-w-0 flex-1 truncate">{s.title ?? t.untitled()}</span>
                      <span class="shrink-0 text-[11px] text-base-content/70">{lastAt(s.lastAt)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {:else}
        <SessionTranscript {messages} {streaming} />
      {/if}
      {#if run?.status === 'failed' && run.error}
        <p class="m-0 mt-3 text-xs text-error" role="status" data-testid="session-error">{t.failed({ message: run.error })}</p>
      {/if}
    </div>
    <SessionComposer
      {sessionId}
      {busy}
      {sources}
      {captureLines}
      {incoming}
      onTaken={() => takeMentions(sessionId)}
      checkChanged={changedMentions}
      onSend={send}
    />
  {/if}
</section>
