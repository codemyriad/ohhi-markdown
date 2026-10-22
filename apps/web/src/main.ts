// First: inside Nextcloud, park the storage namespace before any module below reads config.
import './lib/nextcloud/preboot.js'
import { mount } from 'svelte'
import { z } from 'zod'
import './app.css'
import App from './App.svelte'
import { initI18n } from './lib/i18n.js'
import { prepareNextcloudHost } from './lib/nextcloud/host-boot.js'
import { initTheme } from './lib/theme.svelte.js'

// The CSP forbids eval (docs/desktop-builds.md); without this, zod 4 probes
// `new Function('')` on first parse and logs a (harmless) CSP violation.
z.config({ jitless: true })

/**
 * The dictionary loads before the first render: every string in the shell is
 * `$LL.…()` / `getLL()`, and the store answers '' until a locale is set. Then
 * the Nextcloud host (a no-op anywhere else) learns who is signed in and sets
 * the storage namespace (decision 16) — before the theme is read for real and
 * before the shell mounts and reads its config.
 */
async function start(): Promise<void> {
  await initI18n()
  await prepareNextcloudHost()
  // The inline boot script in index.html already set data-theme; this syncs the
  // reactive state to it and starts following the OS while the pref is `system`.
  initTheme()
  mount(App, { target: document.getElementById('app')! })
}

void start()
