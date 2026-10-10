<script lang="ts">
  /**
   * Settings › Customise — a placeholder until settings-shaping ST4 (wave B)
   * fills it: the three roots, one row per resource kind, problems, Reload,
   * Open folder, Copy as JSON. `Settings.svelte` draws the heading; with no
   * vault open it draws the "open a vault" notice instead of this (NEEDS_VAULT).
   * What the section knows about where it is: `getSettingsEnv()`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
</script>

<p class="text-xs text-base-content/70" data-testid="settings-customise">{$LL.web.settings.customise.intro()}</p>
