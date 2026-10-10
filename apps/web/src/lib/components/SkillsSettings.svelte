<script lang="ts">
  /**
   * Settings › AI › Skills (writing-harness-shaping B9). Wave 0's
   * placeholder — builder C fills it (the vault's `.agents/skills/`, each
   * skill's validation findings).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { HEADING } from '../ui/styles.js'
</script>

<section data-testid="ai-skills" aria-labelledby="ai-skills-title">
  <h3 id="ai-skills-title" class="m-0 {HEADING}">{$LL.web.ai.skills.title()}</h3>
</section>
