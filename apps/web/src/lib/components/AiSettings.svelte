<script lang="ts">
  /**
   * Settings › AI: the one AI surface that exists at rest — it is where a
   * provider is added. The egress sentence sits above the sub-tabs:
   * Providers always, Skills only once a provider exists (with none, nothing
   * can run a skill, and importing one is an AI act like any other).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { aiEnabled } from '../ai-config.svelte.js'
  import Tabs from '../ui/Tabs.svelte'
  import ProvidersSettings from './ProvidersSettings.svelte'
  import SkillsSettings from './SkillsSettings.svelte'

  const t = $derived($LL.web.ai.settings)
  const TABS = $derived(
    (aiEnabled() ? (['providers', 'skills'] as const) : (['providers'] as const)).map((value) => ({
      value,
      label: t.tabs[value](),
      testid: `ai-settings-tab:${value}`,
    }))
  )
  let chosen = $state<string>('providers')
  // The last provider removed while on Skills: back to Providers.
  const tab = $derived(TABS.some((x) => x.value === chosen) ? chosen : 'providers')
</script>

<div data-testid="ai-settings" class="space-y-3">
  <Tabs tabs={TABS} bind:value={() => tab, (v) => (chosen = v)} label={t.sections()} testid="ai-settings-tabs">
    {#snippet panel(id)}
      <div class="pt-3">
        {#if id === 'providers'}
          <ProvidersSettings />
        {:else if id === 'skills'}
          <SkillsSettings />
        {/if}
      </div>
    {/snippet}
  </Tabs>
</div>
