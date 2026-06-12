<script lang="ts">
  import { pillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow } from '../workspace.svelte.js'
  import SyncPill from './SyncPill.svelte'

  interface Props {
    files: FileRow[]
    records: Record<string, SyncRecord>
    selected: string | null
    onSelect: (path: string) => void
    onNewFile: () => void
  }

  let { files, records, selected, onSelect, onNewFile }: Props = $props()
</script>

<nav data-testid="file-tree" aria-label="Files" class="flex h-full flex-col overflow-y-auto">
  <div class="flex items-center justify-between border-b border-gray-200 px-3 py-2">
    <h2 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Files</h2>
    <button
      data-testid="new-file"
      onclick={onNewFile}
      class="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
    >
      + new
    </button>
  </div>
  <ul class="flex-1 py-1">
    {#each files as file (file.path)}
      <li>
        {#if file.kind === 'text'}
          <button
            data-testid="file-item:{file.path}"
            onclick={() => onSelect(file.path)}
            aria-current={selected === file.path ? 'true' : undefined}
            class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm
              {selected === file.path ? 'bg-blue-50 font-medium text-blue-900' : 'text-gray-800 hover:bg-gray-50'}"
          >
            <span class="truncate">{file.path}</span>
            {#if records[file.path]}
              <SyncPill status={pillStatus(records[file.path])} testid="sync-pill:{file.path}" />
            {/if}
          </button>
        {:else}
          <!-- Binaries are excluded from sync; the pill never claims them (D2f). -->
          <div
            data-testid="file-item:{file.path}"
            class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-gray-400"
          >
            <span class="truncate">{file.path}</span>
            <span
              data-testid="binary-badge:{file.path}"
              class="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] tracking-wide text-gray-500 uppercase"
            >
              not synced
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</nav>
