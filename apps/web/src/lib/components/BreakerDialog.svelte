<script lang="ts">
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Dialog from '../ui/Dialog.svelte'

  interface Props {
    paths: string[]
    onConfirm: () => void
    onDismiss: () => void
  }

  let { paths, onConfirm, onDismiss }: Props = $props()

  const t = $derived($LL.web.breaker)
  const SHOWN = 10
  const shown = $derived(paths.slice(0, SHOWN))
</script>

<!-- Mass-change breaker (golden rule / D2): a git-branch-switch-shaped batch
     is HELD until confirmed — nothing is ingested or enrolled meanwhile.
     Escape = "Not now" (safe: nothing happens); the scrim is inert. -->
<Dialog
  role="alertdialog"
  title={t.title({ count: paths.length })}
  description={t.description()}
  closeOnOutsideClick={false}
  align="top"
  testid="breaker-dialog"
  onClose={onDismiss}
>
  <ul class="max-h-40 overflow-y-auto rounded bg-base-200 p-2 font-ed-mono text-[11px] text-base-content/80">
    {#each shown as p (p)}
      <li class="truncate">{p}</li>
    {/each}
    {#if paths.length > SHOWN}
      <li class="text-base-content/70">{t.more({ count: paths.length - SHOWN })}</li>
    {/if}
  </ul>
  <div class="mt-4 flex justify-end gap-2">
    <button
      type="button"
      data-testid="breaker-dismiss"
      onclick={onDismiss}
      class="rounded border border-base-300 px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
    >
      {t.dismiss()}
    </button>
    <button
      type="button"
      data-testid="breaker-confirm"
      onclick={onConfirm}
      class="rounded bg-warning px-3 py-1.5 text-sm font-medium text-warning-content hover:bg-warning/90"
    >
      {t.apply()}
    </button>
  </div>
</Dialog>
