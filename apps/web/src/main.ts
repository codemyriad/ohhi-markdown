import { mount } from 'svelte'
import { z } from 'zod'
import './app.css'
import App from './App.svelte'
import { initI18n } from './lib/i18n.js'
import { initTheme } from './lib/theme.svelte.js'

// The CSP forbids eval (docs/desktop-builds.md); without this, zod 4 probes
// `new Function('')` on first parse and logs a (harmless) CSP violation.
z.config({ jitless: true })

// The inline boot script in index.html already set data-theme; this syncs the
// reactive state to it and starts following the OS while the pref is `system`.
initTheme()

// The dictionary loads before the first render: every string in the shell is
// `$LL.…()` / `getLL()`, and the store answers '' until a locale is set.
void initI18n().then(() => mount(App, { target: document.getElementById('app')! }))
