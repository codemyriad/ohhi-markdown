<script lang="ts">
  import type { Workspace, WorkspaceInspection } from '../workspace.svelte.js'
  import type { MountStats } from '@editor/workspace'
  import { pillStatus } from '../pill-status.js'

  interface Props {
    workspace: Workspace
  }

  let { workspace }: Props = $props()

  let open = $state(true)
  let insp = $state.raw<WorkspaceInspection | null>(null)
  let stats = $state.raw<MountStats[]>([])
  let tick = $state(0)

  const selected = $derived(workspace.ui.selectedPath)
  const record = $derived(insp ? workspace.ui.records[insp.recordKey] : null)
  // Reading the record's fields here makes the effect re-run when the pill
  // state changes, so the snapshot follows live sync activity without polling.
  const recordSig = $derived(
    record
      ? `${record.connected}:${record.synced}:${record.pendingLocal}:${record.diskMatchesCrdt}:${record.diverged}`
      : ''
  )

  $effect(() => {
    void selected
    void tick
    void recordSig
    void refresh()
  })

  async function refresh(): Promise<void> {
    stats = await workspace.mountStats()
    insp = selected ? await workspace.inspect(selected) : null
  }

  function age(at: number | null): string {
    if (at === null) return 'never'
    const s = Math.max(0, Math.round((Date.now() - at) / 1000))
    return s < 1 ? 'just now' : `${s}s ago`
  }
</script>

<section
  data-testid="devtools-panel"
  aria-label="Sync devtools"
  class="fixed inset-x-0 bottom-0 z-10 border-t border-warning/40 bg-warning/10 font-mono text-[11px] text-base-content"
>
  <header class="flex items-center gap-3 px-3 py-1">
    <h2 class="font-semibold tracking-wide text-warning uppercase">Sync devtools</h2>
    <span class="truncate text-base-content/70">{selected ?? 'no file selected'}</span>
    <div class="ml-auto flex items-center gap-2">
      <button
        data-testid="devtools-refresh"
        onclick={() => tick++}
        class="rounded px-2 py-0.5 text-warning hover:bg-warning/15"
      >
        refresh
      </button>
      <button
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-label={open ? 'Collapse devtools' : 'Expand devtools'}
        class="rounded px-2 py-0.5 text-warning hover:bg-warning/15"
      >
        {open ? '▾' : '▴'}
      </button>
    </div>
  </header>

  {#if open}
    <div class="max-h-[35vh] overflow-y-auto px-3 pb-2">
      {#if insp && record}
        <div class="grid grid-cols-2 gap-x-6 gap-y-0.5 md:grid-cols-3">
          <div>
            <h3 class="mt-1 font-semibold text-base-content/70">record → pill: {pillStatus(record)}</h3>
            <div data-testid="devtools-record">
              connected {record.connected} · synced {record.synced}<br />
              pendingLocal {record.pendingLocal} · diskMatchesCrdt {record.diskMatchesCrdt}<br />
              diverged {record.diverged} · provider {insp.providerAttached ? 'attached' : 'none'}
            </div>
            <h3 class="mt-2 font-semibold text-base-content/70">mount</h3>
            <div>
              room <span class="select-all">{insp.mount.room.slice(0, 8)}…</span> at
              '{insp.mount.path || '/'}' · guid
              <span class="select-all">{insp.guid.slice(0, 8)}…</span>
            </div>
          </div>
          <div>
            <h3 class="mt-1 font-semibold text-base-content/70">
              disk ↔ crdt {insp.doc?.equalsLca === true
                ? '· heads equal'
                : insp.doc?.equalsLca === false
                  ? '· DOC AHEAD of LCA'
                  : ''}
            </h3>
            <div data-testid="devtools-heads">
              lca heads {insp.lca?.headsDigest ?? '—'} · doc heads {insp.doc?.headsDigest ?? '—'}<br />
              lca hash {insp.lca ? insp.lca.contentHash.slice(0, 12) : '—'} · base
              {insp.lca?.baseTextLength ?? '—'}ch · doc {insp.doc?.textLength ?? '—'}ch<br />
              eol {insp.lca?.eol ?? '—'} · bom {insp.lca?.bom ?? '—'}
            </div>
            <h3 class="mt-2 font-semibold text-base-content/70">doc blob</h3>
            <div data-testid="devtools-blob">
              {insp.blob
                ? `${insp.blob.present ? `${insp.blob.bytes}b` : 'absent'} · flushed ${age(insp.blob.lastFlushAt)}`
                : 'no doc store'}
            </div>
          </div>
          <div>
            <h3 class="mt-1 font-semibold text-base-content/70">journal ({insp.journal.count})</h3>
            <ul data-testid="devtools-journal">
              {#each insp.journal.recent as e, i (i)}
                <li>{new Date(e.at).toISOString().slice(11, 19)} · {e.bytes}b</li>
              {:else}
                <li class="text-base-content/70">no pre-images yet</li>
              {/each}
            </ul>
          </div>
        </div>
      {:else}
        <p class="py-1 text-base-content/70">Select a text file to inspect its disk ↔ CRDT state.</p>
      {/if}

      <footer
        data-testid="devtools-mounts"
        class="mt-2 border-t border-warning/30 pt-1 text-base-content/70"
      >
        {#each stats as m (m.room)}
          <span class="mr-4">
            {m.mountPath || '/'} · {m.provenance}{m.shared ? ' (shared)' : ''} · {m.entryCount} entries
            · {m.docCount} docs · {m.lcaCount} lca · {m.journalCount} journal
          </span>
        {/each}
      </footer>
    </div>
  {/if}
</section>
