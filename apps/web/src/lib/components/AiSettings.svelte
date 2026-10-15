<script lang="ts">
  /**
   * Settings › AI as one page (QA round 1, QA3; Fork 11): no sub-tabs. The
   * egress sentence is the section's lede (`Settings.svelte` draws it); then
   * three groups, each an eyebrow with its actions on the same baseline:
   *
   *  1. Providers — one row per provider, the per-provider egress line under it;
   *  2. Skills in this vault — only once a provider exists, as the Skills tab
   *     was: with none, nothing can run a skill, and importing one is an AI
   *     act like any other (the quiet default);
   *  3. Outside agents — Claude Code, an MCP client or a terminal working on
   *     the vault with `ohhi` (Settings › Agents until QA round 1), which needs
   *     no provider and so is always here.
   */
  import { aiEnabled } from '../ai-config.svelte.js'
  import { GROUP } from '../ui/styles.js'
  import AgentSettings from './AgentSettings.svelte'
  import ProvidersSettings from './ProvidersSettings.svelte'
  import SkillsSettings from './SkillsSettings.svelte'
</script>

<div data-testid="ai-settings">
  <ProvidersSettings />
  {#if aiEnabled()}
    <div class={GROUP}><SkillsSettings /></div>
  {/if}
  <div class={GROUP}><AgentSettings /></div>
</div>
