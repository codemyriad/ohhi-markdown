/**
 * Which app this is: a browser, the desktop app, or the Tauri app on a phone
 * (docs/mobile-android.md). The phone is Tauri but takes the browser's vault
 * path, so `isDesktop()` is what the folder-picking flags read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isDesktop, isMobile, isMobileAgent, isTauri } from './platform.js'

const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 16; sdk_gphone64_x86_64 Build/BP22.250325.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/133.0.6943.137 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'

describe('isMobileAgent', () => {
  it('names Android, iPhone and an iPad (which reports a Mac with a touch screen)', () => {
    expect(isMobileAgent({ userAgent: ANDROID_WEBVIEW })).toBe(true)
    expect(isMobileAgent({ userAgent: IPHONE })).toBe(true)
    expect(isMobileAgent({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true)
  })

  it('leaves a desktop alone, a Mac without a touch screen included', () => {
    expect(isMobileAgent({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false)
    expect(isMobileAgent({ userAgent: MAC })).toBe(false)
    expect(isMobileAgent({ userAgent: LINUX })).toBe(false)
  })
})

describe('isMobile / isDesktop', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the Tauri app on Android is mobile, not desktop', () => {
    expect(isTauri()).toBe(true)
    expect(isMobile({ userAgent: ANDROID_WEBVIEW })).toBe(true)
  })

  it('the Tauri app on Linux is desktop, not mobile', () => {
    vi.stubGlobal('navigator', { userAgent: LINUX, maxTouchPoints: 0 })
    expect(isMobile()).toBe(false)
    expect(isDesktop()).toBe(true)
  })

  it('reads the live navigator by default', () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_WEBVIEW, maxTouchPoints: 5 })
    expect(isMobile()).toBe(true)
    expect(isDesktop()).toBe(false)
  })

  it('a phone BROWSER is neither: it is not Tauri, so the browser path holds anyway', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { userAgent: ANDROID_WEBVIEW, maxTouchPoints: 5 })
    expect(isTauri()).toBe(false)
    expect(isMobile()).toBe(false)
    expect(isDesktop()).toBe(false)
  })
})
