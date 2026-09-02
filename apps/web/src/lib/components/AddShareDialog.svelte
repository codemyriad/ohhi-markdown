<script lang="ts">
  import { looksLikeShareLink } from '../share-link.js'

  interface Props {
    /** Existing dirs, offered as destination suggestions. */
    dirs: string[]
    /** Runs the join; resolves when the mount is live. */
    onJoin: (link: string, destPath: string) => Promise<void>
    onClose: () => void
  }

  let { dirs, onJoin, onClose }: Props = $props()

  let link = $state('')
  let dest = $state('')
  let busy = $state(false)
  let error = $state('')

  const ready = $derived(looksLikeShareLink(link) && dest.trim() !== '')

  async function join(): Promise<void> {
    busy = true
    error = ''
    try {
      await onJoin(link, dest)
      onClose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Add a shared folder"
  data-testid="add-share-dialog"
  class="fixed inset-0 z-20 flex items-center justify-center bg-black/30"
>
  <div class="w-96 rounded border border-gray-200 bg-white p-4 text-gray-800 shadow-xl">
    <h2 class="text-sm font-semibold">Add a shared folder</h2>
    <p class="mt-1 text-xs text-gray-600">
      Paste a share link and pick where it lives in this vault. The folder must be new or empty —
      it fills with the shared content and stays in sync alongside your local notes.
    </p>

    <label class="mt-3 block">
      <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Share link</span>
      <textarea
        data-testid="add-share-link"
        bind:value={link}
        rows="2"
        placeholder="editor1:…"
        class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 font-mono text-[11px] focus:border-blue-500 focus:outline-none"
      ></textarea>
    </label>

    <label class="mt-2 block">
      <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
        Destination folder
      </span>
      <input
        data-testid="add-share-dest"
        bind:value={dest}
        list="add-share-dirs"
        placeholder="e.g. shared/team"
        class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
      />
      <datalist id="add-share-dirs">
        {#each dirs as d (d)}<option value={d}></option>{/each}
      </datalist>
    </label>

    {#if error}
      <p class="mt-2 text-xs text-red-600" data-testid="add-share-error">{error}</p>
    {/if}

    <div class="mt-3 flex justify-end gap-2">
      <button
        data-testid="add-share-cancel"
        onclick={onClose}
        class="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        data-testid="add-share-join"
        disabled={!ready || busy}
        onclick={() => void join()}
        class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Joining…' : 'Join into this vault'}
      </button>
    </div>
  </div>
</div>
