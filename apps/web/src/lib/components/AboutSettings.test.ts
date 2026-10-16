// @vitest-environment jsdom
/**
 * Settings › About's update line in its three places: the desktop (the
 * version line says it all), a browser (reload to update), and the phone app
 * (no updater yet: docs/mobile-android.md).
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import AboutSettings from './AboutSettings.svelte'

afterEach(() => cleanup())

const t = getLL().web.settings.about

describe('AboutSettings, how it updates', () => {
  it('a browser reloads', () => {
    render(AboutSettings, { desktop: false, mobile: false })
    expect(screen.getByText(t.web_updates())).toBeTruthy()
    expect(screen.queryByText(t.phone_updates())).toBeNull()
  })

  it('the phone app says it does not update itself, never "reload the page"', () => {
    render(AboutSettings, { desktop: false, mobile: true })
    expect(screen.getByText(t.phone_updates())).toBeTruthy()
    expect(screen.queryByText(t.web_updates())).toBeNull()
  })

  it('the desktop adds no line of its own', () => {
    render(AboutSettings, { desktop: true, mobile: false })
    expect(screen.queryByText(t.web_updates())).toBeNull()
    expect(screen.queryByText(t.phone_updates())).toBeNull()
  })
})
