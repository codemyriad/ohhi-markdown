<script lang="ts">
  /**
   * The relay as one thing with a state (first-run-shaping D1, R3, R10) — the
   * one card the share sheet's first run ("Syncs through"), Settings › Sync
   * and the Shared view draw: an icon tile, the host in mono, a status line,
   * and actions.
   *
   * Three sources for the status line, never mixed:
   *  - CONNECTED (`connection`, the Shared view's snapshot roll-up): the
   *    relay this vault's rooms live on, in `shared.relay.*` words —
   *    "in sync with the relay since …" is RECEIPT (golden rule 4), never
   *    "durable";
   *  - PROBED (a relay the vault is not connected to yet): `GET /healthz` —
   *    "reachable" means a health check answered, never that a token or a
   *    secret is good (R5);
   *  - NONE (`known` false: no relay saved, none in the build): "No relay
   *    yet", one relay per group, and the guide.
   *
   * A PINNED build (`pinnedHost`, `VITE_TEAM_HOST`) has a content security
   * policy that allows no other relay, so the card offers none: no
   * *Change…* / *Use another…*, and it says the build syncs through this host
   * only (R10).
   *
   * The state dot is a SYNC dot (the unlayered `.ed-sync-dot` keyed on
   * `data-status`), never a presence colour: no theme can repaint it.
   *
   * Timing (the probe's debounce and timeout, the "checked …" wording) runs
   * on the injected clock (golden rule 5), so tests drive it.
   */
  import { Server } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { relayHost, type SharedSnapshot } from '@ohhi/workspace'
  import { guideHref } from '../guide.js'
  import type { PillStatus } from '../pill-status.js'
  import { realClock } from '../real-clock.js'
  import { probeRelay, type ProbeResult } from '../relay-probe.js'
  import { clockTick, relativeTime } from '../relative-time.js'
  import { CARD, OUTLINE_BUTTON } from '../ui/styles.js'

  type Connection = SharedSnapshot['relays'][number]

  interface Props {
    /** The relay this card is about (a ws(s) URL). Unused in the none state. */
    relayUrl: string
    /** A relay is known (`relayKnown()`, or one typed into the field); false → the none state. */
    known?: boolean
    /** The snapshot's roll-up for this relay, when the vault is connected to it. */
    connection?: Connection | null
    /** The host this build's CSP is pinned to (`TEAM_HOST`); '' = a generic build. */
    pinnedHost?: string
    /** The team relay's host (the build's default relay, when it was given one); '' = none. */
    teamHost?: string
    /** The build's network sentence, shown under the team's relay. */
    networkNote?: string
    /** Show the people online in the connected line (the Shared view does). */
    showPeople?: boolean
    /** Offer *Test* (re-probe) — Settings. */
    showTest?: boolean
    /** *Change…* / *Use another…*; never drawn in a pinned build. */
    onChange?: () => void
    changeLabel?: 'change' | 'use_another'
    clock?: Clock
    /** Injected for tests: the health check. */
    probe?: (relayUrl: string) => Promise<ProbeResult>
    testid?: string
  }

  let {
    relayUrl,
    known = true,
    connection = null,
    pinnedHost = '',
    teamHost = '',
    networkNote = '',
    showPeople = false,
    showTest = false,
    onChange,
    changeLabel = 'change',
    clock = realClock,
    probe,
    testid = 'relay-card',
  }: Props = $props()

  const t = $derived($LL.web.relay_card)
  const r = $derived($LL.web.shared.relay)

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)
  const ago = (at: number): string => relativeTime(at, $tick, $LL)

  /** How long a changed URL settles before it is probed (typing must not fire a probe per key). */
  const PROBE_DEBOUNCE_MS = 300

  const host = $derived(connection?.host || relayHost(relayUrl) || relayUrl)
  const mode = $derived<'none' | 'connected' | 'probe'>(!known ? 'none' : connection ? 'connected' : 'probe')
  const isTeam = $derived(!!teamHost && host.toLowerCase() === teamHost.toLowerCase())

  // ---- the probe ----
  let probed = $state<{ url: string; result: ProbeResult | null; at: number } | null>(null)
  let seq = 0

  function runProbe(url: string): void {
    const mine = ++seq
    probed = { url, result: null, at: clock.now() }
    const ask = probe ?? ((u: string) => probeRelay(u, { schedule: clock.schedule }))
    void ask(url)
      .catch((): ProbeResult => ({ ok: false, reason: 'unreachable' }))
      .then((result) => {
        if (mine === seq) probed = { url, result, at: clock.now() }
      })
  }

  $effect(() => {
    if (mode !== 'probe' || !relayUrl) return
    const url = relayUrl
    const cancel = clock.schedule(() => runProbe(url), PROBE_DEBOUNCE_MS)
    return cancel
  })

  const probeState = $derived(
    !probed || probed.url !== relayUrl || probed.result === null
      ? 'checking'
      : probed.result.ok
        ? 'reachable'
        : probed.result.reason === 'unhealthy'
          ? 'unhealthy'
          : 'unreachable'
  )

  /** What the card's `data-state` says (tests and e2e read it). */
  const cardState = $derived(mode === 'none' ? 'none' : mode === 'connected' ? connection!.state : probeState)

  /** The dot, in sync colours only. */
  const dot = $derived<PillStatus>(
    mode === 'connected'
      ? connection!.state === 'connected'
        ? connection!.inSyncSince !== undefined
          ? 'green'
          : 'yellow'
        : connection!.state === 'refused'
          ? 'red'
          : 'offline'
      : probeState === 'reachable'
        ? 'green'
        : probeState === 'unhealthy'
          ? 'red'
          : 'offline'
  )

  const button = `${OUTLINE_BUTTON} px-2 py-0.5 text-xs text-base-content/80`
  const link =
    'text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
</script>

<div data-testid={testid} data-state={cardState} class="{CARD} flex flex-wrap items-start gap-3 px-4 py-3">
  <span aria-hidden="true" class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/80">
    <Server size={18} />
  </span>
  <div class="grid min-w-0 flex-1 gap-0.5">
    {#if mode === 'none'}
      <p data-testid="relay-host" class="m-0 text-sm font-medium">{t.none_host()}</p>
      <p data-testid="relay-state" class="m-0 text-xs text-base-content/80">{t.none_body()}</p>
      <a data-testid="relay-guide" href={guideHref('relay')} target="_blank" rel="noreferrer" class="justify-self-start {link}"
        >{t.guide()}</a
      >
    {:else}
      <p class="m-0 flex min-w-0 items-center gap-2">
        <span class="ed-sync-host items-center" data-status={dot}><span class="ed-sync-dot" aria-hidden="true"></span></span>
        <span data-testid="relay-host" class="truncate font-ed-mono text-sm font-medium">{host || r.unknown_host()}</span>
        {#if isTeam}
          <span data-testid="relay-team" class="shrink-0 rounded border border-base-300 px-1 text-[11px] text-base-content/80"
            >{t.team()}</span
          >
        {/if}
      </p>
      <p data-testid="relay-state" class="m-0 text-xs text-base-content/80">
        {#if mode === 'connected' && connection}
          {#if connection.state === 'refused'}
            {connection.reason ? r.refused_reason({ reason: connection.reason }) : r.state.refused()}
          {:else}
            {r.state[connection.state]()}
            {#if connection.state === 'connected'}
              · {r.rooms({ count: connection.rooms })}
              {#if showPeople}· {connection.people ? r.people({ count: connection.people }) : r.only_you()}{/if}
              {#if connection.inSyncSince !== undefined}· {r.in_sync({ when: ago(connection.inSyncSince) })}{/if}
            {:else}
              {#if connection.lastInSyncAt !== undefined}· {r.last_in_sync({ when: ago(connection.lastInSyncAt) })}{/if}
              · {r.safe()}
            {/if}
          {/if}
        {:else if probeState === 'checking'}
          {t.checking()}
        {:else if probeState === 'reachable'}
          {t.reachable({ when: ago(probed?.at ?? $tick) })}
        {:else if probeState === 'unhealthy'}
          {t.unhealthy()}
        {:else}
          {t.unreachable()}
        {/if}
      </p>
      {#if isTeam && networkNote}
        <p data-testid="relay-network-note" class="m-0 text-xs text-base-content/80">{networkNote}</p>
      {/if}
    {/if}
    {#if pinnedHost}
      <p data-testid="relay-pinned" class="m-0 text-xs text-base-content/80">{t.pinned({ host: pinnedHost })}</p>
    {/if}
  </div>
  {#if (showTest && mode === 'probe') || (onChange && !pinnedHost)}
    <div class="ml-auto flex shrink-0 gap-1.5">
      {#if showTest && mode === 'probe'}
        <button type="button" data-testid="relay-test" onclick={() => runProbe(relayUrl)} class={button}>{t.test()}</button>
      {/if}
      {#if onChange && !pinnedHost}
        <button type="button" data-testid="relay-change" onclick={onChange} class={button}
          >{changeLabel === 'use_another' ? t.use_another() : t.change()}</button
        >
      {/if}
    </div>
  {/if}
</div>
