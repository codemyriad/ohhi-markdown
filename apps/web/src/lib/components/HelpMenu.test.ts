// @vitest-environment jsdom
import { SimClock } from '@ohhi/testkit'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentVersion, help, loadVersion, setHelpHost, versionLine } from '../help.svelte.js'
import HelpMenu from './HelpMenu.svelte'

const H = 60 * 60 * 1000

afterEach(() => {
  cleanup()
  setHelpHost(null)
})

beforeEach(() => {
  help.menuOpen = false
  help.reportOpen = false
  help.version = '0.1.42'
  help.update = { kind: 'unchecked' }
})

describe('HelpMenu', () => {
  it('lists the guides, the shortcuts, what is new, the report and the version', async () => {
    const user = userEvent.setup()
    render(HelpMenu, { clock: new SimClock() })
    const trigger = screen.getByTestId('help-menu')
    expect(trigger).toHaveAccessibleName('Help')
    await user.click(trigger)
    await screen.findByRole('menu')
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Getting started 2 min',
      'Keyboard shortcuts',
      'When something goes wrong',
      'Sharing and the relay',
      'Customising the app',
      'Working with an agent',
      'What’s new in 0.1.42',
      'Report a problem…',
    ])
    expect(screen.getByTestId('help-version')).toHaveTextContent('Version 0.1.42')
  })

  it('runs each row through the help host: shortcuts, a guide, the report', async () => {
    const user = userEvent.setup()
    const openShortcuts = vi.fn()
    const openGuide = vi.fn()
    setHelpHost({ openShortcuts, openGuide })
    render(HelpMenu, { clock: new SimClock() })

    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:shortcuts'))
    expect(openShortcuts).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:sharing'))
    expect(openGuide).toHaveBeenCalledWith('sharing')

    // settings-shaping ST6: the two guides the Customise and Agents sections link to.
    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:customise'))
    expect(openGuide).toHaveBeenLastCalledWith('customise')
    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:agents'))
    expect(openGuide).toHaveBeenLastCalledWith('agents')

    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:changes'))
    expect(openGuide).toHaveBeenLastCalledWith('changes')

    await user.click(screen.getByTestId('help-menu'))
    await user.click(await screen.findByTestId('help:report'))
    expect(help.reportOpen).toBe(true)
  })

  it('opens from openHelp() (the manager’s door) and counts itself mounted', async () => {
    const { unmount } = render(HelpMenu, { clock: new SimClock() })
    expect(help.menus).toBe(1)
    help.menuOpen = true
    await screen.findByRole('menu')
    unmount()
    expect(help.menus).toBe(0)
  })
})

describe('versionLine (honest, R5)', () => {
  const now = 10 * H
  it('says "up to date" only after a check that found nothing', () => {
    expect(versionLine('1.0.0', { kind: 'unchecked' }, now)).toBe('Version 1.0.0')
    expect(versionLine('1.0.0', { kind: 'current', checkedAt: now - 2 * H }, now)).toBe(
      'Version 1.0.0 · up to date · checked 2 h ago'
    )
  })
  it('a failed check keeps the last good check’s time, never "up to date"', () => {
    expect(versionLine('1.0.0', { kind: 'failed', failedAt: now, lastCheckedAt: now - 3 * H }, now)).toBe(
      'Version 1.0.0 · could not check · last checked 3 h ago'
    )
    expect(versionLine('1.0.0', { kind: 'failed', failedAt: now, lastCheckedAt: null }, now)).toBe(
      'Version 1.0.0 · could not check'
    )
  })
  it('an update found or installed is said as such', () => {
    expect(versionLine('1.0.0', { kind: 'found', version: '1.0.1', checkedAt: now }, now)).toBe(
      'Version 1.0.0 · downloading 1.0.1'
    )
    expect(versionLine('1.0.0', { kind: 'ready', version: '1.0.1', checkedAt: now }, now)).toBe(
      'Version 1.0.0 · update ready, restart to use it'
    )
  })
  it('no version known says so', () => {
    expect(versionLine(null, { kind: 'unchecked' }, now)).toBe('Version not known')
  })
})

describe('currentVersion / loadVersion (one source for every surface)', () => {
  const WEB = '0.1-web.57+4208dff'

  it('a browser names the version the bundle was built with', async () => {
    expect(await currentVersion({ tauri: false, build: WEB })).toBe(WEB)
  })

  it('a browser build without a version (a local build) knows none', async () => {
    expect(await currentVersion({ tauri: false, build: '' })).toBeNull()
  })

  it('the Tauri app names its own version, not the bundle’s', async () => {
    expect(await currentVersion({ tauri: true, build: WEB, tauriVersion: async () => '0.1.42' })).toBe('0.1.42')
  })

  it('a Tauri read that fails falls back to the build’s version, else none', async () => {
    const fail = async (): Promise<string> => {
      throw new Error('no ipc')
    }
    expect(await currentVersion({ tauri: true, build: WEB, tauriVersion: fail })).toBe(WEB)
    expect(await currentVersion({ tauri: true, build: '', tauriVersion: fail })).toBeNull()
  })

  it('the Help menu’s foot names a browser build’s version', async () => {
    help.version = null
    await loadVersion({ tauri: false, build: WEB })
    expect(help.version).toBe(WEB)
    const user = userEvent.setup()
    render(HelpMenu, { clock: new SimClock() })
    await user.click(screen.getByTestId('help-menu'))
    expect(await screen.findByTestId('help-version')).toHaveTextContent(`Version ${WEB}`)
  })

  it('a browser build without a version leaves the foot as today: not known', async () => {
    help.version = null
    await loadVersion({ tauri: false, build: '' })
    expect(help.version).toBeNull()
    const user = userEvent.setup()
    render(HelpMenu, { clock: new SimClock() })
    await user.click(screen.getByTestId('help-menu'))
    expect(await screen.findByTestId('help-version')).toHaveTextContent('Version not known')
  })

  it('the desktop fills it from Tauri, unchanged', async () => {
    help.version = null
    await loadVersion({ tauri: true, build: '', tauriVersion: async () => '0.1.42' })
    expect(help.version).toBe('0.1.42')
  })
})
