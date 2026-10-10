<script lang="ts">
  /**
   * The Help menu (first-run-shaping E1): the guides, the shortcuts, what's
   * new, Report a problem — and, at its foot, the running version with the
   * updater's last outcome, honestly (`versionLine`: "up to date" only when
   * the last check found nothing).
   *
   * Every row is a `help.*` command id run through `runHelp` — the same
   * function the palette's rows call (shell-commands.ts), so a row and its
   * command are one action. Open state is `help.menuOpen`, so `openHelp()`
   * and the `help.menu` command open whichever menu is mounted.
   *
   * The toolbar draws it as the `help` readout; the vault manager can render
   * it with a trigger of its own (`trigger` snippet).
   */
  import { CircleHelp } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { untrack, type Snippet } from 'svelte'
  import { help, runHelp, versionLine, type HelpCommandId } from '../help.svelte.js'
  import { clockTick } from '../relative-time.js'
  import DropdownMenu, { type MenuTrigger } from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import type { MenuPlacement } from '../ui/placement.js'

  interface Props {
    placement?: MenuPlacement
    /** A trigger of the host's own (the manager's help icon); default: the toolbar's icon button. */
    trigger?: Snippet<[MenuTrigger]>
    /** Injected for the tests; the updater's clock otherwise. */
    clock?: Clock
    testid?: string
  }

  let { placement = 'bottom-end', trigger: ownTrigger, clock = help.clock, testid = 'help-menu' }: Props = $props()

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)
  const t = $derived($LL.web.help)
  const version = $derived(versionLine(help.version, help.update, $tick, $LL))

  // Untracked: the count is written, never a dependency of this effect.
  $effect(() => {
    untrack(() => (help.menus += 1))
    return () => untrack(() => (help.menus -= 1))
  })

  function run(id: HelpCommandId): void {
    help.menuOpen = false
    runHelp(id)
  }
</script>

<DropdownMenu {placement} testid="{testid}-list" bind:open={help.menuOpen}>
  {#snippet trigger(attrs)}
    {#if ownTrigger}
      {@render ownTrigger(attrs)}
    {:else}
      <button
        use:melt={attrs}
        type="button"
        aria-label={t.label()}
        title={t.label()}
        data-testid={testid}
        class="inline-flex shrink-0 items-center rounded p-1 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      >
        <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/if}
  {/snippet}
  {#snippet children(attrs)}
    <div class="w-72 max-w-[calc(100vw-2rem)]">
      <MenuItem item={attrs.item} testid="help:start" onSelect={() => run('help.start')}>
        <span class="flex items-baseline justify-between gap-3">
          <span>{t.menu.start()}</span>
          <span class="text-xs text-base-content/70">{t.menu.start_time()}</span>
        </span>
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:shortcuts" onSelect={() => run('help.shortcuts')}>
        {t.menu.shortcuts()}
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:recovery" onSelect={() => run('help.recovery')}>
        {t.menu.recovery()}
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:sharing" onSelect={() => run('help.sharing')}>
        {t.menu.sharing()}
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:customise" onSelect={() => run('help.customise')}>
        {t.menu.customise()}
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:agents" onSelect={() => run('help.agents')}>
        {t.menu.agents()}
      </MenuItem>
      <MenuSeparator separator={attrs.separator} />
      <MenuItem item={attrs.item} testid="help:changes" onSelect={() => run('help.changes')}>
        {help.version ? t.menu.changes({ version: help.version }) : t.menu.changes_plain()}
      </MenuItem>
      <MenuItem item={attrs.item} testid="help:report" onSelect={() => run('help.report')}>
        {t.menu.report()}
      </MenuItem>
      <MenuSeparator separator={attrs.separator} />
      <!-- Not a row: a fact. `role=none` keeps it out of the menu's item
           list (arrows skip it); "What's new in <version>" above already
           names the version to a screen reader. -->
      <div role="none" data-testid="help-version" class="px-3 py-1.5 text-[11px] leading-snug text-base-content/70">
        {version}
      </div>
    </div>
  {/snippet}
</DropdownMenu>
