<script lang="ts">
  import Dialog from '../ui/Dialog.svelte'

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

  // Focus lands in the one input when there is one; Melt's default (first
  // tabbable) would pick the Cancel button on the delete confirm, which is
  // exactly right there.
  const openFocus = $derived(
    mode === 'new-folder' || mode === 'rename' ? '[data-testid="tree-op-name"]' : undefined
  )
</script>

<Dialog {title} width="sm" align="top" testid="tree-op-dialog" {openFocus} onClose={onCancel}>
  <form
    onsubmit={(e) => {
      e.preventDefault()
      submit()
    }}
  >
    {#if mode === 'new-folder' || mode === 'rename'}
      <input
        data-testid="tree-op-name"
        bind:value={name}
        aria-label={mode === 'rename' ? 'New name' : 'Folder name'}
        class="w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
    {:else if mode === 'move'}
      <label class="block">
        <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Destination</span>
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
      <p class="text-sm text-base-content/70">
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
        type="button"
        data-testid="tree-op-cancel"
        onclick={onCancel}
        class="rounded border border-base-300 px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
      >
        Cancel
      </button>
      <button
        type="submit"
        data-testid="tree-op-confirm"
        disabled={confirmDisabled}
        class="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50
          {mode === 'delete'
            ? 'bg-error text-error-content hover:bg-error/90'
            : 'bg-primary text-primary-content hover:bg-primary/90'}"
      >
        {mode === 'delete' ? 'Delete' : mode === 'move' ? 'Move' : mode === 'rename' ? 'Rename' : 'Create'}
      </button>
    </div>
  </form>
</Dialog>
