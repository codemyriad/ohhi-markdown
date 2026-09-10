<script lang="ts">
  import { z } from 'zod'
  import { createForm } from '../form.svelte.js'
  import Description from '../Description.svelte'
  import Field from '../Field.svelte'
  import FieldErrors from '../FieldErrors.svelte'
  import TextControl from '../TextControl.svelte'

  const form = createForm(
    z.object({ link: z.string().trim().min(1, 'Paste a link first.') }),
    { link: '' }
  )
  let submitted = $state('')
</script>

<form
  novalidate
  onsubmit={(e) => {
    e.preventDefault()
    void form.submit(({ link }) => {
      submitted = link
    })
  }}
>
  <Field name="link" errors={form.errorsFor('link')} required>
    <TextControl label="Share link" bind:value={form.data.link} onblur={() => form.touch('link')} />
    <Description>Starts with editor1:</Description>
    <FieldErrors />
  </Field>
  <button type="submit">Join</button>
</form>
<span data-testid="submitted">{submitted}</span>
