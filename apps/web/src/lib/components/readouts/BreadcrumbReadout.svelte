<script lang="ts">
  /**
   * `breadcrumb` (quiet-shell F6): the focused note's folders and name — the
   * header's `Breadcrumb`, unchanged. A folder crumb opens the navigator on
   * it, as a drawer or as a column, whichever the layout has.
   */
  import { readoutPlacement, type ReadoutContext } from '../../readouts.js'
  import Breadcrumb from '../Breadcrumb.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()
</script>

<Breadcrumb
  path={ctx.workspace.ui.selectedPath ?? null}
  workspace={ctx.workspace}
  onReveal={(dir) => ctx.layout.revealInTree(dir)}
  placement={readoutPlacement(ctx, 'start')}
/>
