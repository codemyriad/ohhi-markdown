<script lang="ts">
  /** Settings › Developer: one switch, applied at once. */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { devtoolsEnabled, setDevtools } from '../config.js'
  import { escapeHtml } from '../html.js'

  interface Props {
    /** The switch changed (the shell re-reads it for the inspector's command). */
    onConfigChange?: () => void
  }

  let { onConfigChange }: Props = $props()

  const t = $derived($LL.web.settings.developer)
  let devtools = $state(devtoolsEnabled())
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`
</script>

<label class="flex items-center gap-2">
  <input
    data-testid="settings-devtools"
    type="checkbox"
    bind:checked={devtools}
    onchange={() => {
      setDevtools(devtools)
      onConfigChange?.()
    }}
  />
  <span class="text-sm text-base-content/80">{t.devtools()}</span>
</label>
<p class="mt-1 text-xs text-base-content/70">
  {@html t.devtools_help({ flag: code('?debug=1') })}
</p>
