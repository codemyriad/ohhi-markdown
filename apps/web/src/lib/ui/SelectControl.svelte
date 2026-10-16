<script lang="ts">
  /**
   * A labelled `<select>` inside a `Field`, the way `TextControl` is a
   * labelled input: the same label, the same box, the same error border, so
   * a picker sits in a row with text fields without a seam (the join page's
   * *Which vault* beside *Folder*, 2026-10-16). The options are the caller's
   * children; the browser draws the menu.
   */
  import type { Snippet } from 'svelte'
  import { controlAttrs } from './form-attrs.js'
  import { getField } from './form-context.js'

  interface Props {
    label: string
    value: string
    hideLabel?: boolean
    testid?: string
    class?: string
    children: Snippet
  }

  let { label, value = $bindable(), hideLabel = false, testid, class: klass = '', children }: Props = $props()

  const field = getField()
  const attrs = $derived(controlAttrs(field))
  const cls = $derived(
    `mt-1 w-full rounded border bg-base-100 px-3 py-2 text-sm focus:outline-none ${
      field.errors.length > 0 ? 'border-error focus:border-error' : 'border-base-300 focus:border-primary'
    } ${klass}`
  )
</script>

<label
  for={attrs.id}
  class={hideLabel
    ? 'sr-only'
    : 'block text-xs font-semibold tracking-wide text-base-content/70 uppercase'}
>
  {label}{#if field.required}<span aria-hidden="true" class="text-error"> *</span>{/if}
</label>
<select bind:value {...attrs} data-testid={testid} class={cls}>
  {@render children()}
</select>
