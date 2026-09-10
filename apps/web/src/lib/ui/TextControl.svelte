<script lang="ts">
  /**
   * Label + text input (or textarea) inside a `Field`, with the control's
   * ARIA attrs derived from the field: `aria-invalid` when it has errors,
   * `aria-describedby` pointing at its description and its errors.
   */
  import type { HTMLInputAttributes } from 'svelte/elements'
  import { controlAttrs } from './form-attrs.js'
  import { getField } from './form-context.js'

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    label: string
    value: string
    multiline?: boolean
    rows?: number
    /** Monospace: links, URLs, paths. */
    mono?: boolean
    testid?: string
  }

  let {
    label,
    value = $bindable(),
    multiline = false,
    rows = 2,
    mono = false,
    testid,
    class: klass = '',
    ...rest
  }: Props = $props()

  const field = getField()
  const attrs = $derived(controlAttrs(field))
  /** The passthrough attrs are typed for `<input>`; the textarea shares the safe ones. */
  const textareaRest = $derived(rest as Record<string, unknown>)
  const cls = $derived(
    `mt-1 w-full rounded border px-3 py-2 text-sm focus:outline-none ${
      field.errors.length > 0 ? 'border-error focus:border-error' : 'border-base-300 focus:border-primary'
    } ${mono ? 'font-mono' : ''} ${klass}`
  )
</script>

<label for={attrs.id} class="block text-xs font-semibold tracking-wide text-base-content/70 uppercase">
  {label}{#if field.required}<span aria-hidden="true" class="text-error"> *</span>{/if}
</label>
{#if multiline}
  <textarea bind:value {...attrs} {rows} data-testid={testid} class={cls} {...textareaRest}></textarea>
{:else}
  <input bind:value {...attrs} data-testid={testid} class={cls} {...rest} />
{/if}
