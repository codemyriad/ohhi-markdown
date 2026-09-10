<script lang="ts">
  import Tabs from '../Tabs.svelte'

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
>
  {#snippet panel(v)}
    <p data-testid="panel">{v} panel</p>
  {/snippet}
</Tabs>
<span data-testid="value">{value}</span>
