<script lang="ts">
  /**
   * The inspector's door (Chris, 2026-10-06): a bug icon to the right of the
   * notifications bell that opens the Inspector view tab, as the `sync` icon
   * opens Shared and the bell's footer opens the Log. Drawn ONLY while
   * developer tools are on (`ctx.devtools`, the flag `app.inspector`'s
   * `when` reads); otherwise nothing at all — not a disabled button.
   *
   * The `inspector` entry of the readout catalogue (`readouts.ts`).
   */
  import { Bug } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ReadoutContext } from '../../readouts.js'
  import { getViewShell } from '../../views.js'
  import IconButton from '../../ui/IconButton.svelte'

  interface Props {
    ctx: Pick<ReadoutContext, 'devtools' | 'side'>
  }

  let { ctx }: Props = $props()
  const shell = getViewShell()
  const on = $derived(ctx.devtools?.() ?? false)
</script>

{#if on}
  <IconButton
    label={$LL.web.devtools.open()}
    icon={Bug}
    placement={ctx.side ?? 'bottom'}
    testid="inspector-open"
    onclick={() => shell?.openView('inspector')}
  />
{/if}
