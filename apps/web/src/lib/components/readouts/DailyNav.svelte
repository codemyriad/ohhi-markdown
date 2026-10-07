<script lang="ts">
  /**
   * `daily.nav` (quiet-shell F6, W3): previous / today / next daily note — the
   * three `daily.*` commands as buttons, with their bindings in the names.
   * Disabled at either end, as the commands' own guards are.
   */
  import { CalendarDays, ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ReadoutContext } from '../../readouts.js'
  import IconButton from '../../ui/IconButton.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const t = $derived($LL.web)
  const named = (title: string, id: string): string => {
    const binding = ctx.nav.registry.binding(id)
    return binding ? t.toolbar.with_binding({ title, binding }) : title
  }
  const placement = $derived(ctx.side ?? 'bottom')
</script>

<span role="group" aria-label={t.toolbar.daily.label()} data-testid="daily-nav" class="flex items-center">
  <IconButton
    label={named(t.commands.daily_prev(), 'daily.prev')}
    icon={ChevronLeft}
    {placement}
    disabled={ctx.daily.steps.prev === null}
    testid="daily-nav:prev"
    onclick={() => ctx.daily.step('prev')}
  />
  <IconButton
    label={named(t.commands.daily_today(), 'daily.today')}
    icon={CalendarDays}
    {placement}
    testid="daily-nav:today"
    onclick={() => void ctx.daily.openToday()}
  />
  <IconButton
    label={named(t.commands.daily_next(), 'daily.next')}
    icon={ChevronRight}
    {placement}
    disabled={ctx.daily.steps.next === null}
    testid="daily-nav:next"
    onclick={() => ctx.daily.step('next')}
  />
</span>
