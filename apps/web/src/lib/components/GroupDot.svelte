<script lang="ts">
  /**
   * A group's colour as the one dot every surface draws it with: the chip,
   * the tab menu, the strip-end list, *Show all* and the drag ghost.
   *
   * Decoration, never a label — the group's name is always beside it, so
   * there is nothing here for a screen reader to read.
   */
  interface Props {
    /** Slot in the `--ed-group-1..8` band. */
    color: number
    /** A dialog row is a step bigger than a menu row. */
    size?: 'sm' | 'md'
  }

  let { color, size = 'sm' }: Props = $props()
</script>

<span
  aria-hidden="true"
  class="shrink-0 rounded-full {size === 'md' ? 'size-2.5' : 'size-2'}"
  style="background: var(--ed-group-{color})"
></span>
