<script lang="ts">
  /**
   * The right column (chrome U2; Round 2 P4; Round 3 Q3): the dock pinned,
   * OPEN. Under `regions.rail: "column"` the dock's panel — Links and History
   * behind one tab row — stands here as a column instead of floating over
   * the editor. Closed, it is no column at all: the editor takes the width
   * back and the floating strip (`EditorArea`'s `Dock`) is the way in, as in
   * every collapsed state. Same open state, same tab.
   */
  import type { Navigation } from '../navigation.svelte.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import Dock from './Dock.svelte'

  interface Props {
    workspace: Workspace
    nav: Navigation
    layout: ShellLayout
  }

  let { workspace, nav, layout }: Props = $props()
</script>

<Dock {workspace} {nav} {layout} form="column" />
