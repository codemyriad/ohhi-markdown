<script lang="ts">
  /**
   * The header's one line about the open note: its folders as buttons that
   * reveal the folder in the navigator, then the note's name. This is where
   * "where am I" lives now that the header carries nothing else.
   */
  import { ChevronRight } from '@lucide/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'

  interface Props {
    path: string | null
    onReveal: (dir: string) => void
  }

  let { path, onReveal }: Props = $props()

  const t = $derived($LL.web.breadcrumb)
  const parts = $derived(path ? path.split('/') : [])
  const dirs = $derived(parts.slice(0, -1))
  const name = $derived(parts.at(-1)?.replace(/\.md$/i, '') ?? '')
</script>

{#if path}
  <nav aria-label={t.label()} data-testid="breadcrumb" class="min-w-0">
    <ol class="flex min-w-0 items-center gap-0.5 text-sm">
      {#each dirs as dir, i (i)}
        {@const full = dirs.slice(0, i + 1).join('/')}
        <li class="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="crumb:{full}"
            onclick={() => onReveal(full)}
            title={t.show_in_navigator({ path: full })}
            class="truncate rounded px-1 py-0.5 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
          >
            {dir}
          </button>
          <ChevronRight size={12} aria-hidden="true" class="shrink-0 text-base-content/70" />
        </li>
      {/each}
      <li aria-current="page" data-testid="crumb-note" class="truncate px-1 font-medium text-base-content">
        {name}
      </li>
    </ol>
  </nav>
{:else}
  <span data-testid="breadcrumb" class="text-sm text-base-content/70">{t.no_note()}</span>
{/if}
