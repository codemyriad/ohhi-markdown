<script lang="ts" module>
  /** The desktop builds (docs/desktop-builds.md §How releases happen). Not copy: a URL. */
  export const RELEASES_URL = 'https://github.com/codemyriad/ohhi-markdown/releases'
</script>

<script lang="ts">
  /**
   * The join page (first-run-shaping C2, Fork 1-A / 3-B): what a browser
   * shows at `https://<host>/join#editor1:…` — the link in its URL form,
   * clicked from a chat. Rendered INSTEAD of the vault manager, in the
   * browser build only (`params.ts` `joinPageLink`; a Tauri window never
   * reaches `/join`, the desktop's dialogs read the URL instead).
   *
   * It says what the link is before anything is picked: who sent it — the
   * name THEY TYPED, never a verified account (R5) — what you get, which
   * relay it syncs through and whether that relay answers from here (R3; a
   * health check, never "the link is valid"). Then where it should go: *In
   * the desktop app* copies the link for the app's *Add a folder someone
   * shared* (Fork 3-B — no deep link yet); *In this browser* hands off to the
   * manager's existing Add dialog, prefilled, where the join itself lives.
   *
   * A device link is not a folder share and is never offered as one: the
   * page says what it is and routes it to *Link this device* (device-link R5).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { relayHost } from '@ohhi/workspace'
  import { CircleAlert, CircleCheck, Copy, Globe, LoaderCircle, Monitor } from '@lucide/svelte'
  import { TEAM_NETWORK_NOTE } from '../config.js'
  import { guideHref } from '../guide.js'
  import { checkRelay, defaultProbe, teamRelayHost, type Probe, type RelayCheck } from '../relay-check.js'
  import { decodeShareLink, shareLinkErrorText, type DecodedShareLink } from '../share-link.js'
  import Field from '../ui/Field.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { CARD, FACT, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    /** The page's address (or any spelling the codec reads). */
    link: string
    /** *In this browser* for a folder link: the manager's Add dialog, prefilled. */
    onAddHere: (link: string) => void
    /** *Link this device* for a device link: the manager's device dialog, prefilled. */
    onLinkHere: (link: string) => void
    /** The build's relay host (the team's), or null in a build without one. */
    teamHost?: string | null
    /** The build's sentence about reaching that relay ('' = none). */
    networkNote?: string
    /** The relay health check; tests hand in a fake. */
    probe?: Probe
    /**
     * Where "Download" goes: the repository's Releases page, where every
     * build's `.dmg` / `.AppImage` lands (docs/deploy-tailnet.md §Teammates,
     * docs/desktop-builds.md). The repository is private, so it opens for
     * people in the GitHub org.
     */
    downloadHref?: string
  }

  let {
    link,
    onAddHere,
    onLinkHere,
    teamHost = teamRelayHost(),
    networkNote = TEAM_NETWORK_NOTE,
    probe = defaultProbe,
    downloadHref = RELEASES_URL,
  }: Props = $props()

  const t = $derived($LL.web.join_page)

  type Decoded = { ok: true; link: DecodedShareLink } | { ok: false; error: string }
  const decoded: Decoded = $derived.by(() => {
    try {
      return { ok: true, link: decodeShareLink(link) }
    } catch (err) {
      return { ok: false, error: shareLinkErrorText(err) }
    }
  })

  const share = $derived(decoded.ok ? decoded.link : null)
  const host = $derived(share ? (relayHost(share.relay) ?? share.relay) : '')
  const isTeam = $derived(teamHost !== null && host === teamHost)

  // ---- the relay probe, run on load (and again if the link changes) ----
  // The effect's teardown cancels it: leaving the page drops the answer.
  let check = $state<RelayCheck>('pending')
  $effect(() => {
    const relay = share?.relay
    if (!relay) return
    check = 'pending'
    return checkRelay(relay, probe, (c) => (check = c))
  })

  // ---- the copy action (Fork 3-B) ----
  let copied = $state<'idle' | 'done' | 'failed'>('idle')
  let fallbackLink = $state('')
  function copy(): void {
    fallbackLink = link
    // In the click handler itself: browsers grant the clipboard to a user gesture.
    let pending: Promise<void>
    try {
      pending = navigator.clipboard.writeText(link)
    } catch {
      copied = 'failed'
      return
    }
    pending.then(
      () => (copied = 'done'),
      () => (copied = 'failed')
    )
  }

  const isDevice = $derived(share?.kind === 'device')
  const label = $derived(share?.label ?? t.a_folder())

  const option = `flex flex-col gap-2 ${CARD} p-4`
  const primary =
    'self-start rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary'
  const outline = `self-start ${OUTLINE_BUTTON} inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-base-content/80`
  const linkCls = 'text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary'
</script>

<main class="flex min-h-screen items-start justify-center bg-base-200 px-4 py-12 text-base-content" data-testid="join-page">
  <div class="w-full max-w-xl space-y-6 {CARD} p-6 shadow-sm">
    <p class={HEADING} data-testid="join-brand">{t.brand()}</p>

    {#if !decoded.ok}
      <section class="space-y-2" data-testid="join-error">
        <h1 class="flex items-center gap-2 text-xl font-semibold">
          <CircleAlert size={20} strokeWidth={1.75} aria-hidden="true" class="shrink-0 text-error" />
          {t.error_heading()}
        </h1>
        <p class="text-sm" role="alert">{decoded.error}</p>
        <p class="text-sm text-base-content/70">{t.error_fallback()}</p>
      </section>
    {:else if share}
      <header class="space-y-1.5">
        {#if isDevice}
          <h1 class="text-xl font-semibold" data-testid="join-heading">{t.device_heading()}</h1>
          <p class="text-sm text-base-content/80" data-testid="join-device-body">
            {t.device_body({ label: share.label ?? t.device_vault() })}
          </p>
        {:else}
          <h1 class="text-xl font-semibold" data-testid="join-heading">
            {share.from ? t.heading_from({ from: share.from, label }) : t.heading_anon({ label })}
          </h1>
          <p class="text-sm text-base-content/70" data-testid="join-sender-note">
            {share.from ? t.from_note({ from: share.from }) : t.anon_note()}
          </p>
        {/if}
      </header>

      <dl class="space-y-3" aria-label={t.facts()}>
        {#if !isDevice}
          <div>
            <dt class={FACT}>{t.what_you_get()}</dt>
            <dd class="mt-0.5 text-sm">{t.what_you_get_body()}</dd>
          </div>
        {/if}
        <div>
          <dt class={FACT}>{t.syncs_through()}</dt>
          <dd class="mt-0.5 text-sm" data-testid="join-syncs-through">
            {isTeam ? t.syncs_team({ host }) : t.syncs_other({ host })}
            {#if isTeam && networkNote}{networkNote}{/if}
            {t.offline()}
          </dd>
          <dd class="mt-1.5">
            <div class="flex items-start gap-1.5 text-sm" role="status" data-testid="join-relay" data-check={check}>
              {#if check === 'pending'}
                <LoaderCircle size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 animate-spin text-base-content/70" />
                <span class="text-base-content/70">{t.relay_checking()}</span>
              {:else if check === 'ok'}
                <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-success" />
                <span>{t.relay_ok()}</span>
              {:else}
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" class="mt-0.5 shrink-0 text-warning" />
                <span>
                  {t.relay_down()}
                  {isTeam ? networkNote : t.relay_down_other()}
                  {t.reload()}
                </span>
              {/if}
            </div>
          </dd>
        </div>
      </dl>

      <section class="space-y-3" aria-labelledby="join-where">
        <h2 id="join-where" class={HEADING}>{t.where()}</h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class={option} data-testid="join-option-desktop">
            <h3 class="flex items-center gap-1.5 text-sm font-semibold">
              <Monitor size={16} strokeWidth={1.75} aria-hidden="true" />
              {t.desktop()}
            </h3>
            <p class="flex-1 text-xs text-base-content/70">{isDevice ? t.device_desktop_hint() : t.desktop_hint()}</p>
            <button type="button" class={outline} data-testid="join-copy" onclick={copy}>
              <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
              {t.copy()}
            </button>
          </div>
          <div class={option} data-testid="join-option-browser">
            <h3 class="flex items-center gap-1.5 text-sm font-semibold">
              <Globe size={16} strokeWidth={1.75} aria-hidden="true" />
              {t.browser()}
            </h3>
            <p class="flex-1 text-xs text-base-content/70">{isDevice ? t.device_browser_hint() : t.browser_hint()}</p>
            {#if isDevice}
              <button type="button" class={primary} data-testid="join-link-here" onclick={() => onLinkHere(link)}>
                {t.link_here()}
              </button>
            {:else}
              <button type="button" class={primary} data-testid="join-add-here" onclick={() => onAddHere(link)}>
                {t.add_here()}
              </button>
            {/if}
          </div>
        </div>
        <div aria-live="polite">
          {#if copied === 'done'}
            <p class="text-sm" data-testid="join-copied">{isDevice ? t.device_copied() : t.copied()}</p>
          {:else if copied === 'failed'}
            <div class="space-y-2" data-testid="join-copy-failed">
              <p class="text-sm">{isDevice ? t.device_copy_failed() : t.copy_failed()}</p>
              <Field name="join-link">
                <TextControl
                  label={t.link_label()}
                  mono
                  readonly
                  bind:value={fallbackLink}
                  onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
                  testid="join-link-text"
                  class="text-[11px]"
                />
              </Field>
            </div>
          {/if}
        </div>
      </section>
    {/if}

    <footer class="space-y-1 border-t border-base-300 pt-4 text-xs text-base-content/70">
      <p>
        {t.no_app()}
        <a class={linkCls} href={downloadHref} data-testid="join-download">{t.download()}</a>
      </p>
      <p>
        {t.new_to_app()}
        <a class={linkCls} href={guideHref('start')} data-testid="join-guide">{t.guide()}</a>
      </p>
    </footer>
  </div>
</main>
