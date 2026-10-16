import type { ResourceRoot } from './resources.svelte.js'

/**
 * Runtime platform detection for the web shell. When the app runs inside the
 * Tauri desktop shell, Tauri injects `window.__TAURI_INTERNALS__` into the
 * webview (see apps/desktop/README.md). Everywhere else we're a plain browser.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** What `isMobile` reads: the parts of `navigator` that name the device. */
export interface DeviceHints {
  userAgent: string
  maxTouchPoints?: number
}

/**
 * Whether a user agent is a phone or tablet OS: Android, iPhone, iPad. iPadOS
 * 13+ reports a Mac user agent, so a "Macintosh" with a touch screen counts.
 */
export function isMobileAgent({ userAgent, maxTouchPoints = 0 }: DeviceHints): boolean {
  if (/Android|iPhone|iPad|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/**
 * The Tauri app on a phone or tablet (`tauri android` / `tauri ios`,
 * docs/mobile-android.md). It is Tauri, but it has no folders to pick, no
 * updater and no other app reading its files: its vaults live in the
 * webview's own storage, as a browser's do. Read from the user agent rather
 * than `@tauri-apps/plugin-os`, which would add a plugin for one answer the
 * webview already gives.
 */
export function isMobile(hints: DeviceHints | null = typeof navigator !== 'undefined' ? navigator : null): boolean {
  return isTauri() && hints !== null && isMobileAgent(hints)
}

/**
 * The desktop app: Tauri with folders on disk, the native picker, the
 * updater, and a disk another app (an agent, Claude Code) can read. The
 * components' `desktop` / `isTauri` flags take this answer. Plain `isTauri()`
 * stays for what every Tauri build shares: IPC (the app version), and an
 * origin (`tauri.localhost`) no share link can point at.
 */
export function isDesktop(): boolean {
  return isTauri() && !isMobile()
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
  if (!isDesktop()) return null
  try {
    const { createTauriUserRoot } = await import('./adapters/tauri-user-root.js')
    return await createTauriUserRoot()
  } catch {
    return null
  }
}
