<script lang="ts">
  /**
   * Settings › About (settings-shaping ST2, finding 12): the running build,
   * the updater's last outcome, and the guides (first-run E4).
   *
   * Honest by construction (R5 of first-run): the version line is
   * `versionLine` over `help.update` — "up to date" only when the last check
   * completed and found nothing. There is no *Check now*: the updater has no
   * manual check (`updater.ts` returns only a stop function; deferred). There
   * are no release notes here either: the update manifest carries none
   * ("Build <sha> of <ref>"), so *What's new* is the guide page.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { openGuide, type GuidePage } from '../guide.js'
  import { help, openReport, versionLine } from '../help.svelte.js'
  import { clockTick } from '../relative-time.js'
  import { HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    desktop: boolean
    /** Injected for the tests; the updater's clock otherwise. */
    clock?: Clock
  }

  let { desktop, clock = help.clock }: Props = $props()

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)
  const t = $derived($LL.web.settings.about)
  const h = $derived($LL.web.help.menu)
  const version = $derived(versionLine(help.version, help.update, $tick, $LL))

  const guides = $derived<{ page: GuidePage; label: string }[]>([
    { page: 'start', label: h.start() },
    { page: 'sharing', label: h.sharing() },
    { page: 'recovery', label: h.recovery() },
    { page: 'import', label: t.guide_import() },
    { page: 'relay', label: t.guide_relay() },
    { page: 'changes', label: help.version ? h.changes({ version: help.version }) : h.changes_plain() },
  ])

  const link =
    'text-sm font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
</script>

<section data-testid="settings-about">
  <h3 class={HEADING}>{t.updates()}</h3>
  <p class="mt-1 text-sm text-base-content/80" data-testid="settings-version">{version}</p>
  {#if !desktop}
    <p class="mt-1 text-xs text-base-content/70">{t.web_updates()}</p>
  {/if}
</section>

<section class="mt-5 border-t border-base-300 pt-4">
  <h3 class={HEADING}>{t.guides()}</h3>
  <ul class="mt-2 space-y-1.5">
    {#each guides as guide (guide.page)}
      <li>
        <button type="button" data-testid="settings-guide:{guide.page}" onclick={() => void openGuide(guide.page)} class={link}>
          {guide.label}
        </button>
      </li>
    {/each}
  </ul>
  <button
    type="button"
    data-testid="settings-report"
    onclick={openReport}
    class="{OUTLINE_BUTTON} mt-3 px-3 py-1.5 text-xs font-medium text-base-content/80"
  >
    {h.report()}
  </button>
</section>
