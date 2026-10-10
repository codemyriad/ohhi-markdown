<script lang="ts">
  /**
   * Settings › Agents — a placeholder until settings-shaping ST5 (wave B)
   * fills it: what an agent can do, the three setup routes filled in with
   * this vault's path, and in a browser the honest explanation (Fork 5).
   * `Settings.svelte` draws the heading. Where it is drawn — vault open or
   * not, desktop or browser, the vault's path — comes from `getSettingsEnv()`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
</script>

<p class="text-xs text-base-content/70" data-testid="settings-agents">{$LL.web.settings.agents.intro()}</p>
