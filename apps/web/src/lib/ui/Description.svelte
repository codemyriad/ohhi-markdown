<script lang="ts">
  /** Helper text under a control; registers itself so the control's `aria-describedby` includes it. */
  import type { Snippet } from 'svelte'
  import { getField } from './form-context.js'

  let { class: klass = '', children }: { class?: string; children: Snippet } = $props()
  const field = getField()

  $effect(() => {
    field.hasDescription = true
    return () => {
      field.hasDescription = false
    }
  })
</script>

<p id={field.ids.description} class="mt-1 text-xs text-base-content/70 {klass}">
  {@render children()}
</p>
