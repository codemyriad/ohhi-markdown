<script lang="ts">
  import { LL } from '@ohhi/i18n/i18n-svelte'
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

  const t = $derived($LL.web.tree_op)
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
        ? t.new_folder_in({ path })
        : t.new_folder()
      : mode === 'rename'
        ? t.rename({ name: basename })
        : mode === 'move'
          ? t.move({ name: basename })
          : kind === 'dir'
            ? t.delete_folder({ name: basename })
            : t.delete_file({ name: basename })
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
        aria-label={mode === 'rename' ? t.new_name() : t.folder_name()}
        class="w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
    {:else if mode === 'move'}
      <label class="block">
        <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.destination()}</span>
        <select
          data-testid="tree-op-dest"
          bind:value={dest}
          class="mt-1 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          {#each targets as d (d)}
            <option value={d}>{d === '' ? t.vault_root() : d}</option>
          {/each}
        </select>
      </label>
    {:else}
      <p class="text-sm text-base-content/70">
        {kind === 'dir' ? t.delete_folder_body() : t.delete_file_body()}
      </p>
    {/if}

    <div class="mt-4 flex justify-end gap-2">
      <button
        type="button"
        data-testid="tree-op-cancel"
        onclick={onCancel}
        class="rounded border border-base-300 px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
      >
        {$LL.common.cancel()}
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
        {mode === 'delete'
          ? t.confirm.delete()
          : mode === 'move'
            ? t.confirm.move()
            : mode === 'rename'
              ? t.confirm.rename()
              : t.confirm.create()}
      </button>
    </div>
  </form>
</Dialog>
