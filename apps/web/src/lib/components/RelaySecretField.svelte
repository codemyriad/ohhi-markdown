<script module lang="ts">
  import type { SecretCheck } from '../relay-probe.js'
  /** The field's answer: nothing to check, asking, or the relay's answer. */
  export type SecretState = 'idle' | 'checking' | SecretCheck
</script>

<script lang="ts">
  /**
   * The team's secret (the relay's operator secret), verified and placed
   * (first-run-shaping D2): "Team secret", what it lets the app do, and — after a
   * paste (debounced on the injected clock) and on blur — whether it works
   * on THIS relay: "works" (a listing call answered 200, just now — nothing
   * more), "doesn't match this relay", "this relay has no admin API", "can't
   * reach the relay". Under it, *Where do I get this?*.
   *
   * The check is advisory where the secret is only saved (Settings › Sync)
   * and a gate where it is about to be used (the share sheet reads `check`
   * and keeps *Share* disabled until it is `ok`).
   */
  import { untrack } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { realClock } from '../real-clock.js'
  import { verifySecret } from '../relay-probe.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import SecretHelp from './SecretHelp.svelte'

  interface Props {
    /**
     * The relay the secret is checked against; '' = check nothing. The
     * parent decides which relay may see the secret (Settings › Sync never
     * hands the SAVED secret to a relay that is only typed).
     */
    relayUrl: string
    value: string
    /** Out: the latest check for the current value and relay. */
    check?: SecretState
    /** Validation messages from the parent's form, if any. */
    errors?: string[]
    required?: boolean
    placeholder?: string
    onblur?: () => void
    /** Called on every keystroke in the field, before the check is scheduled. */
    oninput?: () => void
    clock?: Clock
    /** Injected for tests: the listing call. */
    verify?: (relayUrl: string, secret: string) => Promise<SecretCheck>
    /** The build's "where" sentence; injectable for tests. */
    hint?: string
    testid?: string
  }

  let {
    relayUrl,
    value = $bindable(),
    check = $bindable('idle'),
    errors = [],
    required = false,
    placeholder,
    onblur,
    oninput,
    clock = realClock,
    verify,
    hint,
    testid = 'secret',
  }: Props = $props()

  const t = $derived($LL.web.relay_card.secret)

  /** How long a paste or typing settles before the relay is asked. */
  const VERIFY_DEBOUNCE_MS = 500

  let seq = 0
  let cancelPending: (() => void) | null = null
  /** The (relay, secret) pair the shown answer is about. */
  let checked = ''

  function run(): void {
    cancelPending?.()
    cancelPending = null
    const secret = value.trim()
    const url = relayUrl
    const key = `${url}\n${secret}`
    if (!secret || !url) {
      seq++
      checked = ''
      check = 'idle'
      return
    }
    if (key === checked && check !== 'idle' && check !== 'checking') return
    const mine = ++seq
    checked = key
    check = 'checking'
    const ask = verify ?? ((u: string, s: string) => verifySecret(u, s, { schedule: clock.schedule }))
    void ask(url, secret)
      .catch((): SecretCheck => 'unreachable')
      .then((answer) => {
        if (mine === seq) check = answer
      })
  }

  /**
   * Forget the shown answer at once — an answer for the old value or relay is
   * no longer about this one, and a gate reading `check` (the share sheet's
   * *Share*) must not stay open through the debounce — then ask again.
   */
  function schedule(): void {
    cancelPending?.()
    seq++
    check = value.trim() && relayUrl ? 'checking' : 'idle'
    checked = ''
    cancelPending = clock.schedule(run, VERIFY_DEBOUNCE_MS)
  }

  // A secret already in the field (Settings opened with one saved), or the
  // relay changing under it: reset synchronously, then ask again.
  $effect(() => {
    void relayUrl
    untrack(schedule)
  })
  $effect(() => () => cancelPending?.())

  const statusText = $derived(check === 'idle' ? '' : check === 'checking' ? t.checking() : t[check]())
</script>

<Field name="secret" {errors} {required}>
  <TextControl
    label={t.title()}
    mono
    type="password"
    autocomplete="off"
    bind:value
    oninput={() => {
      oninput?.()
      schedule()
    }}
    onblur={() => {
      run()
      onblur?.()
    }}
    {placeholder}
    {testid}
    class="text-xs"
  />
  <Description>
    {t.description()}
    <span role="status" data-testid="{testid}-check" data-check={check}
      >{#if statusText}<span class={check === 'ok' ? 'font-medium text-base-content' : check === 'checking' ? '' : 'font-medium text-error'}
          >{statusText}</span
        >{/if}</span
    >
  </Description>
  <FieldErrors />
  <SecretHelp {hint} testid="{testid}-where" />
</Field>
