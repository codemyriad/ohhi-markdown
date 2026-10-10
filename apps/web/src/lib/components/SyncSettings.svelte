<script lang="ts">
  /**
   * Settings › Sync & devices (settings-shaping ST2): the relay as one thing
   * with a state (first-run D1), the operator secret answered as you type
   * (D2), your devices, running your own relay (R10), a pointer to where the
   * remembered vaults and shares now live (the manager), and — in a browser —
   * this browser's storage.
   *
   * One save model (R3): the relay address and the secret each commit on
   * Enter or when the field is left; the address is validated inline first.
   * No Save button, and *Link a device…* commits both before it opens.
   */
  import { LL, locale } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { relayHost, type SharedSnapshot } from '@ohhi/workspace'
  import {
    DEFAULT_RELAY,
    DEFAULT_RELAY_CONFIGURED,
    TEAM_HOST,
    TEAM_NETWORK_NOTE,
    defaultRelay,
    isRelayUrl,
    operatorSecret,
    relayKnown,
    setDefaultRelay,
    setOperatorSecret,
  } from '../config.js'
  import { guideHref } from '../guide.js'
  import { realClock } from '../real-clock.js'
  import type { ProbeResult, SecretCheck } from '../relay-probe.js'
  import { formatBytes, notGuaranteed } from '../storage-persistence.js'
  import { askToKeepStorage, refreshStorageUsage, setStorageReminder, storageState } from '../storage.svelte.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import TextControl from '../ui/TextControl.svelte'
  import RelayCard from './RelayCard.svelte'
  import RelaySecretField from './RelaySecretField.svelte'
  import SecretHelp from './SecretHelp.svelte'

  interface Props {
    /** The open vault's relays, from the Shared view's snapshot (the card reads "Connected" from them). */
    relays?: SharedSnapshot['relays']
    /** Open the owner's device-link dialog; absent with no vault open. */
    onLinkDevice?: () => void
    /** Show the vault manager (where remembered vaults and shares live). */
    onManageVaults?: () => void
    /** The relay or the secret changed. */
    onConfigChange?: () => void
    /** A browser build (storage is this browser's); the desktop keeps real files. */
    desktop: boolean
    // ---- environment, injectable for tests ----
    clock?: Clock
    probe?: (relayUrl: string) => Promise<ProbeResult>
    verify?: (relayUrl: string, secret: string) => Promise<SecretCheck>
    /** The pinned host (`TEAM_HOST`); '' = a generic build. */
    pinnedHost?: string
    /** The build's default relay, when it was given one: the team's ('' = none). */
    teamRelay?: string
    networkNote?: string
    secretHint?: string
  }

  let {
    relays = [],
    onLinkDevice,
    onManageVaults,
    onConfigChange,
    desktop,
    clock = realClock,
    probe,
    verify,
    pinnedHost = TEAM_HOST,
    teamRelay = DEFAULT_RELAY_CONFIGURED ? DEFAULT_RELAY : '',
    networkNote = TEAM_NETWORK_NOTE,
    secretHint,
  }: Props = $props()

  const t = $derived($LL.web.settings)
  const dl = $derived($LL.web.device_link)

  // ---- the relay ----
  /** The relay as saved (or the build's default): the address field commits against it. */
  let shownRelay = $state(defaultRelay())
  let relay = $state(defaultRelay())
  let relayErrors = $state<string[]>([])
  /** Whether a relay is known at all; a pinned build always knows its one. */
  // svelte-ignore state_referenced_locally -- seed only; the pin is fixed at build time
  let syncRelayKnown = $state(relayKnown() || !!pinnedHost)
  /** The address field: open with nothing known, after *Change…*, and — read-only — always when pinned. */
  // svelte-ignore state_referenced_locally -- seed only
  let relayOpen = $state(!syncRelayKnown || !!pinnedHost)
  const teamHost = $derived(teamRelay ? (relayHost(teamRelay) ?? '') : '')

  /** Commit the address: validated inline; stored only when it changed, so the build's default is never pinned by accident. */
  function commitRelay(): boolean {
    if (pinnedHost) return true
    const next = relay.trim()
    if (!next) {
      relayErrors = [t.sync.relay_required()]
      return false
    }
    if (!isRelayUrl(next)) {
      relayErrors = [t.sync.relay_invalid()]
      return false
    }
    relayErrors = []
    if (next === shownRelay) return true
    setDefaultRelay(next)
    shownRelay = defaultRelay()
    relay = shownRelay
    syncRelayKnown = relayKnown() || !!pinnedHost
    onConfigChange?.()
    return true
  }

  // ---- the secret ----
  let storedSecret = operatorSecret()
  let secret = $state(storedSecret)
  function commitSecret(): void {
    if (secret === storedSecret) return
    setOperatorSecret(secret)
    storedSecret = secret
    syncRelayKnown = relayKnown() || !!pinnedHost
    onConfigChange?.()
  }

  const onEnter =
    (commit: () => unknown) =>
    (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      commit()
    }

  /** The relay the card is about: the field's when it is a relay URL, else the saved one. */
  const cardRelay = $derived(isRelayUrl(relay.trim()) ? relay.trim() : shownRelay)
  const cardConnection = $derived(
    relays.find((r) => r.host && r.host.toLowerCase() === (relayHost(cardRelay) ?? '').toLowerCase()) ?? null
  )

  /** Leaving for the device-link dialog commits first: minting reads the secret from config. */
  function linkDevice(): void {
    if (!commitRelay()) return
    commitSecret()
    onLinkDevice?.()
  }

  // ---- this browser's storage (storage-persistence.ts) ----
  const st = $derived($LL.web.storage)
  const storageStatus = $derived(
    {
      unknown: st.settings.checking,
      persisted: st.settings.kept,
      'best-effort': st.settings.best_effort,
      unsupported: st.settings.unsupported,
    }[storageState.state]()
  )
  const storageAtRisk = $derived(notGuaranteed(storageState.state))
  // svelte-ignore state_referenced_locally -- the platform is fixed for the page's life
  if (!desktop) void refreshStorageUsage()

  const button = `${OUTLINE_BUTTON} mt-2 px-3 py-1.5 text-xs font-medium text-base-content/80`
  const textLink =
    'mt-1 inline-block text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
</script>

<div class="space-y-3">
  <div class="space-y-1.5" data-testid="settings-relay-card">
    <h3 class={HEADING}>{$LL.web.relay_card.label()}</h3>
    <RelayCard
      relayUrl={cardRelay}
      known={syncRelayKnown || (relayOpen && relay.trim() !== shownRelay && isRelayUrl(relay.trim()))}
      connection={cardConnection}
      {pinnedHost}
      {teamHost}
      {networkNote}
      {clock}
      {probe}
      showTest
      onChange={relayOpen ? undefined : () => (relayOpen = true)}
    />
  </div>
  {#if relayOpen}
    <Field name="relay" errors={relayErrors} required={!pinnedHost}>
      <TextControl
        label={t.sync.relay()}
        mono
        bind:value={relay}
        onblur={commitRelay}
        onkeydown={onEnter(commitRelay)}
        placeholder={DEFAULT_RELAY}
        readonly={!!pinnedHost}
        testid="settings-relay"
      />
      <Description>{pinnedHost ? t.sync.relay_pinned_hint() : `${t.sync.relay_hint()} ${t.sync.relay_commit_hint()}`}</Description>
      <FieldErrors />
    </Field>
  {/if}
  <RelaySecretField
    relayUrl={cardRelay}
    bind:value={secret}
    onblur={commitSecret}
    placeholder={t.sync.secret_placeholder()}
    {clock}
    {verify}
    hint={secretHint}
    testid="settings-secret"
  />
</div>

<!-- Your devices (N2, A1): an action against the relay, below the settings it depends on. -->
<section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-device-link">
  <h3 class={HEADING}>{t.sync.devices()}</h3>
  <p class="mt-1 text-xs text-base-content/70">{dl.section_help()}</p>
  {#if !onLinkDevice}
    <p class="mt-2 text-xs text-base-content/70">{dl.needs_vault()}</p>
  {:else if !secret.trim()}
    <p class="mt-2 text-xs text-base-content/80" data-testid="settings-link-device-needs-secret">
      {dl.needs_secret()}
    </p>
    <SecretHelp hint={secretHint} testid="settings-link-device-where" />
  {:else}
    <button type="button" data-testid="settings-link-device" onclick={linkDevice} class={button}>
      {dl.open()}
    </button>
  {/if}
</section>

<!-- One relay per group (first-run R10): said where it is felt. -->
<section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-own-relay">
  <h3 class={HEADING}>{t.sync.running_title()}</h3>
  <p class="mt-1 text-xs text-base-content/80">
    {pinnedHost ? t.sync.running_pinned({ host: pinnedHost }) : t.sync.running_body()}
  </p>
  {#if !pinnedHost}
    <a href={guideHref('relay')} target="_blank" rel="noreferrer" data-testid="settings-relay-guide" class={textLink}
      >{t.sync.running_guide()}</a
    >
  {/if}
</section>

<!-- Vaults & shares moved to the manager (Fork 3): one door to it. -->
<section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-vaults">
  <h3 class={HEADING}>{t.sync.vaults()}</h3>
  <p class="mt-1 text-xs text-base-content/80">{t.sync.vaults_body()}</p>
  {#if onManageVaults}
    <button type="button" data-testid="settings-manage-vaults" onclick={onManageVaults} class={button}>
      {t.sync.vaults_open()}
    </button>
  {/if}
</section>

{#if !desktop}
  <!-- The status is a live region: an ask made here changes it in place. -->
  <section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-storage">
    <h3 class={HEADING}>{st.settings.heading()}</h3>
    <div role="status" class="mt-1">
      <p class="text-sm text-base-content/80" data-testid="settings-storage-status">{storageStatus}</p>
      {#if storageState.refused && storageAtRisk}
        <p class="mt-1 text-xs text-base-content/70">{st.refused()}</p>
      {/if}
    </div>
    {#if storageState.usage}
      <p class="mt-1 text-xs text-base-content/70" data-testid="settings-storage-usage">
        {st.settings.usage({
          used: formatBytes(storageState.usage.usage, $locale),
          quota: formatBytes(storageState.usage.quota, $locale),
        })}
      </p>
    {/if}
    {#if storageAtRisk}
      <p class="mt-1 text-xs text-base-content/70">{st.advice()}</p>
      {#if storageState.state === 'best-effort'}
        <button type="button" data-testid="settings-storage-keep" onclick={() => void askToKeepStorage()} class={button}>
          {st.ask()}
        </button>
      {/if}
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="settings-storage-remind"
          checked={!storageState.dismissed}
          onchange={(e) => setStorageReminder(e.currentTarget.checked)}
        />
        <span class="text-sm text-base-content/80">{st.settings.remind()}</span>
      </label>
    {/if}
  </section>
{/if}
