<script lang="ts">
  /**
   * The source pill (settings-shaping ST4): which resource root a name came
   * from — this vault, your config folder, or built in. One look, so a vault
   * file shadowing a built-in name reads the same everywhere it is shown.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { RootId } from '../resources.svelte.js'

  let { root }: { root: RootId } = $props()
</script>

<span
  class="inline-flex h-[18px] items-center rounded-full border border-base-300 px-1.5 align-middle text-[11px] font-medium whitespace-nowrap text-base-content"
  data-root={root}>{$LL.web.settings.customise.from[root]()}</span
>
