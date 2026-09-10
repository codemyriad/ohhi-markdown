<script lang="ts">
  import { melt } from '@melt-ui/svelte'
  import type { MenuSeparatorAttrs } from './DropdownMenu.svelte'

  let { separator }: { separator: MenuSeparatorAttrs } = $props()
</script>

<div use:melt={separator} class="my-1 border-t border-base-200"></div>
