// @vitest-environment jsdom
/**
 * Settings > Hotkeys (tab-groups R1.3).
 *
 * The tab is a VIEW of the shell's command registry, so the test builds a
 * registry the way App.svelte does and asserts what the user can see and do:
 * the key in force, an override that takes, a refusal that explains itself,
 * Reset, and a chord recorded by pressing it.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@editor/i18n'
import { CommandRegistry } from '../commands.js'
import { hotkeys } from '../config.js'
import SettingsPanel from './SettingsPanel.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
beforeEach(() => localStorage.clear())

const LL = getLL()
const t = LL.web.settings.hotkeys

/** Two bound commands in one group and one unbound command in another. */
function registryWith(): CommandRegistry {
  const registry = new CommandRegistry(false)
  registry.register(
    { id: 'nav.back', title: 'Back', group: 'Navigate', keys: 'Mod+[', run: () => {} },
    { id: 'tab.close', title: 'Close tab', group: 'Tab', keys: 'Mod+w', run: () => {} },
    { id: 'group.new', title: 'New group', group: 'Group', run: () => {} }
  )
  return registry
}

/** Render Settings straight onto the Hotkeys tab. */
async function openHotkeys(registry = registryWith()) {
  render(SettingsPanel, { onClose: vi.fn(), registry, initialTab: 'hotkeys' })
  await screen.findByTestId('settings-hotkeys')
  return registry
}

const input = (id: string): HTMLInputElement => screen.getByTestId(`hotkey-input:${id}`)
const shown = (id: string): string => screen.getByTestId(`hotkey-binding:${id}`).textContent!.trim()

describe('Settings > Hotkeys', () => {
  it('lists every registered command under its group, with the key in force', async () => {
    await openHotkeys()

    for (const group of ['Navigate', 'Tab', 'Group']) {
      expect(screen.getByRole('heading', { name: group })).toBeVisible()
    }
    expect(shown('nav.back')).toBe('Ctrl+[')
    // A command that ships without a key says so rather than showing a blank.
    expect(shown('group.new')).toBe(t.unbound())
    expect(input('group.new')).toHaveAccessibleName(t.shortcut_for({ command: 'New group' }))
  })

  it('takes an override, and Reset puts the default back', async () => {
    const user = userEvent.setup()
    const registry = await openHotkeys()

    await user.clear(input('tab.close'))
    await user.type(input('tab.close'), 'Mod+Shift+w{Enter}')

    await waitFor(() => expect(shown('tab.close')).toBe('Ctrl+Shift+W'))
    expect(hotkeys()).toEqual({ 'tab.close': 'Mod+Shift+w' })
    expect(registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')

    await user.click(screen.getByTestId('hotkey-reset:tab.close'))
    await waitFor(() => expect(shown('tab.close')).toBe('Ctrl+W'))
    expect(hotkeys()).toEqual({})
    // Nothing to reset until there is an override again.
    expect(screen.getByTestId('hotkey-reset:tab.close')).toBeDisabled()
  })

  it('refuses a shortcut it cannot read, at the field, keeping the default', async () => {
    const user = userEvent.setup()
    const registry = await openHotkeys()

    await user.clear(input('nav.back'))
    await user.type(input('nav.back'), 'Hyper+K{Enter}')

    await waitFor(() => expect(input('nav.back')).toHaveAttribute('aria-invalid', 'true'))
    expect(input('nav.back')).toHaveAccessibleDescription(
      expect.stringContaining(t.invalid({ example: 'Mod+Shift+P' }))
    )
    expect(shown('nav.back')).toBe('Ctrl+[')
    expect(registry.effectiveKeys('nav.back')).toBe('Mod+[')
    expect(hotkeys()).toEqual({})
  })

  it('unbinds a command when the field is emptied', async () => {
    const user = userEvent.setup()
    const registry = await openHotkeys()

    await user.clear(input('nav.back'))
    await user.tab()

    await waitFor(() => expect(shown('nav.back')).toBe(t.unbound()))
    expect(hotkeys()).toEqual({ 'nav.back': null })
    expect(registry.effectiveKeys('nav.back')).toBe('')
  })

  it('records a chord pressed into the field, and runs no command while it does', async () => {
    const user = userEvent.setup()
    const registry = await openHotkeys()

    await user.click(screen.getByTestId('hotkey-record:group.new'))
    await waitFor(() => expect(input('group.new')).toHaveFocus())
    // Suspended: the chord being recorded must not also run what it is bound to.
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeNull()

    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}')

    await waitFor(() => expect(shown('group.new')).toBe('Ctrl+Shift+G'))
    expect(hotkeys()).toEqual({ 'group.new': 'Mod+Shift+g' })
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe('tab.close')
  })

  it('leaves the recording with Escape, changing nothing', async () => {
    const user = userEvent.setup()
    const registry = await openHotkeys()

    await user.click(screen.getByTestId('hotkey-record:tab.close'))
    await waitFor(() => expect(input('tab.close')).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(shown('tab.close')).toBe('Ctrl+W')
    expect(hotkeys()).toEqual({})
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe('tab.close')
  })
})
