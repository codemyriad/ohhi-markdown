<script lang="ts">
  interface Props {
    mode: 'new-folder' | 'rename' | 'move' | 'delete'
    /** Target path for rename/move/delete; the parent dir for new-folder ('' = root). */
    path: string
    kind: 'dir' | 'text' | 'binary'
    /** Move destinations ('' = vault root is offered implicitly). */
    dirs: string[]
    onConfirm: (value: string) => void
    onCancel: () => void
  }

  let { mode, path, kind, dirs, onConfirm, onCancel }: Props = $props()

  const basename = $derived(path.slice(path.lastIndexOf('/') + 1))
  const parentDir = $derived(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

  // svelte-ignore state_referenced_locally -- seeded once (fresh mount per op), then user-owned.
  let name = $state(mode === 'rename' ? path.slice(path.lastIndexOf('/') + 1) : '')
  // Move: exclude the target itself and anything inside it (a dir can't move into itself).
  const targets = $derived([
    '',
    ...dirs.filter((d) => d !== path && !d.startsWith(`${path}/`) && d !== parentDir),
  ])
  let dest = $state('')

  const title = $derived(
    mode === 'new-folder'
      ? path
        ? `New folder in ${path}`
        : 'New folder'
      : mode === 'rename'
        ? `Rename ${basename}`
        : mode === 'move'
          ? `Move ${basename}`
          : `Delete ${kind === 'dir' ? 'folder' : 'file'} ${basename}?`
  )

  const confirmDisabled = $derived(
    (mode === 'new-folder' || mode === 'rename') && !name.trim()
  )

  function submit(): void {
    if (confirmDisabled) return
    if (mode === 'move') onConfirm(dest)
    else onConfirm(name.trim())
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter') submit()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-30 flex items-start justify-center bg-neutral/40 pt-24"
  onclick={(e) => {
    if (e.target === e.currentTarget) onCancel()
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="tree-op-title"
    data-testid="tree-op-dialog"
    class="w-full max-w-sm rounded-lg border border-base-300 bg-base-100 p-4 shadow-xl"
  >
    <h2 id="tree-op-title" class="text-sm font-semibold text-base-content">{title}</h2>

    {#if mode === 'new-folder' || mode === 'rename'}
      <!-- svelte-ignore a11y_autofocus — focus belongs in the dialog's one input -->
      <input
        data-testid="tree-op-name"
        bind:value={name}
        autofocus
        aria-label={mode === 'rename' ? 'New name' : 'Folder name'}
        class="mt-3 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
    {:else if mode === 'move'}
      <label class="mt-3 block">
        <span class="text-xs font-semibold tracking-wide text-base-content/60 uppercase">Destination</span>
        <select
          data-testid="tree-op-dest"
          bind:value={dest}
          class="mt-1 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          {#each targets as d (d)}
            <option value={d}>{d === '' ? '(vault root)' : d}</option>
          {/each}
        </select>
      </label>
    {:else}
      <p class="mt-3 text-sm text-base-content/70">
        {#if kind === 'dir'}
          Everything inside is removed for you and for everyone sharing it. Pre-images are
          journaled and files can be restored.
        {:else}
          Removed for you and for everyone sharing it. The pre-image is journaled.
        {/if}
      </p>
    {/if}

    <div class="mt-4 flex justify-end gap-2">
      <button
        data-testid="tree-op-cancel"
        onclick={onCancel}
        class="rounded border border-base-300 px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
      >
        Cancel
      </button>
      <button
        data-testid="tree-op-confirm"
        onclick={submit}
        disabled={confirmDisabled}
        class="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50
          {mode === 'delete'
            ? 'bg-error text-error-content hover:bg-error/90'
            : 'bg-primary text-primary-content hover:bg-primary/90'}"
      >
        {mode === 'delete' ? 'Delete' : mode === 'move' ? 'Move' : mode === 'rename' ? 'Rename' : 'Create'}
      </button>
    </div>
  </div>
</div>
