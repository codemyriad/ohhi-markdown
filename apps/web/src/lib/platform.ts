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
