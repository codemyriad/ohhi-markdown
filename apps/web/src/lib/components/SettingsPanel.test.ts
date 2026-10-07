// @vitest-environment jsdom
/**
 * Settings > Hotkeys (tab-groups R1.3, quiet-shell F10), and the Appearance
 * tab's fonts — none to pick since round 3 (Q7).
 *
 * The tab is a VIEW of the shell's command registry under the ACTIVE keymap
 * file, so the test builds a registry, the real resource loader over a fake
 * vault and the real keymap, the way App.svelte does — and asserts what the
 * user can see and do: the key in force, an edit that is a draft until Save,
 * Save writing `.ohhi/keymaps/<name>.json`, the read-only built-in offering
 * Save as, a refusal that explains itself, Reset, and a recorded chord.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { CommandRegistry } from '../commands.js'
import { KEYMAP_SCHEMA_ID } from '../keymap-spec.js'
import { LAYOUT_SCHEMA_ID, NO_OVERRIDES, PRESETS, applyOverrides, type LayoutFile, type ShellSpec } from '../layout-spec.js'
import { keymapWorld } from '../keymap.fixture.js'
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

const mine = { $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings: {} }

/** Render Settings straight onto the Hotkeys tab, over a vault holding `files`. */
async function openHotkeys(opts: { files?: Record<string, unknown>; active?: 'default' | `custom:${string}` } = {}) {
  const world = keymapWorld({ registry: registryWith(), vault: opts.files ?? {}, active: opts.active ?? 'default' })
  await world.keymap.reload()
  render(SettingsPanel, {
    onClose: vi.fn(),
    registry: world.registry,
    keymap: world.keymap,
    resources: world.resources,
    readAppFile: (p: string) => world.vault!.readAppFile(p),
    initialTab: 'hotkeys',
  })
  await screen.findByTestId('settings-hotkeys')
  return world
}

const input = (id: string): HTMLInputElement => screen.getByTestId(`hotkey-input:${id}`)
const shown = (id: string): string => screen.getByTestId(`hotkey-binding:${id}`).textContent!.trim()
const written = (world: ReturnType<typeof keymapWorld>, name: string): unknown =>
  JSON.parse(world.disk!.get(`.ohhi/keymaps/${name}.json`)!)

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
    // The built-in default is read-only: no Save, only Save as.
    expect(screen.getByTestId('keymap-from')).toHaveTextContent(t.from_builtin())
    expect(screen.queryByTestId('keymap-save')).toBeNull()
  })

  it('edits the active vault file as a draft; Save writes it; Reset puts the default back', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys({ files: { '.ohhi/keymaps/mine.json': mine }, active: 'custom:mine' })
    expect(screen.getByTestId('keymap-from')).toHaveTextContent('.ohhi/keymaps/mine.json')

    await user.clear(input('tab.close'))
    await user.type(input('tab.close'), 'Mod+Shift+w{Enter}')

    await waitFor(() => expect(shown('tab.close')).toBe('Ctrl+Shift+W'))
    // A draft: nothing is written, and the registry still has the old key.
    expect(world.registry.effectiveKeys('tab.close')).toBe('Mod+w')
    expect(screen.getByTestId('keymap-dirty')).toBeVisible()

    await user.click(screen.getByTestId('keymap-save'))
    await waitFor(() => expect(screen.getByTestId('keymap-saved')).toHaveTextContent('.ohhi/keymaps/mine.json'))
    expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'tab.close': 'Mod+Shift+w' } })
    expect(world.registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')

    await user.click(screen.getByTestId('hotkey-reset:tab.close'))
    await waitFor(() => expect(shown('tab.close')).toBe('Ctrl+W'))
    await user.click(screen.getByTestId('keymap-save'))
    await waitFor(() => expect(written(world, 'mine')).toEqual(mine))
    // Nothing to reset until there is an override again.
    expect(screen.getByTestId('hotkey-reset:tab.close')).toBeDisabled()
  })

  it('Save as from the read-only default writes a new file extending it, and uses it', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys()

    await user.clear(input('nav.back'))
    await user.tab()
    await waitFor(() => expect(shown('nav.back')).toBe(t.unbound()))

    await user.type(screen.getByTestId('keymap-save-name'), 'laptop')
    await user.click(screen.getByTestId('keymap-save-as'))

    await waitFor(() => expect(world.config.active).toBe('custom:laptop'))
    expect(written(world, 'laptop')).toEqual({
      $schema: KEYMAP_SCHEMA_ID,
      extends: 'default',
      bindings: { 'nav.back': [] },
    })
    expect(world.registry.effectiveKeys('nav.back')).toBe('')
  })

  it('a vault file named after a built-in is read but never written: no Save, and it says why', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys({
      files: { '.ohhi/keymaps/default.json': { $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings: {} } },
    })
    expect(screen.getByTestId('keymap-from')).toHaveTextContent('.ohhi/keymaps/default.json')
    expect(screen.queryByTestId('keymap-save')).toBeNull()
    expect(screen.getByTestId('keymap-shadows-builtin')).toHaveTextContent(t.builtin_name({ name: 'default' }))
    // Save as still works, extending the vault's default.
    await user.clear(input('nav.back'))
    await user.tab()
    await user.type(screen.getByTestId('keymap-save-name'), 'laptop')
    await user.click(screen.getByTestId('keymap-save-as'))
    await waitFor(() => expect(world.config.active).toBe('custom:laptop'))
    expect(written(world, 'laptop')).toEqual({ $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings: { 'nav.back': [] } })
  })

  it('refuses Save as from a keymap that failed to resolve, saying so', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys({ active: 'custom:gone' })
    expect(screen.getByTestId('keymap-from')).toHaveTextContent(/gone/)
    await user.type(screen.getByTestId('keymap-save-name'), 'mine2')
    expect(screen.getByTestId('keymap-save-as')).toBeDisabled()
    expect(screen.getByTestId('keymap-blocked')).toHaveTextContent(t.cannot_save_fallback())
    expect(world.writes).toEqual([])
  })

  it('refuses a shortcut it cannot read, at the field, keeping the default', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys()

    await user.clear(input('nav.back'))
    await user.type(input('nav.back'), 'Hyper+K{Enter}')

    await waitFor(() => expect(input('nav.back')).toHaveAttribute('aria-invalid', 'true'))
    expect(input('nav.back')).toHaveAccessibleDescription(
      expect.stringContaining(t.invalid({ example: 'Mod+Shift+P' }))
    )
    expect(shown('nav.back')).toBe('Ctrl+[')
    expect(world.registry.effectiveKeys('nav.back')).toBe('Mod+[')
    expect(screen.queryByTestId('keymap-dirty')).toBeNull()
  })

  it('takes several chords separated by a comma', async () => {
    const user = userEvent.setup()
    await openHotkeys()

    await user.clear(input('group.new'))
    await user.type(input('group.new'), 'Mod+Shift+g, Alt+g{Enter}')

    await waitFor(() => expect(shown('group.new')).toBe('Ctrl+Shift+G, Alt+G'))
  })

  it('records a chord pressed into the field, and runs no command while it does', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys()
    const registry = world.registry

    await user.click(screen.getByTestId('hotkey-record:group.new'))
    await waitFor(() => expect(input('group.new')).toHaveFocus())
    // Suspended: the chord being recorded must not also run what it is bound to.
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })).toBeNull()

    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}')

    await waitFor(() => expect(shown('group.new')).toBe('Ctrl+Shift+G'))
    expect(registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe('tab.close')
  })

  it('leaves the recording with Escape, changing nothing', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys()

    await user.click(screen.getByTestId('hotkey-record:tab.close'))
    await waitFor(() => expect(input('tab.close')).toHaveFocus())
    await user.keyboard('{Escape}')

    expect(shown('tab.close')).toBe('Ctrl+W')
    expect(screen.queryByTestId('keymap-dirty')).toBeNull()
    expect(world.registry.match({ key: 'w', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })?.id).toBe(
      'tab.close'
    )
  })
})

describe('Settings > Appearance > Fonts (round 3 Q7)', () => {
  it('offers no font pickers: the faces come from the theme, and nothing is set inline', async () => {
    document.documentElement.removeAttribute('style')
    render(SettingsPanel, { onClose: vi.fn(), registry: registryWith(), initialTab: 'appearance' })
    await screen.findByText(LL.web.settings.appearance.theme())
    expect(screen.queryByTestId('font-pickers')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Notes' })).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--ed-font-prose')).toBe('')
  })
})

describe('Settings > Layout is live, and the close guard (round 3, Q6)', () => {
  /** The shell layout's override surface, as `createShellLayout` exposes it. */
  function liveLayout() {
    let overrides: LayoutFile = NO_OVERRIDES
    const layout = {
      fileSpec: PRESETS.default as ShellSpec,
      get ownSpec(): ShellSpec {
        return applyOverrides(PRESETS.default, overrides)
      },
      get overrides(): LayoutFile {
        return overrides
      },
      setOverrides: vi.fn((next: LayoutFile) => {
        overrides = next
      }),
      resetOverrides: vi.fn(() => {
        overrides = NO_OVERRIDES
      }),
    }
    return layout
  }

  it('a layout change applies at once and leaves nothing to guard: Escape closes without asking', async () => {
    const user = userEvent.setup()
    const world = keymapWorld({ registry: registryWith(), vault: {}, active: 'default' })
    const layout = liveLayout()
    const onClose = vi.fn()
    render(SettingsPanel, {
      onClose,
      registry: world.registry,
      resources: world.resources,
      layout,
      readAppFile: (p: string) => world.vault!.readAppFile(p),
      initialTab: 'layout',
    })
    await screen.findByTestId('settings-layout')
    await user.selectOptions(screen.getByTestId('layout-field:toolbar'), 'bottom')
    expect(layout.setOverrides).toHaveBeenCalledWith({ $schema: LAYOUT_SCHEMA_ID, toolbar: { position: 'bottom' } })

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('settings-unsaved')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Save and close saves what it can and sends you to the tab that still needs you (the tab really changes)', async () => {
    const user = userEvent.setup()
    const world = await openHotkeys()
    // A hotkey edit on the read-only built-in: only Save as, with a name, can keep it.
    await user.clear(input('nav.back'))
    await user.tab()
    await waitFor(() => expect(shown('nav.back')).toBe(t.unbound()))
    // …and a General edit, which Save and close can save.
    await user.click(screen.getByTestId('settings-tab:general'))
    await user.clear(screen.getByTestId('settings-name'))
    await user.type(screen.getByTestId('settings-name'), 'Chris B')

    await user.keyboard('{Escape}')
    expect(await screen.findByTestId('settings-unsaved')).toBeVisible()
    await user.click(screen.getByTestId('settings-save-all'))

    // The name is saved; the hotkeys tab is on screen, asking for its name.
    await waitFor(() => expect(localStorage.getItem('editor:user')).toBe('Chris B'))
    expect(await screen.findByTestId('settings-hotkeys')).toBeVisible()
    expect(screen.getByTestId('settings-tab:hotkeys')).toHaveAttribute('aria-selected', 'true')
    expect(world.registry.effectiveKeys('nav.back')).toBe('Mod+[')
  })
})
