<script lang="ts">
  /**
   * `nav` (round 2, P1): back and forward through the focused tab's own
   * trail — the `nav.back` / `nav.forward` commands as buttons, their
   * bindings in the names, disabled at either end of the trail.
   */
  import { ArrowLeft, ArrowRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { canTravel } from '../../panes.js'
  import { targetOf, type ReadoutContext } from '../../readouts.js'
  import IconButton from '../../ui/IconButton.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const t = $derived($LL.web)
  const named = (title: string, id: string): string => {
    const binding = ctx.nav.registry.binding(id)
    return binding ? t.toolbar.with_binding({ title, binding }) : title
  }
  const placement = $derived(ctx.side ?? 'bottom')
  const run = (id: string): void => void ctx.nav.registry.get(id)?.run()
  /** Read from the rendered layout (`panes.layout`, reactive): the shell's own `canTravel` is not. */
  const tab = $derived(targetOf(ctx).tab)
</script>

<span role="group" aria-label={t.toolbar.nav_label()} data-testid="nav" class="flex shrink-0 items-center">
  <IconButton
    label={named(t.commands.back(), 'nav.back')}
    icon={ArrowLeft}
    {placement}
    disabled={!canTravel(tab, -1)}
    testid="nav:back"
    onclick={() => run('nav.back')}
  />
  <IconButton
    label={named(t.commands.forward(), 'nav.forward')}
    icon={ArrowRight}
    {placement}
    disabled={!canTravel(tab, 1)}
    testid="nav:forward"
    onclick={() => run('nav.forward')}
  />
</span>
