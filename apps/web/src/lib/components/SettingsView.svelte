<script lang="ts">
  /**
   * The `settings` view tab (settings-shaping ST1, Fork 1): Settings beside
   * your notes, splittable and movable like the Inspector, the Log and
   * Shared. One per window (`ONE_PER_WINDOW` in panes.ts): opening it again
   * focuses this tab and switches its section. The section is the tab's
   * `viewArg`, so it is restored across reloads with the rest of the layout.
   *
   * The body is `Settings.svelte`, handed the shell's `SettingsHost`
   * (App.svelte sets it as a context — a pane renders a view with only
   * `{workspace, tab}`). Moving between sections reopens the view at the new
   * section, which rewrites this tab's `viewArg` in place.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { settingsSection, type SettingsSection } from '../settings.js'
  import { getSettingsHost, type SettingsHost } from '../settings-host.js'
  import { getViewShell, type ViewProps, type ViewShell } from '../views.js'
  import Settings from './Settings.svelte'

  interface Props extends ViewProps {
    /** Injected for the tests; the shell's (via context) otherwise. */
    host?: SettingsHost | null
    shell?: ViewShell | null
  }

  let { tab, host = getSettingsHost(), shell = getViewShell() }: Props = $props()

  const section = $derived(settingsSection(tab.viewArg))
  // svelte-ignore state_referenced_locally -- the fallback only matters with no shell (a unit test)
  let local = $state<SettingsSection | null>(null)

  function move(next: SettingsSection): void {
    if (shell) shell.openView('settings', next)
    else local = next
  }
</script>

<section
  data-testid="settings-view"
  aria-label={$LL.web.settings.title()}
  class="h-full min-h-0 overflow-y-auto bg-base-100 text-[13px] text-base-content"
>
  {#if host}
    <Settings {...host} section={local ?? section} onSection={move} host="view" />
  {/if}
</section>
