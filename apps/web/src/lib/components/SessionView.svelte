<script lang="ts">
  /**
   * The Session view: a view tab whose argument is the session id — header,
   * transcript, composer. Listed only while a provider exists
   * (`ViewContext.ai()`), and a stored Session tab is not restored without
   * one; if the last provider goes while it is open, it says where to add one
   * instead of offering a composer.
   *
   * It holds nothing that must outlive it: the transcript is the run
   * registry's `Chat` and the turn is the registry's run
   * (`sessions.svelte.ts`), so closing the tab mid-run leaves the run going
   * and reopening the session shows it still streaming.
   *
   * With no messages it is the session's FIRST SCREEN (QA round 1,
   * Explorations S1): bottom-anchored over the composer — which keeps its
   * place and takes the keyboard — the starts (ask about the note you came
   * from, summarise it, run a skill, continue the last session), the recent
   * sessions as a list (title, the note it was about, when, the provider),
   * and, on a vault's very first session only, the egress sentence: where
   * the words will go.
   */
  import type { UIMessage } from 'ai'
  import { untrack } from 'svelte'
  import type { Chat } from '@ai-sdk/svelte'
  import { anySelection } from '../focused-editor.svelte.js'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { providerHost, type Mention } from '@ohhi/harness'
  import { AtSign, FileText, History, Slash } from '@lucide/svelte'
  import type { SessionSummary } from '../session-store.js'
  import { mentionOf } from '../references.js'
  import type { Clock } from '@ohhi/vault'
  import { providerView } from '../config.js'
  import { aiConfig, aiEnabled } from '../ai-config.svelte.js'
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
    retryInput,
    runFor,
    sessionTitle,
    skillSource,
    startRun,
    stopRun,
    takeComposerFocus,
    takeMentions,
  } from '../sessions.svelte.js'
  import { getViewShell, shellClock, type ViewProps } from '../views.js'
  import SessionComposer, { type ComposerSend } from './SessionComposer.svelte'
  import SessionHeader from './SessionHeader.svelte'
  import SessionTranscript from './SessionTranscript.svelte'
  import { EYEBROW, META, MUTED } from '../ui/styles.js'

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
  // A chosen provider stays chosen (a send on a deleted one says so); the last
  // run's provider is only a default while it still exists.
  const lastProvider = $derived(run?.provider && providers.some((p) => p.id === run.provider) ? run.provider : null)
  const providerId = $derived(chosenProvider ?? lastProvider ?? resolveProvider()?.id ?? '')
  const others = $derived(harness.list.filter((s) => s.id !== sessionId))

  /** The note the person was last in: this tab's own pane has none. */
  let lastNote = $state<string | null>(null)
  $effect(() => {
    const p = workspace.ui.selectedPath
    if (p) lastNote = p
  })

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
      const sel = anySelection()
      return sel ? { path: sel.path, lines: linesOfRange(sel.text, sel.from, sel.to) } : null
    },
    skills: () => skillSource().list(),
  }

  /** Mentions a start hands the composer (*Ask about…*), beside the ones commands queue. */
  let startMentions = $state<Mention[]>([])
  let composerRef = $state<{ begin(text: string): void } | null>(null)
  /**
   * The composer takes the keyboard only when a person just opened this
   * session (`requestComposerFocus` — a door, a key, a palette row, a
   * start): on mount, or later while already mounted (switched to). A tab
   * restored at startup, or a re-render, leaves the keyboard where it is.
   */
  // svelte-ignore state_referenced_locally -- read once, at mount
  const focusOnMount = untrack(() => takeComposerFocus(sessionId))
  $effect(() => {
    if (!harness.focusComposer || !composerRef) return
    const ref = composerRef
    if (untrack(() => takeComposerFocus(sessionId))) ref.begin('')
  })
  const noteName = $derived(lastNote ? (lastNote.split('/').pop() ?? lastNote) : '')
  const noteMention = (): Mention | null => (lastNote ? mentionOf({ kind: 'file', path: lastNote }) : null)

  /** *Ask about ‹note›*: the note as a chip in the composer, the keyboard there. */
  function askAbout(): void {
    const m = noteMention()
    if (m) startMentions = [...startMentions, m]
  }

  /** *Summarise ‹note›*: a turn of its own, with the note as its reference. */
  function summarise(): void {
    const m = noteMention()
    if (m) void send({ text: t.starts.summarise_prompt(), refs: [m] })
  }

  /** The note a session was about: its last run's references — one note by name, several by count. */
  function aboutOf(s: SessionSummary): string {
    const paths = [...new Set((s.lastRun?.input.refs ?? []).map((r) => r.ref.path))]
    if (paths.length === 0) return ''
    return paths.length === 1 ? (paths[0].split('/').pop() ?? paths[0]) : t.recent_notes({ count: paths.length })
  }
  const providerName = (id: string | undefined): string => (id ? (providers.find((p) => p.id === id)?.name ?? id) : '')

  /** The vault's first session: no other, nothing said yet — the one place the egress sentence is said. */
  const firstEver = $derived(harness.list.every((s) => s.id === sessionId))
  const egress = $derived.by(() => {
    const p = providers.find((x) => x.id === providerId)
    return p ? $LL.web.ai.providers.egress({ name: p.name, host: providerHost(p) }) : ''
  })

  async function captureLines(): Promise<Mention | null> {
    const sel = anySelection()
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

  /** The last turn again: its instruction, references, skill and thread, on the chosen provider. */
  async function retry(): Promise<void> {
    const last = run
    if (!last) return
    void startRun({ sessionId, ...(await retryInput(last)), ...(providerId ? { providerId } : {}), open: false })
  }

  const incoming = $derived(harness.inbox[sessionId] ?? [])
  const lastAt = (at: number): string => relativeTime(at, $tick, $LL)
  /**
   * The first screen's rhythm (QA round 1, "empty space feels off"): the
   * settings' 8 px grid — an eyebrow with 16 px above the first and 24 px
   * above the next, 8 px under it — and quiet list rows, no boxes: a hover
   * tint, a muted icon, the label, the time at the right in META.
   */
  const eyebrow = `m-0 mb-2 px-2 ${EYEBROW}`
  const listRow =
    'flex w-full min-h-8 items-center gap-2 rounded px-2 py-1 text-left text-[13px] text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
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
          onclick={() => shell.openSettings('ai')}>{t.open_settings()}</button
        >
      {/if}
    </div>
  {:else}
    <SessionHeader
      {sessionId}
      {title}
      {run}
      sessions={harness.list}
      {clock}
      onRename={(next) => void renameSession(sessionId, next)}
      onNew={() => openSession(newSessionId())}
      onPick={(id) => openSession(id)}
      onArchive={() => void archiveSession(sessionId)}
      onStop={() => stopRun(sessionId)}
      onRetry={() => void retry()}
    />
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 {messages.length === 0 ? 'pt-4 pb-3' : 'py-3'}">
      {#if messages.length === 0}
        <!-- The first screen (S1): from the top, under the header; the composer stays at the foot. -->
        <div data-testid="session-empty" class="flex flex-col">
          <section aria-labelledby="{tab.id}-starts" class="flex flex-col">
            <h2 id="{tab.id}-starts" class={eyebrow}>{t.starts.title()}</h2>
            <ul class="m-0 flex list-none flex-col p-0" data-testid="session-starts">
              {#if lastNote}
                <li>
                  <button type="button" class={listRow} data-testid="session-start-ask" onclick={askAbout}>
                    <AtSign size={14} class="shrink-0 {MUTED}" aria-hidden="true" />
                    <span class="min-w-0 truncate">{t.starts.ask({ note: noteName })}</span>
                  </button>
                </li>
                <li>
                  <button type="button" class={listRow} data-testid="session-start-summarise" disabled={busy} onclick={summarise}>
                    <FileText size={14} class="shrink-0 {MUTED}" aria-hidden="true" />
                    <span class="min-w-0 truncate">{t.starts.summarise({ note: noteName })}</span>
                  </button>
                </li>
              {/if}
              <li>
                <button type="button" class={listRow} data-testid="session-start-skill" onclick={() => composerRef?.begin('/')}>
                  <Slash size={14} class="shrink-0 {MUTED}" aria-hidden="true" />
                  <span class="min-w-0 truncate">{t.starts.skill()}</span>
                </button>
              </li>
              {#if others.length}
                <li>
                  <button type="button" class={listRow} data-testid="session-start-continue" onclick={() => openSession(others[0].id)}>
                    <History size={14} class="shrink-0 {MUTED}" aria-hidden="true" />
                    <span class="min-w-0 truncate">{t.starts.continue({ title: others[0].title ?? t.untitled() })}</span>
                    <span class="ml-auto shrink-0 {META}">{lastAt(others[0].lastAt)}</span>
                  </button>
                </li>
              {/if}
            </ul>
          </section>
          {#if others.length}
            <section aria-labelledby="{tab.id}-recent" class="mt-6 flex flex-col">
              <h2 id="{tab.id}-recent" class={eyebrow}>{t.recent()}</h2>
              <ul class="m-0 flex list-none flex-col p-0" data-testid="session-recent">
                {#each others.slice(0, 8) as s (s.id)}
                  {@const about = aboutOf(s)}
                  {@const via = providerName(s.provider)}
                  <li>
                    <button
                      type="button"
                      data-testid="session-recent:{s.id}"
                      class="{listRow} flex-col items-stretch gap-0"
                      onclick={() => openSession(s.id)}
                    >
                      <span class="flex w-full items-baseline gap-2">
                        <span class="min-w-0 flex-1 truncate">{s.title ?? t.untitled()}</span>
                        <span class="shrink-0 {META}">{lastAt(s.lastAt)}</span>
                      </span>
                      {#if about || via}
                        <span class="flex min-w-0 gap-2 {META}">
                          {#if about}<span class="min-w-0 truncate font-ed-mono">{about}</span>{/if}
                          {#if via}<span class="shrink-0">{via}</span>{/if}
                        </span>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
          {#if firstEver && egress}
            <p class="m-0 mt-6 px-2 text-xs text-base-content/80" data-testid="session-egress">{egress}</p>
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
      bind:this={composerRef}
      {sessionId}
      {busy}
      {sources}
      {captureLines}
      incoming={[...incoming, ...startMentions]}
      {providers}
      {providerId}
      onProvider={(id) => (chosenProvider = id)}
      onManageProviders={shell ? () => shell.openSettings('ai') : undefined}
      autofocus={focusOnMount}
      onTaken={() => {
        takeMentions(sessionId)
        startMentions = []
      }}
      checkChanged={changedMentions}
      onSend={send}
    />
  {/if}
</section>
