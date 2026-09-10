<script lang="ts">
  /**
   * A tab's context menu (tab-groups B9) — and the reason no gesture in the
   * strip is drag-only (R8): *Move to pane* is what a drag onto another pane
   * does, from the keyboard.
   *
   * It is the shell's `DropdownMenu` (arrows, Home/End, typeahead, Escape,
   * focus return) anchored to a zero-size trigger placed where the pointer
   * was — a right-click has no button of its own to hang a menu on, and a
   * hand-rolled `role="menu"` would owe all of that behaviour again.
   */
  import { melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { basename } from '@editor/index'
  import { activeTab, panes as panesOf, type Pane, type Tab } from '../panes.js'
  import DropdownMenu, {
    type MenuItemAttrs,
    type MenuSeparatorAttrs,
  } from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'

  interface Props {
    tab: Tab
    pane: Pane
    panes: PaneShell
    name: string
    at: { x: number; y: number }
    /** W2 (C1): *Add to group ▸*, *Close group*, *Copy links*. */
    groupItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Tab]>
    onClose: () => void
  }

  let { tab, pane, panes, name, at, groupItems, onClose }: Props = $props()

  const t = $derived($LL.web.tabs)
  const others = $derived(
    panesOf(panes.layout.tree)
      .filter((p) => p.id !== pane.id)
      .map((p) => {
        const held = activeTab(p)
        return {
          id: p.id,
          index: panes.paneIndex(p.id),
          note: held?.path ? basename(held.path) : '',
        }
      })
  )

  let open = $state(true)
  $effect(() => {
    if (!open) onClose()
  })

  function act(run: () => void): void {
    run()
    onClose()
  }
</script>

<div class="fixed z-40" style="left: {at.x}px; top: {at.y}px">
  <DropdownMenu bind:open testid="tab-menu">
    {#snippet trigger(attrs)}
      <!-- The anchor, not a control: it exists so the menu has somewhere to
           attach at the pointer. -->
      <button
        use:melt={attrs}
        type="button"
        tabindex="-1"
        aria-label={t.menu({ name })}
        class="block size-px opacity-0"
      ></button>
    {/snippet}
    {#snippet children(attrs)}
      <MenuItem
        item={attrs.item}
        testid="tab-menu:pin"
        onSelect={() => act(() => panes.togglePin(tab.id))}
      >
        {tab.pinned ? t.unpin() : t.pin()}
      </MenuItem>
      {#if groupItems}{@render groupItems(attrs, tab)}{/if}
      {#if others.length > 0}
        <MenuSeparator separator={attrs.separator} />
        <div role="group" aria-label={t.move_to_pane()}>
          <p aria-hidden="true" class="px-3 pt-1 pb-0.5 text-[10px] tracking-wider text-base-content/70 uppercase">
            {t.move_to_pane()}
          </p>
          {#each others as other (other.id)}
            <MenuItem
              item={attrs.item}
              testid="tab-menu:move:{other.id}"
              onSelect={() => act(() => panes.moveTabToPane(tab.id, other.id))}
            >
              <span class="flex w-full items-baseline gap-2">
                <span>{$LL.web.panes.label({ n: other.index })}</span>
                {#if other.note}
                  <span class="min-w-0 flex-1 truncate text-right text-xs text-base-content/70">
                    {other.note}
                  </span>
                {/if}
              </span>
            </MenuItem>
          {/each}
        </div>
      {/if}
      <MenuSeparator separator={attrs.separator} />
      <MenuItem
        item={attrs.item}
        testid="tab-menu:close"
        disabled={tab.pinned}
        reason={tab.pinned ? t.pinned() : undefined}
        onSelect={() => act(() => panes.closeTab(tab.id))}
      >
        {t.commands.close()}
      </MenuItem>
      <MenuItem
        item={attrs.item}
        testid="tab-menu:close-others"
        onSelect={() => act(() => panes.closeOthersIn(pane.id))}
      >
        {$LL.web.panes.commands.close_others()}
      </MenuItem>
      <MenuItem
        item={attrs.item}
        testid="tab-menu:close-pane"
        onSelect={() => act(() => panes.closePaneById(pane.id))}
      >
        {$LL.web.panes.commands.close_pane()}
      </MenuItem>
    {/snippet}
  </DropdownMenu>
</div>
