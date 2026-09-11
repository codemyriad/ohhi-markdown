<script lang="ts">
  /**
   * A labelled run of rows inside a `DropdownMenu`: *Move to pane*, *Add to
   * group*, the strip-end list's *Open* and *Saved*.
   *
   * A section rather than a submenu because `DropdownMenu` is a flat Melt menu
   * — this keeps every row one arrow key away instead of two. The heading is
   * `aria-hidden`: the `role="group"` already carries the same name.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    children: Snippet
  }

  let { label, children }: Props = $props()
</script>

<div role="group" aria-label={label}>
  <p
    aria-hidden="true"
    class="px-3 pt-1 pb-0.5 text-[10px] tracking-wider text-base-content/70 uppercase"
  >
    {label}
  </p>
  {@render children()}
</div>
