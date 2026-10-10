<script lang="ts">
  /**
   * Settings as a page (settings-shaping ST1, Fork 1): what the vault
   * manager shows for its settings door — the same `Settings` body as the
   * view tab, under a header with the way back to the vaults. Sections that
   * need a vault say so (`NEEDS_VAULT`) unless one is open behind the manager.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { SettingsSection } from '../settings.js'
  import type { SettingsHost } from '../settings-host.js'
  import Settings from './Settings.svelte'

  interface Props {
    host: SettingsHost
    section: SettingsSection
    onSection: (section: SettingsSection) => void
    /** Back to the vault list. */
    onBack: () => void
  }

  let { host, section, onSection, onBack }: Props = $props()

  const chrome =
    'rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
</script>

<div class="flex min-h-screen flex-col bg-base-100 text-base-content" data-testid="settings-page">
  <header class="flex items-center justify-between gap-4 border-b border-base-300 px-5 py-2.5">
    <span class="text-sm font-semibold">{$LL.common.app_name()}</span>
    <button type="button" data-testid="settings-page-back" onclick={onBack} class={chrome}>
      {$LL.web.settings.page.back()}
    </button>
  </header>
  <main class="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
    <h1 class="mb-6 text-2xl font-semibold">{$LL.web.settings.title()}</h1>
    <Settings {...host} {section} {onSection} onManageVaults={onBack} host="page" />
  </main>
</div>
