<script lang="ts">
  /**
   * The Session view's door (Chris, 2026-10-15: "is there no other way to
   * open a session than selecting text and pressing Mod+Shift+L?"): one icon
   * on the toolbar, between the inspector's door and Help, that opens the
   * current session — the one last focused, else a fresh one — BESIDE the
   * note (`ViewShell.openView('session')` goes through
   * `PaneShell.openViewBeside`). Drawn ONLY while a provider exists
   * (`aiEnabled`, writing-harness R1: nothing AI-shaped renders without one);
   * otherwise nothing at all, not a disabled button — the quiet default.
   *
   * The `session` entry of the readout catalogue (`readouts.ts`).
   */
  import { MessageSquareText } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { aiEnabled } from '../../ai-config.svelte.js'
  import type { ReadoutContext } from '../../readouts.js'
  import { currentSessionArg } from '../../sessions.svelte.js'
  import { getViewShell } from '../../views.js'
  import IconButton from '../../ui/IconButton.svelte'

  interface Props {
    ctx: Pick<ReadoutContext, 'side'>
  }

  let { ctx }: Props = $props()
  const shell = getViewShell()
  const on = $derived(aiEnabled())
</script>

{#if on}
  <IconButton
    label={$LL.web.ai.commands.session()}
    icon={MessageSquareText}
    placement={ctx.side ?? 'bottom'}
    testid="session-open"
    onclick={() => shell?.openView('session', currentSessionArg())}
  />
{/if}
