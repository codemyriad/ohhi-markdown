<script lang="ts">
  /**
   * The inspector (devtools-shaping D, second pass DT2–DT5): the current
   * disk ↔ CRDT state of every mount and every file, in a regular pane tab.
   *
   * Two scroll regions that never share a scrollbar: the list (header, the
   * mount strip or card, the tally, the table) and the selected file's
   * detail. The detail is a right column when the pane is wide (`@4xl` on
   * the tab's own container) and a drawer over the list below it; a tab
   * opened with a path (`viewArg`, E3) renders the detail alone.
   *
   * Read-only, and never polling (R6). The mount snapshot — three store
   * reads per mount — refreshes when the file list changes shape, when the
   * scope changes, and on the button. The per-row STATE is derived live from
   * `ui.records`, so a pill flip re-colours its row without a re-read. The
   * one selected file re-reads on its own record's flips, because that read
   * is small. The snapshot's age re-words on the clock's tick; nothing is
   * re-read by it.
   */
  import { ChevronDown, FileText, RefreshCw, SquareArrowOutUpRight } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { PathPeek } from '@ohhi/workspace'
  import {
    chainOf,
    filterRows,
    LINK_GLYPH,
    linkTone,
    mountAgreement,
    mountHealth,
    RELAY_GLYPH,
    RELAY_TONE,
    relayHost,
    reportText,
    ROW_STATES,
    rowState,
    sortRows,
    STATE_TONE,
    TONE_DOT,
    TONE_TEXT,
    TONE_TINT,
    WRONG_STATES,
    type Agreement,
    type MountHealth,
    type ReportRow,
    type RowSort,
    type RowState,
  } from '../inspector.js'
  import { clockTick } from '../relative-time.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import { getViewShell, shellClock, type ViewProps } from '../views.js'
  import type { WorkspaceInspection, WorkspaceMountInspection } from '../workspace.svelte.js'
  import InspectorDetail from './InspectorDetail.svelte'

  interface Props extends Partial<Pick<ViewProps, 'tab'>> {
    workspace: ViewProps['workspace']
    /** Injected for the tests; the shell's clock otherwise. */
    now?: () => number
    /**
     * Where the detail sits. `auto` (the product) lets the pane's width
     * decide through a container query; the tests force a form, because
     * jsdom has no container queries.
     */
    form?: 'auto' | 'column' | 'drawer'
    /** Write the report to the clipboard; injected for the tests. */
    writeClipboard?: (text: string) => Promise<void>
  }

  const shell = getViewShell()
  const clock = shellClock()

  let {
    workspace,
    tab,
    now = () => clock.now(),
    form = 'auto',
    writeClipboard = (text) => navigator.clipboard.writeText(text),
  }: Props = $props()

  const t = $derived($LL.web.devtools)
  /** Re-words the snapshot's age; reads nothing. */
  const ageTick = clockTick(clock, 5_000)

  /** E3: a tab opened on a path shows that file's detail alone. */
  const fileArg = $derived(tab?.viewArg || null)

  // ---- the snapshot ----
  let mounts = $state.raw<WorkspaceMountInspection[]>([])
  let invariants = $state.raw<string[]>([])
  let snapshotAt = $state<number | null>(null)
  let tick = $state(0)
  /** Mount root being looked at, or null for every mount at once. */
  let scope = $state<string | null>(null)
  let prefix = $state('')
  let stateFilter = $state<RowState | null>(null)
  let sort = $state<RowSort>('worst')
  let selected = $state<string | null>(null)
  /** The drawer was closed on the current selection (a new selection reopens it). */
  let closed = $state(false)
  let detail = $state.raw<WorkspaceInspection | null>(null)
  let peek = $state.raw<PathPeek | null>(null)

  /**
   * What changes the SHAPE of the vault: a create, a delete, a rename, a
   * mount coming or going. Content edits do not touch this, so typing in the
   * pane next door never re-reads three stores per mount.
   */
  const shapeSig = $derived(
    workspace.ui.settling ? null : workspace.ui.files.map((f) => `${f.kind}:${f.path}`).join('\n')
  )

  $effect(() => {
    void tick
    void scope
    if (shapeSig === null) return
    void refreshMounts()
  })

  async function refreshMounts(): Promise<void> {
    const [next, problems] = await Promise.all([
      workspace.inspectMounts(),
      Promise.resolve(workspace.mountInvariants()),
    ])
    mounts = next
    invariants = problems
    snapshotAt = now()
    if (scope !== null && !next.some((m) => m.mountPath === scope)) scope = null
  }

  /** Every mount with its rows classified live off `ui.records`, and its health. */
  const perMount = $derived(
    mounts.map((m) => {
      const rows: ReportRow[] = m.rows.map((row) => {
        const record = workspace.ui.records[row.guid]
        return { row, state: rowState(row, record), chain: chainOf(row, record) }
      })
      return { m, rows, health: mountHealth(rows, m.desc?.status), agreement: mountAgreement(m) }
    })
  )
  const inScope = $derived(scope === null ? perMount : perMount.filter((x) => x.m.mountPath === scope))
  const scoped = $derived(scope === null ? null : (inScope[0] ?? null))
  const classified = $derived(inScope.flatMap((x) => x.rows))
  const counts = $derived(mountHealth(classified, null).counts)
  const shown = $derived(sortRows(filterRows(classified, { prefix, state: stateFilter }), sort))

  // ---- the selected file ----
  // The first selection follows the shell's: what you were looking at is the
  // most likely thing you opened the inspector for. A tab on a path is pinned to it.
  $effect(() => {
    if (fileArg) selected = fileArg
    else if (selected === null && workspace.ui.selectedPath) selected = workspace.ui.selectedPath
  })
  const selectedRow = $derived(
    selected === null ? null : (perMount.flatMap((x) => x.rows).find((r) => r.row.path === selected) ?? null)
  )
  const record = $derived(selectedRow ? workspace.ui.records[selectedRow.row.guid] : undefined)
  const recordSig = $derived(
    record
      ? `${record.connected}:${record.synced}:${record.pendingLocal}:${record.diskMatchesCrdt}:${record.diverged}`
      : ''
  )
  $effect(() => {
    void recordSig
    void tick
    const path = selected
    if (path === null) {
      detail = null
      peek = null
      return
    }
    void Promise.all([workspace.inspect(path), workspace.peek(path)]).then(([d, p]) => {
      if (selected !== path) return
      detail = d
      peek = p
    })
  })

  function select(path: string): void {
    selected = path
    closed = false
  }

  // ---- words ----
  const key = (s: string): string => s.replace('-', '_')
  const stateLabel = (s: RowState): string => t.states[key(s) as keyof typeof t.states]()
  const mountName = (path: string): string => path || t.root_mount()
  const short = (s: string): string => (s.length > 8 ? `${s.slice(0, 8)}…` : s)

  function age(at: number | null, _tick: number): string {
    if (at === null) return t.never()
    const s = Math.max(0, Math.round((now() - at) / 1000))
    return s < 1 ? t.just_now() : s < 60 ? t.seconds_ago({ count: s }) : t.minutes_ago({ count: Math.floor(s / 60) })
  }

  function agreementText(a: Agreement): string {
    switch (a.kind) {
      case 'agrees':
        return t.mount.agrees()
      case 'root':
        return t.mount.root()
      case 'no-desc':
        return t.mount.no_desc()
      case 'needs-token':
        return a.neverHeld ? t.mount.needs_token_never_held() : t.mount.needs_token()
      case 'status':
        return t.mount.status({ status: a.status })
      case 'relay':
        return t.mount.relay_differs({ desc: a.desc, session: a.session ?? t.mount.no_relay() })
    }
  }
  const agreementOk = (a: Agreement): boolean => a.kind === 'agrees' || a.kind === 'root'

  /** The right end of a mount line: only the wrong counts, else all in sync / not syncing. */
  function wrongText(h: MountHealth): string {
    const parts = WRONG_STATES.filter((s) => h.counts[s] > 0).map((s) =>
      t.mount.counted[key(s) as keyof typeof t.mount.counted]({ count: h.counts[s] })
    )
    if (h.atRelay > 0) parts.push(t.mount.at_relay({ count: h.atRelay }))
    if (parts.length) return parts.join(' · ')
    return h.tone === 'offline' ? t.mount.not_syncing() : t.mount.all_in_sync()
  }

  /** A strip line's middle, as words (also the report's mount line). */
  function mountLine(x: (typeof perMount)[number]): string {
    const status = agreementOk(x.agreement) ? (x.m.desc?.status ?? 'active') : agreementText(x.agreement)
    return [
      `${x.m.stats.provenance} · ${status}`,
      relayHost(x.m.relay) ?? t.mount.no_relay(),
      t.mount.rows({ count: x.rows.length }),
      wrongText(x.health),
    ].join(' · ')
  }

  // ---- Copy report (R11) ----
  /** The report, when the clipboard refused it: shown to copy by hand. */
  let fallback = $state<string | null>(null)
  async function copy(kind: 'file' | 'scope'): Promise<void> {
    const words = { title: t.copy.report_title(), state: stateLabel }
    const text =
      kind === 'file' && selectedRow
        ? reportText({ kind: 'file', row: selectedRow, record, peek, detail }, now(), words)
        : reportText(
            {
              kind: 'scope',
              scope: scoped ? mountName(scoped.m.mountPath) : t.all_mounts(),
              invariants,
              mounts: inScope.map((x) => ({ name: mountName(x.m.mountPath), line: mountLine(x) })),
              rows: shown,
            },
            now(),
            words
          )
    try {
      await writeClipboard(text)
      fallback = null
      workspace.flash({ level: 'info', text: t.copy.copied() })
    } catch {
      fallback = text
    }
  }

  // ---- the detail's form ----
  const detailOpen = $derived(selected !== null && !closed)
  /** The detail region's classes per form; `auto` is a drawer that becomes a column at `@4xl`. */
  const DRAWER =
    'absolute inset-y-0 right-0 z-10 flex w-[min(400px,calc(100%-2rem))] border-l border-base-300 shadow-xl'
  const COLUMN = 'flex w-2/5 min-w-[360px] shrink-0 border-l border-base-300'
  const detailClass = $derived(
    form === 'column'
      ? COLUMN
      : form === 'drawer'
        ? detailOpen
          ? DRAWER
          : 'hidden'
        : `${detailOpen ? DRAWER : 'hidden'} @4xl:static @4xl:flex @4xl:w-2/5 @4xl:min-w-[360px] @4xl:shrink-0 @4xl:shadow-none`
  )
  const closeable = $derived(form !== 'column')

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && closeable && detailOpen && !fileArg) {
      closed = true
      e.stopPropagation()
    }
  }

  const chip =
    'inline-flex items-center gap-1.5 rounded-full border border-base-300 px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-base-200 aria-pressed:text-base-content'
  const segment =
    'px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-base-200 aria-pressed:font-semibold aria-pressed:text-base-content'
</script>

{#snippet dot(tone: keyof typeof TONE_DOT, label?: string)}
  <span aria-hidden="true" class="inline-block size-2 shrink-0 rounded-full {TONE_DOT[tone]}"></span>
  {#if label}<span class="sr-only">{label}</span>{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- Escape closes the drawer from anywhere inside -->
<section
  data-testid="inspector"
  aria-label={t.title()}
  {onkeydown}
  class="@container flex h-full min-h-0 w-full flex-col bg-base-100 text-xs text-base-content"
>
  {#if fileArg}
    <InspectorDetail path={fileArg} row={selectedRow} {record} {detail} {peek} form="tab" {now} />
  {:else}
    <header class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-base-200 px-3 py-2">
      <h2 class="m-0 {HEADING}">{t.title()}</h2>
      <div role="group" aria-label={t.scope()} class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid="inspector-scope:all"
          aria-pressed={scope === null}
          onclick={() => (scope = null)}
          class={chip}>{t.all_mounts()}</button
        >
        {#each perMount as x (x.m.stats.room)}
          <button
            type="button"
            data-testid="inspector-scope:{x.m.mountPath || '/'}"
            data-tone={x.health.tone}
            aria-pressed={scope === x.m.mountPath}
            onclick={() => (scope = x.m.mountPath)}
            class={chip}
          >
            {@render dot(x.health.tone, t.health[x.health.tone]())}
            {mountName(x.m.mountPath)}
          </button>
        {/each}
      </div>
      <div class="ml-auto flex items-center gap-2">
        <span data-testid="inspector-invariants" class={invariants.length ? 'font-semibold text-error' : 'text-base-content/70'}>
          {invariants.length ? t.invariants_failed({ count: invariants.length }) : t.invariants_ok()}
        </span>
        <span data-testid="inspector-age" class="text-base-content/70">
          {t.snapshot({ age: age(snapshotAt, $ageTick) })}
        </span>
        <IconButton label={t.refresh()} icon={RefreshCw} size="sm" testid="inspector-refresh" onclick={() => tick++} />
        <DropdownMenu placement="bottom-end" testid="inspector-copy-menu">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-testid="inspector-copy"
              class="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-base-content/80 {OUTLINE_BUTTON}"
            >
              {t.copy.label()}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          {/snippet}
          {#snippet children({ item })}
            <MenuItem
              {item}
              testid="inspector-copy:file"
              disabled={!selectedRow}
              reason={selectedRow ? undefined : t.copy.file_none()}
              onSelect={() => void copy('file')}>{t.copy.file()}</MenuItem
            >
            <MenuItem {item} testid="inspector-copy:scope" onSelect={() => void copy('scope')}>{t.copy.scope()}</MenuItem>
          {/snippet}
        </DropdownMenu>
      </div>
    </header>

    {#if invariants.length}
      <ul data-testid="inspector-violations" class="shrink-0 border-b border-error/40 px-3 py-1 font-ed-mono text-[11px] text-error">
        {#each invariants as problem (problem)}
          <li>{problem}</li>
        {/each}
      </ul>
    {/if}

    {#if fallback !== null}
      <div class="shrink-0 border-b border-base-200 px-3 py-2">
        <p role="status" class="mb-1 text-base-content/80">{t.copy.failed()}</p>
        <textarea
          data-testid="inspector-copy-fallback"
          readonly
          aria-label={t.copy.fallback_label()}
          rows="6"
          class="w-full rounded border border-base-300 bg-base-100 p-1 font-ed-mono text-[11px] text-base-content"
          >{fallback}</textarea
        >
      </div>
    {/if}

    <div class="relative flex min-h-0 flex-1">
      <!-- the list: its own scroll region -->
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        {#if scoped}
          {@const m = scoped.m}
          {@const openHere = scoped.rows.filter((r) => r.row.open).length}
          <!-- D4 amended: identity, then agreement -->
          <section
            data-testid="inspector-mount"
            aria-label={mountName(m.mountPath)}
            class="shrink-0 space-y-1 border-b border-base-200 px-3 py-2"
          >
            <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {@render dot(scoped.health.tone, t.health[scoped.health.tone]())}
              <span class="font-semibold">{mountName(m.mountPath)}</span>
              <span class="text-base-content/80">{m.stats.provenance} · {m.desc?.status ?? t.mount.no_desc()}</span>
              <span class="text-base-content/80">{relayHost(m.relay) ?? t.mount.no_relay()}</span>
              <span class="font-ed-mono text-[11px] text-base-content/70" title={m.stats.room}
                >{t.mount.room({ room: short(m.stats.room) })}</span
              >
              <span data-testid="inspector-stores" class="ml-auto text-[11px] text-base-content/70">
                {t.mount.stores({
                  entries: m.stats.entryCount,
                  docs: m.stats.docCount,
                  base: m.stats.lcaCount,
                  journal: m.stats.journalCount,
                })}
              </span>
            </p>
            <div class="flex flex-wrap items-start gap-x-2 gap-y-0.5 text-base-content/80">
              <span data-testid="inspector-agreement" data-agreement={scoped.agreement.kind}>
                {agreementText(scoped.agreement)}
              </span>
              <span aria-hidden="true">·</span>
              {#if m.lcaOrphans.length}
                <details data-testid="inspector-orphans">
                  <summary class="cursor-pointer">
                    {t.mount.orphans({ count: m.lcaOrphans.length })} · {t.mount.orphans_show()}
                  </summary>
                  <ul class="font-ed-mono text-[11px]">
                    {#each m.lcaOrphans as o (o.guid)}
                      <li>{o.path} · {short(o.guid)}</li>
                    {/each}
                  </ul>
                </details>
              {:else}
                <span>{t.mount.no_orphans()}</span>
              {/if}
              <span aria-hidden="true">·</span>
              <span>{t.mount.open_here({ count: openHere })}</span>
            </div>
          </section>
        {:else if perMount.length}
          <!-- At All mounts: one line per mount; a line narrows the scope -->
          <ul data-testid="inspector-mounts" class="shrink-0 border-b border-base-200 py-1">
            {#each perMount as x (x.m.stats.room)}
              {@const ok = agreementOk(x.agreement)}
              <li>
                <button
                  type="button"
                  data-testid="inspector-mount-line:{x.m.mountPath || '/'}"
                  onclick={() => (scope = x.m.mountPath)}
                  class="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {@render dot(x.health.tone, t.health[x.health.tone]())}
                  <span class="font-semibold">{mountName(x.m.mountPath)}</span>
                  <span class="truncate text-base-content/80">
                    {x.m.stats.provenance} · {ok ? (x.m.desc?.status ?? 'active') : agreementText(x.agreement)}
                    · {relayHost(x.m.relay) ?? t.mount.no_relay()} · {t.mount.rows({ count: x.rows.length })}
                  </span>
                  <span class="ml-auto shrink-0 text-base-content/80">{wrongText(x.health)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- tools: the tally (filter AND key), the path filter, the order -->
        <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-base-200 px-3 py-1.5">
          <div role="group" aria-label={t.tally()} class="flex flex-wrap items-center gap-1">
            {#each ROW_STATES as s (s)}
              <button
                type="button"
                data-testid="inspector-state:{s}"
                aria-pressed={stateFilter === s}
                onclick={() => (stateFilter = stateFilter === s ? null : s)}
                class={chip}
              >
                {@render dot(STATE_TONE[s])}
                {stateLabel(s)}
                <span class="tabular-nums text-base-content/70">{counts[s]}</span>
              </button>
            {/each}
          </div>
          <label class="flex items-center gap-1 text-base-content/80">
            {t.filter_prefix()}
            <input
              type="text"
              data-testid="inspector-prefix"
              bind:value={prefix}
              class="w-36 rounded border border-base-300 bg-base-100 px-1 py-0.5 font-ed-mono text-[11px] focus-visible:outline-2 focus-visible:outline-primary"
            />
          </label>
          <div
            role="group"
            aria-label={t.sort_label()}
            data-testid="inspector-sort"
            data-sort={sort}
            class="inline-flex overflow-hidden rounded border border-base-300"
          >
            {#each ['worst', 'path'] as const as s (s)}
              <button type="button" data-testid="inspector-sort:{s}" aria-pressed={sort === s} onclick={() => (sort = s)} class={segment}
                >{t.sort[s]()}</button
              >
            {/each}
          </div>
          <span data-testid="inspector-count" class="ml-auto text-base-content/70">
            {t.rows({ shown: shown.length, total: classified.length })}
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          {#if shown.length}
            <table data-testid="inspector-rows" class="w-full border-collapse">
              <thead class="sticky top-0 z-[1] bg-base-100 text-left">
                <tr class="border-b border-base-200">
                  <th scope="col" class="px-3 py-1 {HEADING}">{t.col.path()}</th>
                  <th scope="col" class="px-2 py-1 font-ed-mono text-[11px] font-semibold text-base-content/70">
                    <span class="sr-only">{t.col.chain()}:</span>
                    {t.col.disk()} · <abbr title={t.col.base_title()} class="no-underline">{t.col.base()}</abbr> · {t.col.doc()} · {t.col.relay()}
                  </th>
                  <th scope="col" class="px-2 py-1 {HEADING}">{t.col.state()}</th>
                  <th scope="col" class="px-2 py-1 text-right {HEADING}">{t.col.journal()}</th>
                  <th scope="col" class="px-2 py-1"><span class="sr-only">{t.col.actions()}</span></th>
                </tr>
              </thead>
              <tbody>
                {#each shown as { row, state, chain: c } (row.guid)}
                  {@const diverged = state === 'diverged'}
                  {@const isSel = selected === row.path}
                  {@const cut = row.path.lastIndexOf('/') + 1}
                  <tr
                    data-testid="inspector-row:{row.path}"
                    data-state={state}
                    data-chain="{c.diskLca}:{c.lcaDoc}:{c.relay}"
                    data-selected={isSel ? 'true' : undefined}
                    class="border-b border-base-200 {isSel ? 'bg-base-200 shadow-[inset_3px_0_0_var(--color-primary)]' : ''}"
                  >
                    <td class="max-w-0 px-3 py-0.5">
                      <div class="flex items-center gap-1.5">
                        {#if row.kind === 'text'}
                          <button
                            type="button"
                            aria-current={isSel ? 'true' : undefined}
                            onclick={() => select(row.path)}
                            class="min-w-0 truncate text-left font-ed-mono text-[11px] hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <span class="text-base-content/70">{row.path.slice(0, cut)}</span>{row.path.slice(cut)}
                          </button>
                        {:else}
                          <span class="min-w-0 truncate font-ed-mono text-[11px] text-base-content/70">{row.path}</span>
                        {/if}
                        {#if row.open}
                          <span class="shrink-0 rounded border border-base-300 px-1 text-[10px] text-base-content/80">{t.open_tag()}</span>
                        {/if}
                      </div>
                    </td>
                    <td class="px-2 py-0.5 font-ed-mono text-[11px] whitespace-nowrap">
                      {#if row.kind === 'text'}
                        <span class="sr-only">
                          {t.chain_said({ diskLca: t.link[c.diskLca](), lcaDoc: t.link[c.lcaDoc](), relay: t.relay_link[c.relay]() })}
                        </span>
                        <span aria-hidden="true">
                          <span>●</span>
                          <span class={TONE_TEXT[linkTone(c.diskLca, diverged)]} title={t.link[c.diskLca]()}>{LINK_GLYPH[c.diskLca]}</span>
                          <span class={row.lca ? '' : 'text-base-content/70'}>{row.lca ? '●' : '–'}</span>
                          <span class={TONE_TEXT[linkTone(c.lcaDoc, diverged)]} title={t.link[c.lcaDoc]()}>{LINK_GLYPH[c.lcaDoc]}</span>
                          <span class={row.doc ? '' : 'text-base-content/70'}>{row.doc ? '●' : '–'}</span>
                          <span class="ml-1 font-semibold {TONE_TEXT[RELAY_TONE[c.relay]]}" title={t.relay_link[c.relay]()}>{RELAY_GLYPH[c.relay]}</span>
                        </span>
                      {:else}
                        <span class="text-base-content/70">{row.kind}</span>
                      {/if}
                    </td>
                    <td class="px-2 py-0.5 whitespace-nowrap">
                      <span
                        class="inline-flex items-center gap-1.5 rounded-full px-2 py-px text-[11px] text-base-content {TONE_TINT[STATE_TONE[state]]} {diverged ? 'font-semibold' : ''}"
                      >
                        {@render dot(STATE_TONE[state])}
                        {stateLabel(state)}
                      </span>
                    </td>
                    <td class="px-2 py-0.5 text-right tabular-nums">{row.journalCount}</td>
                    <td class="px-2 py-0.5">
                      {#if shell && row.kind === 'text'}
                        <div class="flex justify-end">
                          <IconButton
                            label={t.verbs.open_note_path({ path: row.path })}
                            icon={FileText}
                            tooltip={false}
                            testid="inspector-row-open:{row.path}"
                            onclick={() => shell.openPath(row.path)}
                          />
                          <IconButton
                            label={t.verbs.own_tab_path({ path: row.path })}
                            icon={SquareArrowOutUpRight}
                            tooltip={false}
                            testid="inspector-row-tab:{row.path}"
                            onclick={() => shell.openView('inspector', row.path)}
                          />
                        </div>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="px-3 py-2 text-base-content/70">{t.no_rows()}</p>
          {/if}
        </div>
      </div>

      <!-- the detail: its own region — a column when wide, a drawer when narrow -->
      <div data-testid="inspector-detail" data-form={form} class="min-h-0 flex-col {detailClass}">
        <InspectorDetail
          path={detailOpen || form !== 'drawer' ? selected : null}
          row={selectedRow}
          {record}
          {detail}
          {peek}
          {form}
          {now}
          onclose={closeable && detailOpen ? () => (closed = true) : undefined}
          closeClass={form === 'auto' ? '@4xl:hidden' : ''}
        />
      </div>
    </div>
  {/if}
</section>
