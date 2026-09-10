<script lang="ts">
  /** Checkbox + label inside a `Field`, sharing the field's ARIA wiring. */
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { controlAttrs } from './form-attrs.js'
  import { getField } from './form-context.js'

  interface Props extends Omit<HTMLInputAttributes, 'checked' | 'type'> {
    label: string
    checked: boolean
    testid?: string
  }

  let { label, checked = $bindable(), testid, class: klass = '', ...rest }: Props = $props()

  const field = getField()
  const attrs = $derived(controlAttrs(field))
</script>

<label for={attrs.id} class="flex items-center gap-2 text-sm text-base-content/80 {klass}">
  <input type="checkbox" bind:checked {...attrs} data-testid={testid} {...rest} />
  {label}
</label>
