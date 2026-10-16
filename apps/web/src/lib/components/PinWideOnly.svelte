<script lang="ts">
  /**
   * The pin control on a small screen (QA round 1): a pinned column would
   * take most of a phone's width, so below the breakpoint a pin is kept but
   * not honoured (`ShellLayout.pinsHonoured`) and the side floats as it would
   * unpinned. In place of *Pin as a column* the drawer and the dock show this:
   * the same icon, `aria-disabled` (not `disabled`, so its tooltip still
   * shows), saying pins apply on wider screens. A tap says it again as a
   * flash — a finger gets no hover tooltip.
   */
  import { Pin } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import IconButton from '../ui/IconButton.svelte'

  interface Props {
    /** This device has the side pinned (on a wider screen it is a column). */
    pinned: boolean
    testid: string
    /** Say why it does nothing here (the host flashes it). */
    onExplain: (text: string) => void
  }

  let { pinned, testid, onExplain }: Props = $props()

  const label = $derived(pinned ? $LL.web.shell.pinned_wide_only() : $LL.web.shell.pin_wide_only())
</script>

<IconButton
  {label}
  icon={Pin}
  placement="bottom"
  {testid}
  aria-disabled="true"
  data-pinned={pinned}
  class="opacity-40 hover:bg-transparent"
  onclick={() => onExplain(label)}
/>
