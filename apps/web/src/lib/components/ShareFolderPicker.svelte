<script lang="ts">
  /**
   * *Share a folder…* with no folder in hand (the Shared view's door,
   * sharing E2): pick one, then the share sheet takes over. The list is
   * `shareableDirs` — the tree menu's own rule, so a folder the menu refuses
   * (inside a shared folder, or holding one) is never offered here either.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Dialog from '../ui/Dialog.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    /** The folders that may be shared, sorted. */
    dirs: string[]
    onPick: (dir: string) => void
    onClose: () => void
  }

  let { dirs, onPick, onClose }: Props = $props()

  const t = $derived($LL.web.shared.pick)
  // svelte-ignore state_referenced_locally -- seed only
  let chosen = $state(dirs[0] ?? '')
</script>

<Dialog title={t.title()} description={t.help()} testid="share-folder-picker" width="sm" {onClose}>
  {#if dirs.length === 0}
    <p data-testid="share-folder-none" class="text-sm text-base-content/80">{t.none()}</p>
  {:else}
    <form
      class="space-y-3"
      onsubmit={(e) => {
        e.preventDefault()
        if (chosen) onPick(chosen)
      }}
    >
      <label class="flex flex-col gap-1 text-sm text-base-content/80">
        {t.label()}
        <select
          data-testid="share-folder-select"
          bind:value={chosen}
          class="rounded border border-base-300 bg-base-100 px-2 py-1 font-ed-mono text-sm text-base-content"
        >
          {#each dirs as dir (dir)}
            <option value={dir}>{dir}</option>
          {/each}
        </select>
      </label>
      <div class="flex justify-end gap-2">
        <button type="button" onclick={onClose} class="{OUTLINE_BUTTON} px-3 py-1 text-sm text-base-content/80"
          >{$LL.common.cancel()}</button
        >
        <button
          type="submit"
          data-testid="share-folder-next"
          class="rounded bg-primary px-3 py-1 text-sm text-primary-content focus-visible:outline-2 focus-visible:outline-primary"
          >{t.next()}</button
        >
      </div>
    </form>
  {/if}
</Dialog>
