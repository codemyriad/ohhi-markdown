<script lang="ts">
  /**
   * `mode` (quiet-shell F6, read B3): the focused tab's view mode and the
   * one-of-three menu that changes it — the status bar's menu, the same
   * `menuitemradio` rows, following focus.
   */
  import { ChevronDown } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { VIEW_MODES } from '../../panes.js'
  import { readoutPlacement, readoutTestid, targetOf, type ReadoutContext } from '../../readouts.js'
  import DropdownMenu from '../../ui/DropdownMenu.svelte'
  import MenuItem from '../../ui/MenuItem.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const focused = $derived(targetOf(ctx))
  const mode = $derived(ctx.panes.modeOf(focused.tab))
  const testid = $derived(readoutTestid(ctx, 'mode-menu'))
  const r = $derived($LL.web.read)
  const placement = $derived(readoutPlacement(ctx))
</script>

{#if focused.path && focused.tab}
  {@const tabId = focused.tab.id}
  {#key placement}
    <DropdownMenu {placement} testid="{testid}-list">
      {#snippet trigger(attrs)}
        <button
          use:melt={attrs}
          type="button"
          data-testid={testid}
          aria-label={r.mode_menu()}
          class="flex items-center gap-1 rounded px-1.5 py-0.5 whitespace-nowrap text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
        >
          {r.modes[mode]()}
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      {/snippet}
      {#snippet children(attrs)}
        {#each VIEW_MODES as value (value)}
          <MenuItem
            item={attrs.item}
            checked={mode === value}
            testid="{testid}:{value}"
            onSelect={() => ctx.panes.setMode(tabId, value)}
          >
            {r.modes[value]()}
          </MenuItem>
        {/each}
      {/snippet}
    </DropdownMenu>
  {/key}
{/if}
