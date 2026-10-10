<script lang="ts">
  /**
   * Settings › You (settings-shaping ST2): the display name. One save model
   * (R3): the name commits on Enter or when the field is left, validated
   * inline — no Save button, nothing held back for a close guard.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { loadUser, saveUser } from '../config.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    /** The name changed (the shell's manager mirror re-reads it). */
    onConfigChange?: () => void
  }

  let { onConfigChange }: Props = $props()

  const t = $derived($LL.web.settings)

  let stored = loadUser() ?? ''
  let name = $state(stored)
  let errors = $state<string[]>([])
  let saved = $state(false)

  function commit(): void {
    const next = name.trim()
    if (!next) {
      errors = [t.you.name_required()]
      saved = false
      return
    }
    errors = []
    name = next
    if (next === stored) return
    saveUser(next)
    stored = next
    saved = true
    onConfigChange?.()
  }
</script>

<Field name="name" {errors} required>
  <TextControl
    label={t.you.name()}
    bind:value={name}
    oninput={() => (saved = false)}
    onblur={commit}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
    }}
    placeholder={t.you.name_placeholder()}
    testid="settings-name"
  />
  <Description>{t.you.name_hint()}</Description>
  <FieldErrors />
</Field>
<p role="status" class="mt-1 min-h-4 text-xs text-base-content/70" data-testid="settings-name-status">
  {saved ? t.saved() : ''}
</p>
