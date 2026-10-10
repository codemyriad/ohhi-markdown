<script lang="ts">
  /**
   * The Session view (writing-harness-shaping B4): a view tab whose argument
   * is the session id. Wave 0's placeholder — builder B replaces it with the
   * transcript, the composer and the session list. Registered in `VIEWS`,
   * listed only while a provider exists (`ViewContext.ai()`, R1).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ViewProps } from '../views.js'

  let { tab }: ViewProps = $props()
</script>

<section
  data-testid="session-view"
  data-session={tab.viewArg ?? ''}
  aria-label={$LL.web.ai.session.title()}
  class="h-full min-h-0 overflow-y-auto bg-base-200 text-sm text-base-content"
>
  <p data-testid="session-empty" class="m-0 p-4 text-base-content/70">{$LL.web.ai.session.empty()}</p>
</section>
