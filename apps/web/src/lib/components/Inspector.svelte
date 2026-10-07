<script lang="ts">
  /**
   * The inspector (devtools-shaping D2–D5): the current disk ↔ CRDT state of
   * every mount and every file, in a regular pane tab — opaque, roomy, and
   * live beside the editor. It replaces M6's translucent bottom drawer.
   *
   * Read-only, and never polling (R6). The mount snapshot — three store
   * reads per mount — refreshes when the file list changes shape, when the
   * scope changes, and on the button. The per-row STATE is derived live from
   * `ui.records`, so a pill flip re-colours its row without a re-read. The
   * one selected file re-reads on its own record's flips, as the drawer did,
   * because that read is small.
   */
  import { RefreshCw } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { formatSize, formatStamp } from '../history.js'
  import {
    chainOf,
    countByState,
    defaultPeekView,
    filterRows,
    isWrong,
    lineDiff,
    peekChain,
    rowState,
    ROW_STATES,
    type Chain,
    type ClassifiedRow,
    type Link,
    type PeekView,
    type RelayLink,
    type RowState,
  } from '../inspector.js'
  import { pillStatus } from '../pill-status.js'
  import IconButton from '../ui/IconButton.svelte'
  import type { PathPeek } from '@ohhi/workspace'
  import type {
    Workspace,
    WorkspaceInspection,
    WorkspaceMountInspection,
  } from '../workspace.svelte.js'

  interface Props {
    workspace: Workspace
    /** Injected for the tests; the shell's clock otherwise. */
    now?: () => number
  }

  let { workspace, now = () => Date.now() }: Props = $props()

  const t = $derived($LL.web.devtools)
  const uid = $props.id()

  // ---- the snapshot ----
  let mounts = $state.raw<WorkspaceMountInspection[]>([])
  let invariants = $state.raw<string[]>([])
  let tick = $state(0)
  /** Mount root being looked at, or null for every mount at once. */
  let scope = $state<string | null>(null)
  let prefix = $state('')
  let stateFilter = $state<RowState | null>(null)
  let selected = $state<string | null>(null)
  let detail = $state.raw<WorkspaceInspection | null>(null)
  let peek = $state.raw<PathPeek | null>(null)
  /** Which of the three texts, or which pair's diff, the peek shows; null = the chain's default. */
  let peekView = $state<PeekView | null>(null)

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
    if (scope !== null && !next.some((m) => m.mountPath === scope)) scope = null
  }

  const inScope = $derived(scope === null ? mounts : mounts.filter((m) => m.mountPath === scope))
  const mount = $derived(scope === null ? null : (inScope[0] ?? null))

  const classified = $derived.by((): (ClassifiedRow & { chain: Chain })[] =>
    inScope.flatMap((m) =>
      m.rows.map((row) => {
        const record = workspace.ui.records[row.guid]
        return { row, state: rowState(row, record), chain: chainOf(row, record) }
      })
    )
  )
  const counts = $derived(countByState(classified))
  const shown = $derived(filterRows(classified, { prefix, state: stateFilter }))

  // ---- the selected file ----
  // The first selection follows the shell's: what you were looking at is the
  // most likely thing you opened the inspector for.
  $effect(() => {
    if (selected === null && workspace.ui.selectedPath) selected = workspace.ui.selectedPath
  })
  const selectedRow = $derived(classified.find((r) => r.row.path === selected) ?? null)
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
  // A new selection starts on the chain's own default view.
  $effect(() => {
    void selected
    peekView = null
  })

  /** The selected file's chain, with disk vs LCA measured off the peek's hashes. */
  const chain = $derived(selectedRow ? peekChain(selectedRow.chain, peek) : null)
  const view = $derived<PeekView | null>(chain ? (peekView ?? defaultPeekView(chain)) : null)
  const PEEK_VIEWS: readonly PeekView[] = ['doc-lca', 'disk-lca', 'disk-doc', 'disk', 'lca', 'doc']
  const textOf = (side: 'disk' | 'lca' | 'doc'): string | null =>
    !peek ? null : side === 'disk' ? (peek.disk?.text ?? null) : side === 'lca' ? (peek.lca?.text ?? null) : (peek.doc?.text ?? null)
  /** The peek's body: a diff (`lines`), a text, an absence, or too-large. */
  const body = $derived.by(() => {
    if (!view || !peek) return null
    if (view === 'disk' || view === 'lca' || view === 'doc') {
      const text = textOf(view)
      return text === null ? { kind: 'absent' as const } : { kind: 'text' as const, text }
    }
    const [to, from] = view === 'doc-lca' ? (['doc', 'lca'] as const) : view === 'disk-lca' ? (['disk', 'lca'] as const) : (['disk', 'doc'] as const)
    const a = textOf(from)
    const b = textOf(to)
    if (a === null || b === null) return { kind: 'absent' as const }
    if (a === b) return { kind: 'identical' as const }
    const lines = lineDiff(a, b)
    return lines ? { kind: 'diff' as const, lines } : { kind: 'too_large' as const }
  })

  const LINK_GLYPH: Record<Link, string> = { equal: '═══', differs: '≠≠≠', unknown: '···' }
  const LINK_TONE: Record<Link, string> = { equal: 'text-base-content/70', differs: 'text-error', unknown: 'text-base-content/70' }
  const RELAY_GLYPH: Record<RelayLink, string> = { synced: '✓', pending: '…', offline: '✗', none: '–', unknown: '?' }
  const RELAY_TONE: Record<RelayLink, string> = { synced: 'text-success', pending: 'text-warning', offline: 'text-error', none: 'text-base-content/70', unknown: 'text-base-content/70' }
  const peekLabel = (v: PeekView): string => t.peek[v.replace('-', '_') as keyof typeof t.peek]()

  function age(at: number | null): string {
    if (at === null) return t.never()
    const s = Math.max(0, Math.round((now() - at) / 1000))
    return s < 1 ? t.just_now() : t.seconds_ago({ count: s })
  }

  const stateLabel = (s: RowState): string => t.states[s.replace('-', '_') as keyof typeof t.states]()
  const mountName = (path: string): string => path || t.root_mount()
  const short = (s: string): string => `${s.slice(0, 8)}…`
</script>

<section
  data-testid="inspector"
  aria-label={t.title()}
  class="flex h-full min-h-0 w-full flex-col bg-base-100 font-ed-mono text-[11px] text-base-content"
>
  <header class="flex items-center gap-3 border-b border-warning/40 bg-base-200 px-3 py-1">
    <h2 class="font-semibold tracking-wide text-warning uppercase">{t.title()}</h2>
    <span
      data-testid="inspector-invariants"
      class={invariants.length ? 'font-semibold text-error' : 'text-base-content/70'}
    >
      {invariants.length
        ? t.invariants_failed({ count: invariants.length })
        : t.invariants_ok()}
    </span>
    <div class="ml-auto">
      <IconButton
        label={t.refresh()}
        icon={RefreshCw}
        size="sm"
        testid="inspector-refresh"
        onclick={() => tick++}
      />
    </div>
  </header>

  {#if invariants.length}
    <ul data-testid="inspector-violations" class="border-b border-error/40 px-3 py-1 text-error">
      {#each invariants as problem (problem)}
        <li>{problem}</li>
      {/each}
    </ul>
  {/if}

  <div class="flex min-h-0 flex-1">
    <!-- D2: scope nav — every mount, or one -->
    <nav aria-label={t.scope()} class="w-44 shrink-0 overflow-y-auto border-r border-base-300">
      <ul>
        <li>
          <button
            type="button"
            data-testid="inspector-scope:all"
            aria-current={scope === null ? 'true' : undefined}
            onclick={() => (scope = null)}
            class="block w-full px-3 py-1 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-[current]:bg-base-200 aria-[current]:font-semibold"
          >
            {t.all_mounts()}
          </button>
        </li>
        {#each mounts as m (m.stats.room)}
          <li>
            <button
              type="button"
              data-testid="inspector-scope:{m.mountPath || '/'}"
              aria-current={scope === m.mountPath ? 'true' : undefined}
              onclick={() => (scope = m.mountPath)}
              class="block w-full px-3 py-1 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-[current]:bg-base-200 aria-[current]:font-semibold"
            >
              <span class="block truncate">{mountName(m.mountPath)}</span>
              <span class="block text-base-content/70">
                {m.stats.provenance} · {m.desc?.status ?? t.no_desc()}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <!-- D4: the mount card -->
      {#if mount}
        <section
          data-testid="inspector-mount"
          aria-label={mountName(mount.mountPath)}
          class="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-base-300 px-3 py-2 md:grid-cols-3"
        >
          <div>
            <h3 class="font-semibold text-base-content/70">mount</h3>
            room <span class="select-all">{short(mount.stats.room)}</span> at '{mount.mountPath || '/'}'<br />
            provenance {mount.stats.provenance} · shared {mount.stats.shared}<br />
            relay {mount.relay ?? '—'}
          </div>
          <div>
            <h3 class="font-semibold text-base-content/70">mounts.json</h3>
            {#if mount.desc}
              status {mount.desc.status}{mount.desc.neverHeld ? ` · ${t.never_held()}` : ''}<br />
              relay {mount.desc.relay ?? '—'}<br />
              absorbInto {mount.desc.absorbInto ? short(mount.desc.absorbInto) : '—'}
            {:else}
              <span class="text-error">{t.no_desc()}</span>
            {/if}
          </div>
          <div>
            <h3 class="font-semibold text-base-content/70">stores</h3>
            {mount.stats.entryCount} entries · {mount.stats.docCount} docs<br />
            {mount.stats.lcaCount} lca · {mount.stats.journalCount} journal<br />
            {t.orphans()}
            {#if mount.lcaOrphans.length}
              <span class="text-error">{mount.lcaOrphans.length}</span>
              <ul data-testid="inspector-orphans">
                {#each mount.lcaOrphans as o (o.guid)}
                  <li>{o.path} · {short(o.guid)}</li>
                {/each}
              </ul>
            {:else}
              0
            {/if}
          </div>
        </section>
      {/if}

      <!-- D5: the file table -->
      <div class="flex flex-wrap items-center gap-3 border-b border-base-300 px-3 py-1">
        <label class="flex items-center gap-1">
          <span class="text-base-content/70">{t.filter_prefix()}</span>
          <input
            type="text"
            data-testid="inspector-prefix"
            bind:value={prefix}
            class="w-40 rounded border border-base-300 bg-base-100 px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-primary"
          />
        </label>
        <label class="flex items-center gap-1">
          <span class="text-base-content/70">{t.filter_state()}</span>
          <select
            data-testid="inspector-state"
            value={stateFilter ?? ''}
            onchange={(e) => (stateFilter = (e.currentTarget.value || null) as RowState | null)}
            class="rounded border border-base-300 bg-base-100 px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <option value="">{t.state_any()}</option>
            {#each ROW_STATES as s (s)}
              <option value={s}>{stateLabel(s)} ({counts[s]})</option>
            {/each}
          </select>
        </label>
        <span data-testid="inspector-count" class="ml-auto text-base-content/70">
          {t.rows({ shown: shown.length, total: classified.length })}
        </span>
      </div>

      {#if shown.length}
        <table data-testid="inspector-rows" class="w-full border-collapse">
          <thead class="sticky top-0 bg-base-200 text-left text-base-content/70">
            <tr>
              <th scope="col" class="px-3 py-0.5 font-semibold">{t.col.path()}</th>
              <th scope="col" class="px-2 py-0.5 text-center font-semibold">{t.col.disk()}</th>
              <th scope="col" class="px-1 py-0.5"><span class="sr-only">{t.col.disk()} / {t.col.lca()}</span></th>
              <th scope="col" class="px-2 py-0.5 text-center font-semibold">{t.col.lca()}</th>
              <th scope="col" class="px-1 py-0.5"><span class="sr-only">{t.col.lca()} / {t.col.doc()}</span></th>
              <th scope="col" class="px-2 py-0.5 text-center font-semibold">{t.col.doc()}</th>
              <th scope="col" class="px-2 py-0.5 text-center font-semibold">{t.col.relay()}</th>
              <th scope="col" class="px-2 py-0.5 font-semibold">{t.col.state()}</th>
              <th scope="col" class="px-2 py-0.5 font-semibold">{t.col.journal()}</th>
              <th scope="col" class="px-2 py-0.5 font-semibold">{t.col.open()}</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as { row, state, chain: c } (row.guid)}
              <tr
                data-testid="inspector-row:{row.path}"
                data-state={state}
                data-chain="{c.diskLca}:{c.lcaDoc}:{c.relay}"
                class="border-t border-base-200 {selected === row.path ? 'bg-base-200' : ''}"
              >
                <td class="max-w-0 truncate px-3 py-0.5">
                  {#if row.kind === 'text'}
                    <button
                      type="button"
                      aria-current={selected === row.path ? 'true' : undefined}
                      onclick={() => (selected = row.path)}
                      class="w-full truncate text-left hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {row.path}
                    </button>
                  {:else}
                    <span class="text-base-content/70">{row.path}</span>
                  {/if}
                </td>
                {#if row.kind === 'text'}
                  <td class="px-2 py-0.5 text-center">●</td>
                  <td class="px-1 py-0.5 text-center {LINK_TONE[c.diskLca]}" title={t.legend[c.diskLca]()}>{LINK_GLYPH[c.diskLca]}</td>
                  <td class="px-2 py-0.5 text-center">{row.lca ? '●' : '–'}</td>
                  <td class="px-1 py-0.5 text-center {LINK_TONE[c.lcaDoc]}" title={t.legend[c.lcaDoc]()}>{LINK_GLYPH[c.lcaDoc]}</td>
                  <td class="px-2 py-0.5 text-center">{row.doc ? '●' : '–'}</td>
                  <td class="px-2 py-0.5 text-center font-semibold {RELAY_TONE[c.relay]}" title={t.legend[c.relay === 'unknown' ? 'unknown' : c.relay]()}>{RELAY_GLYPH[c.relay]}</td>
                {:else}
                  <td class="px-2 py-0.5 text-center">●</td>
                  <td class="px-1 py-0.5"></td>
                  <td class="px-2 py-0.5 text-center text-base-content/70">–</td>
                  <td class="px-1 py-0.5"></td>
                  <td class="px-2 py-0.5 text-center text-base-content/70">–</td>
                  <td class="px-2 py-0.5 text-center text-base-content/70">–</td>
                {/if}
                <td class="px-2 py-0.5 {isWrong(state) ? 'font-semibold text-error' : ''}">
                  {row.kind === 'text' ? stateLabel(state) : row.kind}
                </td>
                <td class="px-2 py-0.5">{row.journalCount}</td>
                <td class="px-2 py-0.5">{row.open ? 'open' : '–'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="px-3 py-1 text-base-content/70">
          <span class="mr-3"><span class="text-base-content/70">═══</span> {t.legend.equal()}</span>
          <span class="mr-3"><span class="text-error">≠≠≠</span> {t.legend.differs()}</span>
          <span class="mr-3">··· {t.legend.unknown()}</span>
          <span class="mr-3"><span class="text-success">✓</span> {t.legend.synced()}</span>
          <span class="mr-3"><span class="text-warning">…</span> {t.legend.pending()}</span>
          <span class="mr-3"><span class="text-error">✗</span> {t.legend.offline()}</span>
          <span>– {t.legend.none()}</span>
        </p>
      {:else}
        <p class="px-3 py-2 text-base-content/70">{t.no_rows()}</p>
      {/if}

      <!-- D3: the selected file -->
      <section
        data-testid="inspector-file"
        aria-labelledby="{uid}-file"
        class="mt-auto border-t border-warning/40 px-3 py-2"
      >
        <h3 id="{uid}-file" class="truncate font-semibold">
          {selected ?? t.select_row()}
        </h3>
        {#if detail && record && chain}
          <!-- the chain, big -->
          <p data-testid="inspector-chain" data-chain="{chain.diskLca}:{chain.lcaDoc}:{chain.relay}" class="mt-1 text-sm">
            <span>{t.col.disk()}</span>
            <span class="mx-1 {LINK_TONE[chain.diskLca]}" title={t.legend[chain.diskLca]()}>{LINK_GLYPH[chain.diskLca]}</span>
            <span>{t.col.lca()}</span>
            <span class="mx-1 {LINK_TONE[chain.lcaDoc]}" title={t.legend[chain.lcaDoc]()}>{LINK_GLYPH[chain.lcaDoc]}</span>
            <span>{t.col.doc()}</span>
            <span class="mx-1 font-semibold {RELAY_TONE[chain.relay]}">{RELAY_GLYPH[chain.relay]}</span>
            <span>{t.col.relay()}</span>
            <span class="ml-3 {isWrong(selectedRow!.state) ? 'font-semibold text-error' : 'text-base-content/70'}">{stateLabel(selectedRow!.state)}</span>
            <span class="ml-3 text-base-content/70">{t.col.relay()}: {pillStatus(record)}</span>
          </p>

          <!-- the peek: one of the three texts, or the diff across a link -->
          <div class="mt-2 flex items-center gap-2">
            <label class="flex items-center gap-1">
              <span class="text-base-content/70">{t.peek.show()}</span>
              <select
                data-testid="inspector-peek-view"
                value={view}
                onchange={(e) => (peekView = e.currentTarget.value as PeekView)}
                class="rounded border border-base-300 bg-base-100 px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-primary"
              >
                {#each PEEK_VIEWS as v (v)}
                  <option value={v}>{peekLabel(v)}</option>
                {/each}
              </select>
            </label>
          </div>
          <div data-testid="inspector-peek" data-view={view} class="mt-1 max-h-72 overflow-auto rounded border border-base-300 bg-base-200">
            {#if !body || body.kind === 'absent'}
              <p class="px-2 py-1 text-base-content/70">{t.peek.absent()}</p>
            {:else if body.kind === 'identical'}
              <p class="px-2 py-1 text-base-content/70">{t.peek.identical()}</p>
            {:else if body.kind === 'too_large'}
              <p class="px-2 py-1 text-base-content/70">{t.peek.too_large()}</p>
            {:else if body.kind === 'text'}
              <pre class="px-2 py-1 whitespace-pre-wrap">{body.text}</pre>
            {:else}
              <pre class="px-2 py-1 whitespace-pre-wrap">{#each body.lines as line, i (i)}<span
                  class={line.kind === 'add' ? 'block bg-success/15' : line.kind === 'del' ? 'block bg-error/15 text-error' : 'block text-base-content/70'}
                >{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '} {line.text}</span>{/each}</pre>
            {/if}
          </div>

          <!-- the raw facts, folded -->
          <details class="mt-2">
            <summary class="cursor-pointer text-base-content/70">{t.peek.raw()}</summary>
            <div class="grid grid-cols-2 gap-x-6 gap-y-0.5 md:grid-cols-3">
              <div>
                <h4 class="mt-1 font-semibold text-base-content/70">record</h4>
                <div data-testid="inspector-record">
                  connected {record.connected} · synced {record.synced}<br />
                  pendingLocal {record.pendingLocal} · diskMatchesCrdt {record.diskMatchesCrdt}<br />
                  diverged {record.diverged} · provider {detail.providerAttached ? 'attached' : 'none'}
                </div>
                <h4 class="mt-2 font-semibold text-base-content/70">mount</h4>
                <div>
                  room <span class="select-all">{short(detail.mount.room)}</span> at
                  '{detail.mount.path || '/'}' · guid
                  <span class="select-all">{short(detail.guid)}</span>
                </div>
              </div>
              <div>
                <h4 class="mt-1 font-semibold text-base-content/70">hashes and heads</h4>
                <div data-testid="inspector-heads">
                  disk hash {peek?.disk ? peek.disk.hash.slice(0, 12) : '—'} · lca hash {detail.lca ? detail.lca.contentHash.slice(0, 12) : '—'}<br />
                  lca heads {detail.lca?.headsDigest ?? '—'} · doc heads {detail.doc?.headsDigest ?? '—'}<br />
                  base {detail.lca?.baseTextLength ?? '—'}ch · doc {detail.doc?.textLength ?? '—'}ch · eol {detail.lca?.eol ?? '—'} · bom {detail.lca?.bom ?? '—'}
                </div>
                <h4 class="mt-2 font-semibold text-base-content/70">doc blob</h4>
                <div data-testid="inspector-blob">
                  {detail.blob
                    ? `${detail.blob.present ? formatSize(detail.blob.bytes ?? 0) : 'absent'} · flushed ${age(detail.blob.lastFlushAt)}`
                    : t.no_doc_store()}
                </div>
              </div>
              <div>
                <h4 class="mt-1 font-semibold text-base-content/70">journal ({detail.journal.count})</h4>
                <ul data-testid="inspector-journal">
                  {#each detail.journal.recent as e, i (i)}
                    <li>{formatStamp(e.at, now())} · {formatSize(e.bytes)}</li>
                  {:else}
                    <li class="text-base-content/70">{t.no_preimages()}</li>
                  {/each}
                </ul>
              </div>
            </div>
          </details>
        {/if}
      </section>
    </div>
  </div>
</section>
