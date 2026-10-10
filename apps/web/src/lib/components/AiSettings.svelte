<script lang="ts">
  /**
   * Settings › AI (writing-harness-shaping B1): the one AI surface that exists
   * at rest — it is where a provider is added (R1). The egress sentence sits
   * above two sub-tabs: Providers (builder A) and Skills (builder C).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Tabs from '../ui/Tabs.svelte'
  import ProvidersSettings from './ProvidersSettings.svelte'
  import SkillsSettings from './SkillsSettings.svelte'

  const t = $derived($LL.web.ai.settings)
  const TABS = $derived(
    (['providers', 'skills'] as const).map((value) => ({
      value,
      label: t.tabs[value](),
      testid: `ai-settings-tab:${value}`,
    }))
  )
  let tab = $state<string>('providers')
</script>

<div data-testid="ai-settings" class="space-y-3">
  <p data-testid="ai-settings-egress" class="m-0 text-sm text-base-content/80">{t.egress()}</p>
  <Tabs tabs={TABS} bind:value={tab} label={t.sections()} testid="ai-settings-tabs">
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
