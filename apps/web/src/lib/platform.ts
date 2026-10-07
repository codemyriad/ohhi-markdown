import type { ResourceRoot } from './resources.svelte.js'

/**
 * Runtime platform detection for the web shell. When the app runs inside the
 * Tauri desktop shell, Tauri injects `window.__TAURI_INTERNALS__` into the
 * webview (see apps/desktop/README.md). Everywhere else we're a plain browser.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** OPFS is our browser vault backend; require it before offering browser join. */
export function hasOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/**
 * The user resource root (`~/.config/ohhi/`) on desktop; null in the browser,
 * which has no user-editable folder (spike-resource-root Q4). The Tauri
 * modules load only on desktop, so the browser bundle never pulls them in.
 */
export async function userResourceRoot(): Promise<ResourceRoot | null> {
  if (!isTauri()) return null
  try {
    const { createTauriUserRoot } = await import('./adapters/tauri-user-root.js')
    return await createTauriUserRoot()
  } catch {
    return null
  }
}
