<script lang="ts">
  /**
   * One form field: owns the ids that tie label, control, description and
   * errors together, and publishes them to the controls inside. Errors come
   * from the parent (`form.errorsFor('name')`), so the field is agnostic to
   * where validation lives.
   */
  import type { Snippet } from 'svelte'
  import { setField } from './form-context.js'

  interface Props {
    name: string
    errors?: string[]
    required?: boolean
    class?: string
    children: Snippet
  }

  let { name, errors = [], required = false, class: klass = '', children }: Props = $props()

  const uid = $props.id()
  let hasDescription = $state(false)

  setField({
    get name() {
      return name
    },
    get errors() {
      return errors
    },
    get required() {
      return required
    },
    ids: { control: `${uid}-control`, errors: `${uid}-errors`, description: `${uid}-description` },
    get hasDescription() {
      return hasDescription
    },
    set hasDescription(v: boolean) {
      hasDescription = v
    },
  })
</script>

<div class={klass} data-field={name}>
  {@render children()}
</div>
