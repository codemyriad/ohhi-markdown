<script lang="ts">
  /**
   * The toolbar (quiet-shell F5; round 2, P1): the light layout's one bar,
   * in place of the breadcrumb header. Three groups of readouts
   * (`readouts.ts`) straight from the spec — `bars['toolbar.left']`,
   * `bars['toolbar.center']` and `bars['toolbar.right']` — drawn through
   * `BarItems`; `"|"` is a separator. The files button stays at the far
   * left. In light: back/forward on the left, the focused tab's name in the
   * centre (the `title` readout, which is also that tab's handle), the
   * note's readouts on the right. Formatting is a bar of its own
   * (`FormatBar.svelte`), placed by the host.
   *
   * The centre is centred on the BAR, not on what is left between the ends:
   * a three-column grid whose ends never shrink below their content and
   * whose middle gives way first, truncating the title at a narrow width.
   *
   * One tab stop (`role=toolbar`, roving focus — arrows, Home, End).
   * `spec.toolbar.position` only says where the HOST renders this; the bar
   * itself flips its tooltips and menus to open away from the edge it sits on.
   */
  import { Minimize2, PanelLeft } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ShellSpec } from '../layout-spec.js'
  import { inBar, type ReadoutContext } from '../readouts.js'
  import IconButton from '../ui/IconButton.svelte'
  import { sideAwayFrom } from '../ui/placement.js'
  import { roving } from '../ui/roving.js'
  import BarItems from './BarItems.svelte'
  import Zoomed from './readouts/Zoomed.svelte'

  interface Props {
    spec: ShellSpec
    ctx: ReadoutContext
  }

  let { spec, ctx }: Props = $props()

  const t = $derived($LL.web.toolbar)
  const bottom = $derived(spec.toolbar.position === 'bottom')
  const tip = $derived(sideAwayFrom(spec.toolbar.position))
  /** The readouts' context with this bar's side: their popovers open away from the edge too. */
  const barCtx = $derived(inBar(ctx, { side: tip }))
</script>

<div
  use:roving
  role="toolbar"
  aria-label={t.label()}
  aria-orientation="horizontal"
  data-testid="toolbar"
  data-position={spec.toolbar.position}
  class="grid h-9 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-2 bg-base-100 px-2 text-xs text-base-content/70
    {bottom ? 'border-t' : 'border-b'} border-base-300"
>
  <div data-testid="toolbar-left" class="flex items-center gap-1">
    {#if spec.regions.navigator !== 'off'}
      <IconButton
        label={ctx.layout.treeOpen ? $LL.web.shell.hide_navigator() : $LL.web.shell.show_navigator()}
        icon={PanelLeft}
        placement={tip}
        pressed={ctx.layout.treeOpen}
        testid="toggle-tree"
        onclick={() => (ctx.layout.treeOpen = !ctx.layout.treeOpen)}
      />
    {/if}
    <BarItems ids={spec.bars['toolbar.left']} ctx={barCtx} />
  </div>

  <div data-testid="toolbar-center" class="flex min-w-0 items-center justify-center gap-2">
    <BarItems ids={spec.bars['toolbar.center']} ctx={barCtx} />
  </div>

  <div data-testid="toolbar-right" class="flex items-center justify-end gap-3">
    <Zoomed ctx={barCtx} />
    <BarItems ids={spec.bars['toolbar.right']} ctx={barCtx} />
    {#if ctx.layout.focus}
      <IconButton
        label={$LL.web.toolbar.focus.leave()}
        icon={Minimize2}
        placement={tip}
        testid="leave-focus"
        onclick={() => ctx.layout.setFocus(false)}
      />
    {/if}
  </div>
</div>
