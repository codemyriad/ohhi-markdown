<script lang="ts">
  /**
   * The rail's History section (V2d, slice W3): the pre-image journal for the
   * open note, newest first, with a Restore per row.
   *
   * Nothing new is recorded to make this work — golden rule 1 already writes a
   * pre-image before every Editor-initiated write, so this section is a READER
   * of a durable log that exists whether or not anyone looks at it. It claims
   * only what the log holds: a time and a size. No author, no reason, no diff.
   *
   * Restoring goes back through the vault (`Workspace.restorePreImage`), never
   * near the disk: the CRDT moves first so peers see an ordinary edit, and the
   * bytes being replaced are journaled, which is why the confirm can promise
   * that a restore is undoable from this same list.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import { formatSize, formatStamp } from '../history.js'
  import type { PreImageInfo } from '../workspace.svelte.js'
  import ConfirmDialog from './ConfirmDialog.svelte'

  interface Props {
    /** The focused note, or null when nothing is open. */
    path: string | null
    /** Pre-images for a path, newest first. */
    load: (path: string) => Promise<PreImageInfo[]>
    restore: (path: string, seq: number) => Promise<void>
    /**
     * The open note's `diskMatchesCrdt`. Every flip of it is Editor writing
     * the file, which is exactly when a pre-image is journaled — so this is
     * what tells the list it has gone stale while you were looking at it.
     */
    written?: boolean
    /** Injected clock (golden rule 5): decides which rows read as "today". */
    now?: () => number
  }

  let { path, load, restore, written = true, now = () => Date.now() }: Props = $props()

  const t = $derived($LL.web.history)

  let entries = $state<PreImageInfo[] | null>(null)
  let pending = $state<PreImageInfo | null>(null)
  /** Bumped after a restore so the list re-reads the journal it just changed. */
  let revision = $state(0)

  const name = $derived(path ? (path.split('/').pop() ?? path) : '')

  /** Which path `entries` describes — a plain let, so writing it re-runs nothing. */
  let loadedPath: string | null = null

  $effect(() => {
    const p = path
    revision
    written // a write journaled a new version: re-read
    if (!p) {
      entries = null
      loadedPath = null
      return
    }
    // A different note starts from nothing; a re-read of the SAME note keeps
    // what is on screen, so the list does not blink on every keystroke's flush.
    if (loadedPath !== p) {
      entries = null
      loadedPath = p
    }
    let live = true
    void (async () => {
      const rows = await load(p)
      // A slower read that resolves after the focus moved on must not land.
      if (live) entries = rows
    })()
    return () => {
      live = false
    }
  })

  async function confirmRestore(): Promise<void> {
    const entry = pending
    pending = null
    if (!entry || !path) return
    await restore(path, entry.seq)
    revision++
  }
</script>

<div data-testid="history-section" class="flex flex-col gap-2 px-3 py-2 text-xs text-base-content/80">
  {#if !path}
    <p class="text-base-content/70">{t.no_note()}</p>
  {:else if entries === null}
    <p class="text-base-content/70">{t.loading()}</p>
  {:else if entries.length === 0}
    <p data-testid="history-empty" class="text-base-content/70">{t.empty()}</p>
  {:else}
    <ol aria-label={t.list_label({ name })} class="divide-y divide-base-200">
      {#each entries as entry (entry.seq)}
        <li
          data-testid="history-entry:{entry.seq}"
          class="flex items-center justify-between gap-2 py-1.5"
        >
          <span class="flex min-w-0 flex-col">
            <time datetime={new Date(entry.at).toISOString()} class="truncate">
              {formatStamp(entry.at, now())}
            </time>
            <span class="text-[10px] text-base-content/70">{formatSize(entry.size)}</span>
          </span>
          <button
            type="button"
            data-testid="history-restore:{entry.seq}"
            aria-label={t.restore_this({ time: formatStamp(entry.at, now()) })}
            onclick={() => (pending = entry)}
            class="shrink-0 rounded border border-base-300 px-2 py-1 text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          >
            {t.restore()}
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</div>

{#if pending && path}
  <ConfirmDialog
    title={t.confirm.title({ name, time: formatStamp(pending.at, now()) })}
    body={t.confirm.body()}
    confirmLabel={t.confirm.confirm()}
    testid="history-confirm"
    onConfirm={() => void confirmRestore()}
    onCancel={() => (pending = null)}
  />
{/if}
