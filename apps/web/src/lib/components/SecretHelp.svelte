<script lang="ts">
  /**
   * *Where do I get this?* (first-run-shaping D2): where the operator secret
   * lives, from the build (`VITE_TEAM_SECRET_HINT`) when it says, else the
   * generic sentence. One component for the share sheet, Settings › Sync and
   * the device-link dialog, so the three never word it differently.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { TEAM_SECRET_HINT } from '../config.js'

  interface Props {
    /** The build's hint; injectable for tests. */
    hint?: string
    testid?: string
  }

  let { hint = TEAM_SECRET_HINT, testid = 'secret-where' }: Props = $props()

  const t = $derived($LL.web.relay_card.secret)
</script>

<details data-testid={testid} class="mt-1 text-xs text-base-content/80">
  <summary
    class="cursor-pointer font-medium text-base-content underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
  >
    {t.where()}
  </summary>
  <p data-testid="{testid}-body" class="mt-1">{hint ? t.where_team({ hint }) : t.where_generic()}</p>
</details>
