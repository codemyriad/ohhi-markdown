<script lang="ts">
  import Tabs from '../Tabs.svelte'

  let { orientation = 'horizontal' }: { orientation?: 'horizontal' | 'vertical' } = $props()
  let value = $state('general')
</script>

<Tabs
  label="Settings sections"
  tabs={[
    { value: 'general', label: 'General' },
    { value: 'sync', label: 'Sync' },
    { value: 'dev', label: 'Developer' },
  ]}
  bind:value
  {orientation}
  testid="tabs"
>
  {#snippet panel(v)}
    <p data-testid="panel">{v} panel</p>
  {/snippet}
</Tabs>
<span data-testid="value">{value}</span>
