<script lang="ts">
  /** The field's validation messages; the control's `aria-describedby` points here. */
  import { getField } from './form-context.js'

  let { class: klass = '' }: { class?: string } = $props()
  const field = getField()
</script>

{#if field.errors.length > 0}
  <div id={field.ids.errors} data-testid="field-errors:{field.name}" class="mt-1 text-xs text-error {klass}">
    {#each field.errors as error (error)}
      <div>{error}</div>
    {/each}
  </div>
{/if}
