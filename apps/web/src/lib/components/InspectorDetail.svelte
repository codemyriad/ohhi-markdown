<script lang="ts">
  /**
   * One file's detail (devtools-shaping second pass, E1–E3): ONE component in
   * three widths — the right column of a wide inspector, the drawer over the
   * list of a narrow one, and the whole pane of a view tab opened on a path.
   *
   * It renders; it does not read. The inspector owns the refresh model (the
   * selected file re-reads on its record's flips) and hands the results in,
   * so a column, a drawer and a tab can never disagree about when to re-read.
   * The tab form gets its data from its own `Inspector` instance, which
   * renders only this.
   */
  import { FileText, FolderSearch, ScanSearch, SquareArrowOutUpRight, X } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { PathPeek, SyncRecordFields } from '@ohhi/workspace'
  import { formatSize, formatStamp } from '../history.js'
  import {
    defaultPeekView,
    LINK_GLYPH,
    lineDiff,
    linkTone,
    peekChain,
    RELAY_GLYPH,
    RELAY_TONE,
    STATE_TONE,
    TONE_DOT,
    TONE_TEXT,
    TONE_TINT,
    type PeekView,
    type ReportRow,
    type RowState,
  } from '../inspector.js'
  import IconButton from '../ui/IconButton.svelte'
  import { FACT } from '../ui/styles.js'
  import { getViewShell } from '../views.js'
  import type { WorkspaceInspection } from '../workspace.svelte.js'

  interface Props {
    /** The file looked at; null = nothing selected yet. */
    path: string | null
    /** Its classified row from the snapshot (state + inferred chain); null until the snapshot names it. */
    row: ReportRow | null
    record: SyncRecordFields | undefined
    detail: WorkspaceInspection | null
    peek: PathPeek | null
    /** Which width it is drawn at: decides the title row's verbs. */
    form: 'column' | 'drawer' | 'tab' | 'auto'
    now: () => number
    /** The drawer's Close (and its Escape). Absent → no Close. */
    onclose?: () => void
    /** Classes for the Close button (the auto form hides it at the column's width). */
    closeClass?: string
  }

  let { path, row, record, detail, peek, form, now, onclose, closeClass = '' }: Props = $props()

  const shell = getViewShell()
  const t = $derived($LL.web.devtools)
  const uid = $props.id()

  /** Which of the three texts, or which pair's diff; null = the chain's default. */
  let peekView = $state<PeekView | null>(null)
  // A new file starts on its chain's own default view.
  $effect(() => {
    void path
    peekView = null
  })

  /** The chain, with disk vs base measured off the peek's hashes. */
  const chain = $derived(row ? peekChain(row.chain, peek) : null)
  const view = $derived<PeekView | null>(chain ? (peekView ?? defaultPeekView(chain)) : null)
  const DIFFS: readonly PeekView[] = ['doc-lca', 'disk-lca', 'disk-doc']
  const TEXTS: readonly PeekView[] = ['disk', 'lca', 'doc']
  const textOf = (side: 'disk' | 'lca' | 'doc'): string | null =>
    !peek ? null : side === 'disk' ? (peek.disk?.text ?? null) : side === 'lca' ? (peek.lca?.text ?? null) : (peek.doc?.text ?? null)
  /** The peek's body: a diff (`lines`), a text, an absence, or too-large. */
  const body = $derived.by(() => {
    if (!view || !peek) return null
    if (view === 'disk' || view === 'lca' || view === 'doc') {
      const text = textOf(view)
      return text === null ? { kind: 'absent' as const } : { kind: 'text' as const, text }
    }
    const [to, from] =
      view === 'doc-lca' ? (['doc', 'lca'] as const) : view === 'disk-lca' ? (['disk', 'lca'] as const) : (['disk', 'doc'] as const)
    const a = textOf(from)
    const b = textOf(to)
    if (a === null || b === null) return { kind: 'absent' as const }
    if (a === b) return { kind: 'identical' as const }
    const lines = lineDiff(a, b)
    return lines ? { kind: 'diff' as const, lines } : { kind: 'too_large' as const }
  })

  const key = (s: string): string => s.replace('-', '_')
  const stateLabel = (s: RowState): string => t.states[key(s) as keyof typeof t.states]()
  const stateSay = (s: RowState): string => t.say[key(s) as keyof typeof t.say]()
  const peekLabel = (v: PeekView): string => t.peek[key(v) as keyof typeof t.peek]()
  const short = (s: string): string => `${s.slice(0, 8)}…`
  const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

  function age(at: number | null): string {
    if (at === null) return t.never()
    const s = Math.max(0, Math.round((now() - at) / 1000))
    return s < 1 ? t.just_now() : t.seconds_ago({ count: s })
  }

  const segment =
    'px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-base-200 aria-pressed:font-semibold aria-pressed:text-base-content'
</script>

<section
  data-testid="inspector-file"
  data-form={form}
  aria-labelledby="{uid}-title"
  class="flex h-full min-h-0 flex-col bg-base-100"
>
  <!-- title row: the path and its verbs -->
  <div class="flex shrink-0 items-center gap-1 border-b border-base-200 px-3 py-2">
    <h3 id="{uid}-title" class="min-w-0 flex-1 truncate font-ed-mono text-xs font-semibold" title={path ?? undefined}>
      {#if path}{path}{:else}<span class="font-ed-ui font-normal text-base-content/70">{t.detail()}</span>{/if}
    </h3>
    {#if path && shell}
      <IconButton label={t.verbs.open_note()} icon={FileText} testid="inspector-open-note" onclick={() => shell.openPath(path)} />
      <IconButton
        label={t.verbs.reveal()}
        icon={FolderSearch}
        testid="inspector-reveal"
        onclick={() => shell.revealFolder(parent(path))}
      />
      {#if form === 'tab'}
        <IconButton
          label={t.verbs.open_inspector()}
          icon={ScanSearch}
          testid="inspector-open-inspector"
          onclick={() => shell.openView('inspector')}
        />
      {:else}
        <IconButton
          label={t.verbs.own_tab()}
          icon={SquareArrowOutUpRight}
          testid="inspector-own-tab"
          onclick={() => shell.openView('inspector', path)}
        />
      {/if}
    {/if}
    {#if onclose}
      <IconButton label={t.verbs.close()} icon={X} testid="inspector-detail-close" class={closeClass} onclick={onclose} />
    {/if}
  </div>

  {#if !path}
    <p class="px-3 py-2 text-base-content/70">{t.select_row()}</p>
  {:else if !row}
    <p class="px-3 py-2 text-base-content/70">{t.not_found()}</p>
  {:else if chain}
    {@const tone = STATE_TONE[row.state]}
    {@const diverged = row.state === 'diverged'}
    <div class="shrink-0 space-y-2 px-3 py-2">
      <!-- the chain, large, with the state badge -->
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          data-testid="inspector-chain"
          data-chain="{chain.diskLca}:{chain.lcaDoc}:{chain.relay}"
          class="font-ed-mono text-sm"
        >
          <span class="sr-only">
            {t.chain_said({
              diskLca: t.link[chain.diskLca](),
              lcaDoc: t.link[chain.lcaDoc](),
              relay: t.relay_link[chain.relay](),
            })}
          </span>
          <span aria-hidden="true">
            {t.col.disk()}
            <span class="mx-1 {TONE_TEXT[linkTone(chain.diskLca, diverged)]}" title={t.link[chain.diskLca]()}>{LINK_GLYPH[chain.diskLca]}</span>
            {t.col.base()}
            <span class="mx-1 {TONE_TEXT[linkTone(chain.lcaDoc, diverged)]}" title={t.link[chain.lcaDoc]()}>{LINK_GLYPH[chain.lcaDoc]}</span>
            {t.col.doc()}
            <span class="mx-1 font-semibold {TONE_TEXT[RELAY_TONE[chain.relay]]}" title={t.relay_link[chain.relay]()}>{RELAY_GLYPH[chain.relay]}</span>
            {t.col.relay()}
          </span>
        </p>
        <span
          data-testid="inspector-file-state"
          data-state={row.state}
          class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] text-base-content {TONE_TINT[tone]} {diverged ? 'font-semibold' : ''}"
        >
          <span aria-hidden="true" class="size-1.5 rounded-full {TONE_DOT[tone]}"></span>
          {stateLabel(row.state)}
        </span>
      </div>
      <!-- one sentence for the state -->
      <p data-testid="inspector-say" class="text-xs text-base-content/80">{stateSay(row.state)}</p>
      <p class="text-xs text-base-content/80">
        {t.relay_say[chain.relay]()}
        {#if detail}<span class="text-base-content/70"> · {t.versions({ count: detail.journal.count })}</span>{/if}
      </p>

      <!-- the view picker: the three diffs | the three texts -->
      <div data-testid="inspector-peek-view" class="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t.peek.diffs()} class="inline-flex overflow-hidden rounded border border-base-300">
          {#each DIFFS as v (v)}
            <button type="button" data-testid="inspector-peek-view:{v}" aria-pressed={view === v} onclick={() => (peekView = v)} class={segment}
              >{peekLabel(v)}</button
            >
          {/each}
        </div>
        <div role="group" aria-label={t.peek.texts()} class="inline-flex overflow-hidden rounded border border-base-300">
          {#each TEXTS as v (v)}
            <button type="button" data-testid="inspector-peek-view:{v}" aria-pressed={view === v} onclick={() => (peekView = v)} class={segment}
              >{peekLabel(v)}</button
            >
          {/each}
        </div>
      </div>
    </div>

    <!-- the peek fills what is left of the region's height -->
    <div
      data-testid="inspector-peek"
      data-view={view}
      class="mx-3 min-h-24 flex-1 overflow-auto rounded border border-base-300 bg-base-200 font-ed-mono text-[11px]"
    >
      {#if !body || body.kind === 'absent'}
        <p class="px-2 py-1 font-ed-ui text-base-content/70">{t.peek.absent()}</p>
      {:else if body.kind === 'identical'}
        <p class="px-2 py-1 font-ed-ui text-base-content/70">{t.peek.identical()}</p>
      {:else if body.kind === 'too_large'}
        <p class="px-2 py-1 font-ed-ui text-base-content/70">{t.peek.too_large()}</p>
      {:else if body.kind === 'text'}
        <pre class="px-2 py-1 whitespace-pre-wrap">{body.text}</pre>
      {:else}
        <pre class="px-2 py-1 whitespace-pre-wrap">{#each body.lines as line, i (i)}<span
            class={line.kind === 'add'
              ? 'block bg-ed-sync-ok/15'
              : line.kind === 'del'
                ? 'block bg-ed-sync-pending/15'
                : 'block text-base-content/70'}
          >{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '} {line.text}</span>{/each}</pre>
      {/if}
    </div>

    <!-- the raw facts, folded at the foot -->
    {#if detail}
      <details class="max-h-[45%] shrink-0 overflow-auto px-3 py-2">
        <summary class="cursor-pointer text-xs text-base-content/70">{t.peek.raw()}</summary>
        <div class="mt-1 grid grid-cols-1 gap-x-6 gap-y-2 font-ed-mono text-[11px] @md:grid-cols-2">
          <div>
            <h4 class={FACT}>record</h4>
            <div data-testid="inspector-record">
              {#if record}
                connected {record.connected} · synced {record.synced}<br />
                pendingLocal {record.pendingLocal} · diskMatchesCrdt {record.diskMatchesCrdt}<br />
                diverged {record.diverged} · provider {detail.providerAttached ? 'attached' : 'none'}
              {:else}
                —
              {/if}
            </div>
            <h4 class="mt-2 {FACT}">mount</h4>
            <div>
              room <span class="select-all">{short(detail.mount.room)}</span> at '{detail.mount.path || '/'}' · guid
              <span class="select-all">{short(detail.guid)}</span>
            </div>
          </div>
          <div>
            <h4 class={FACT}>hashes and heads</h4>
            <div data-testid="inspector-heads">
              disk hash {peek?.disk ? peek.disk.hash.slice(0, 12) : '—'} · base hash {detail.lca ? detail.lca.contentHash.slice(0, 12) : '—'}<br />
              base heads {detail.lca?.headsDigest ?? '—'} · doc heads {detail.doc?.headsDigest ?? '—'}<br />
              base {detail.lca?.baseTextLength ?? '—'}ch · doc {detail.doc?.textLength ?? '—'}ch · eol {detail.lca?.eol ?? '—'} · bom {detail.lca?.bom ?? '—'}
            </div>
            <h4 class="mt-2 {FACT}">doc blob</h4>
            <div data-testid="inspector-blob">
              {detail.blob
                ? `${detail.blob.present ? formatSize(detail.blob.bytes ?? 0) : 'absent'} · flushed ${age(detail.blob.lastFlushAt)}`
                : t.no_doc_store()}
            </div>
          </div>
          <div>
            <h4 class={FACT}>journal ({detail.journal.count})</h4>
            <ul data-testid="inspector-journal">
              {#each detail.journal.recent as e, i (i)}
                <li>{formatStamp(e.at, now())} · {formatSize(e.bytes)}</li>
              {:else}
                <li class="font-ed-ui text-base-content/70">{t.no_preimages()}</li>
              {/each}
            </ul>
          </div>
        </div>
      </details>
    {:else}
      <div class="h-2 shrink-0"></div>
    {/if}
  {/if}
</section>
