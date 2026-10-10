<script lang="ts">
  /**
   * Settings › AI › Providers (writing-harness-shaping B1). Wave 0's
   * placeholder — builder A fills it (the provider list, the add/edit form,
   * *Test connection*, the per-provider egress line) over `ai-providers.ts`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { HEADING } from '../ui/styles.js'
</script>

<section data-testid="ai-providers" aria-labelledby="ai-providers-title">
  <h3 id="ai-providers-title" class="m-0 {HEADING}">{$LL.web.ai.providers.title()}</h3>
</section>
