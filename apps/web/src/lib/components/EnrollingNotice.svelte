<script lang="ts">
  /**
   * The server is enrolling the open vault's folder (`custodian:
   * 'enrolling'`, nextcloud-build decision 6): "Enrolling… N of M" from the
   * status's `files`, until the custodian runs. Read by
   * `nextcloud/holds.svelte.ts`, which re-reads every 5 s while it lasts.
   * Not modal: a line over the editor's top edge, like the holds notice.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { LAYER } from '../ui/Dialog.svelte'
  import { CARD } from '../ui/styles.js'

  let { progress }: { progress: { done: number; total: number } | null } = $props()
  const t = $derived($LL.web.nextcloud.host)
</script>

{#if progress}
  <p
    role="status"
    data-testid="nc-enrolling"
    data-done={progress.done}
    data-total={progress.total}
    class="{CARD} {LAYER.panel} fixed top-14 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs text-base-content shadow-lg"
  >
    {progress.total > 0 ? t.enrolling({ done: progress.done, total: progress.total }) : t.enrolling_start()}
  </p>
{/if}
