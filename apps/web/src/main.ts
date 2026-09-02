import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { initTheme } from './lib/theme.svelte.js'

// The inline boot script in index.html already set data-theme; this syncs the
// reactive state to it and starts following the OS while the pref is `system`.
initTheme()

const app = mount(App, { target: document.getElementById('app')! })

export default app
