<script lang="ts">
  /**
   * *Get the desktop app* (docs/public-deploy.md), drawn two ways from the
   * build's `downloads.json` (`desktopDownloads`):
   *
   *  - `section` — Settings › About: the file for this computer as the
   *    page's one link-button, its name, size and release, a sentence on
   *    installing it, the guide's install notes, and every other file. The
   *    list loading or failing is said, in a live region.
   *  - `line` — the browser-storage note's one link, "Get the desktop app
   *    for macOS". Quiet: nothing while loading, on failure, or when no file
   *    fits this computer.
   *
   * Nothing at all in the desktop app or a build without a list
   * (`offered()`). The links are plain `<a href>`s to the files — a download
   * the browser handles, no script in between.
   */
  import { untrack } from 'svelte'
  import { Download } from '@lucide/svelte'
  import { LL, locale } from '@ohhi/i18n/i18n-svelte'
  import type { DownloadFile } from '../downloads.js'
  import { desktopDownloads, type DesktopDownloads } from '../downloads.svelte.js'
  import { openGuide } from '../guide.js'
  import { formatBytes } from '../storage-persistence.js'
  import { BUTTON, BUTTON_PRIMARY, EYEBROW, LINK, META } from '../ui/styles.js'

  interface Props {
    variant?: 'section' | 'line'
    /** Injected for tests; the page's one list otherwise. */
    downloads?: DesktopDownloads
  }

  let { variant = 'section', downloads = desktopDownloads }: Props = $props()

  const t = $derived($LL.web.downloads)
  const offered = $derived(downloads.offered())

  // Once, on mount. `load` reads the status it sets, so it runs untracked:
  // a failed fetch must not re-run this effect into a retry loop.
  $effect(() => {
    if (offered) untrack(() => void downloads.load())
  })

  const primary = $derived(downloads.pick.primary)
  const others = $derived(downloads.pick.others)
  const version = $derived(downloads.manifest?.version ?? '')

  function meta(f: DownloadFile): string {
    return f.size
      ? t.meta({ name: f.name, size: formatBytes(f.size, $locale), version })
      : t.meta_unsized({ name: f.name, version })
  }
</script>

{#if offered && variant === 'line'}
  {#if downloads.status === 'ready' && primary}
    <a href={primary.url} rel="noopener" data-testid="desktop-download-line" class={LINK}>
      {t.note_link({ os: t.os[primary.os]() })}
    </a>
  {/if}
{:else if offered}
  <section data-testid="desktop-download" aria-labelledby="desktop-download-heading">
    <h3 id="desktop-download-heading" class={EYEBROW}>{t.heading()}</h3>
    <p class="mt-1 {META}">{t.lede()}</p>
    <div role="status" class="mt-2" data-testid="desktop-download-status" data-state={downloads.status}>
      {#if downloads.status === 'failed'}
        <p class={META}>{t.failed()}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class={BUTTON} data-testid="desktop-download-retry" onclick={() => void downloads.load()}>
            {t.retry()}
          </button>
          <button type="button" class={BUTTON} onclick={() => void openGuide('start')}>{t.guide()}</button>
        </div>
      {:else if downloads.status !== 'ready'}
        <p class={META}>{t.loading()}</p>
      {/if}
    </div>
    {#if downloads.status === 'ready'}
      {#if primary}
        <a href={primary.url} rel="noopener" data-testid="desktop-download-primary" class="{BUTTON_PRIMARY} mt-1">
          <Download size={14} strokeWidth={1.75} aria-hidden="true" />
          {t.for_os({ os: t.os[primary.os]() })}
        </a>
        <p class="mt-1.5 {META}" data-testid="desktop-download-meta">{meta(primary)}</p>
        <p class="mt-1 {META}" data-testid="desktop-download-install">{t.install[primary.kind]()}</p>
      {:else}
        <p class={META} data-testid="desktop-download-none">{t.none_for_os()}</p>
      {/if}
      <button type="button" class="{LINK} mt-2" data-testid="desktop-download-guide" onclick={() => void openGuide('start')}>
        {t.guide()}
      </button>
      {#if others.length}
        <h4 class="mt-3 {META} font-medium">{t.others()}</h4>
        <ul class="mt-1 space-y-1" data-testid="desktop-download-others">
          {#each others as f (f.url)}
            <li class={META}>
              <a href={f.url} rel="noopener" class={LINK}>{t.kind[f.kind]()}</a>
              <span> · {meta(f)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}
