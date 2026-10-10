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

describe('Settings > Sync (first-run D1/D2, R10)', () => {
  const sync = LL.web.settings.sync
  const card = LL.web.relay_card
  const RELAY = 'wss://ohhi.example.ts.net/relay'

  /** Short waits (debounces) on the next microtask; long ones (the tick) never. */
  const clock = {
    now: () => 1_000_000,
    schedule: (fn: () => void, ms: number) => {
      let live = true
      if (ms <= 500) queueMicrotask(() => live && fn())
      return () => {
        live = false
      }
    },
  }

  async function openSync(over: Record<string, unknown> = {}) {
    const props = {
      onClose: vi.fn(),
      registry: registryWith(),
      initialTab: 'sync' as const,
      onLinkDevice: vi.fn(),
      clock,
      probe: vi.fn(async () => ({ ok: true as const })),
      verify: vi.fn(async () => 'ok' as const),
      pinnedHost: '',
      teamRelay: '',
      networkNote: '',
      secretHint: '',
      ...over,
    }
    render(SettingsPanel, props)
    await screen.findByTestId('settings-relay-card')
    return { props, user: userEvent.setup() }
  }

  const secretField = (): HTMLElement => screen.getByLabelText(card.secret.title(), { exact: false })

  it('nothing known: the card says none and the address field is open', async () => {
    await openSync()
    expect(screen.getByTestId('relay-card')).toHaveAttribute('data-state', 'none')
    expect(screen.getByTestId('settings-relay')).toBeVisible()
    expect(screen.getByTestId('settings-own-relay')).toHaveTextContent(sync.running_body())
  })

  it('a saved relay: probed, with Test; Change… reveals the address field', async () => {
    const { setDefaultRelay } = await import('../config.js')
    setDefaultRelay(RELAY)
    const { props, user } = await openSync()
    const relay = screen.getByTestId('relay-card')
    await waitFor(() => expect(relay).toHaveAttribute('data-state', 'reachable'))
    expect(props.probe).toHaveBeenCalledWith(RELAY)
    expect(screen.queryByTestId('settings-relay')).toBeNull()
    await user.click(screen.getByRole('button', { name: card.test() }))
    await waitFor(() => expect(props.probe).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: card.change() }))
    expect(screen.getByTestId('settings-relay')).toHaveValue(RELAY)
  })

  it('connected when the vault holds rooms on it: the snapshot’s words', async () => {
    const { setDefaultRelay } = await import('../config.js')
    setDefaultRelay(RELAY)
    const { props } = await openSync({
      relays: [{ host: 'ohhi.example.ts.net', state: 'connected', rooms: 3, people: 0, inSyncSince: 1_000_000 }],
    })
    const relay = screen.getByTestId('relay-card')
    expect(relay).toHaveAttribute('data-state', 'connected')
    expect(relay).toHaveTextContent(LL.web.shared.relay.rooms({ count: 3 }))
    expect(relay.textContent).not.toMatch(/durable/i)
    expect(props.probe).not.toHaveBeenCalled()
  })

  it('the secret answers: works, doesn’t match, no admin API, can’t reach', async () => {
    const answers = { right: 'ok', wrong: 'bad_secret', plain: 'no_admin', far: 'unreachable' } as const
    const verify = vi.fn(async (_relay: string, s: string) => answers[s as keyof typeof answers])
    const { user } = await openSync({ verify })
    expect(secretField()).toHaveAccessibleDescription(expect.stringContaining(card.secret.description()))
    const check = (): HTMLElement => screen.getByTestId('settings-secret-check')
    for (const [secret, key] of Object.entries(answers)) {
      await user.clear(secretField())
      await user.type(secretField(), secret)
      await waitFor(() => expect(check()).toHaveTextContent(card.secret[key]()))
    }
    expect(screen.getByText(card.secret.where())).toBeVisible()
  })

  it('a pinned build: the address read-only, no Change…, one host only — the guide section says so too', async () => {
    await openSync({ pinnedHost: 'ohhi.example.ts.net' })
    const relay = screen.getByTestId('relay-card')
    expect(relay).toHaveTextContent(card.pinned({ host: 'ohhi.example.ts.net' }))
    expect(screen.queryByRole('button', { name: card.change() })).toBeNull()
    expect(screen.getByTestId('settings-relay')).toHaveAttribute('readonly')
    expect(screen.getByTestId('settings-relay')).toHaveAccessibleDescription(sync.relay_pinned_hint())
    const own = screen.getByTestId('settings-own-relay')
    expect(own).toHaveTextContent(sync.running_pinned({ host: 'ohhi.example.ts.net' }))
    expect(own).not.toHaveTextContent(card.change())
  })

  it('the SAVED secret is only ever checked against the SAVED relay — never a relay merely typed', async () => {
    const { setDefaultRelay, setOperatorSecret } = await import('../config.js')
    setDefaultRelay(RELAY)
    setOperatorSecret('team-secret')
    const verify = vi.fn(async () => 'ok' as const)
    const { user } = await openSync({ verify })
    // Opened with a secret saved: checked against the saved relay.
    await waitFor(() => expect(verify).toHaveBeenCalledWith(RELAY, 'team-secret'))
    await waitFor(() => expect(screen.getByTestId('settings-secret-check')).toHaveAttribute('data-check', 'ok'))

    await user.click(screen.getByRole('button', { name: card.change() }))
    const relayField = screen.getByTestId('settings-relay')
    for (const typed of ['wss://other.example/relay', 'ws://plain.example/relay', 'wss://ohhi.exmaple.ts.net/relay']) {
      await user.clear(relayField)
      await user.type(relayField, typed)
      await user.tab() // blur the secret path too
      // The card follows what is typed; the secret check does not.
      await waitFor(() => expect(screen.getByTestId('relay-card')).toHaveTextContent(new URL(typed).host))
      expect(screen.getByTestId('settings-secret-check')).toHaveAttribute('data-check', 'idle')
    }
    for (const [relay] of verify.mock.calls as unknown as [string, string][]) expect(relay).toBe(RELAY)

    // A secret typed AFTER the edit is for that relay, and is checked there.
    await user.clear(secretField())
    await user.type(secretField(), 'their-secret')
    await waitFor(() => expect(verify).toHaveBeenLastCalledWith('wss://ohhi.exmaple.ts.net/relay', 'their-secret'))

    // Editing the relay again drops it: that secret was typed for the old address.
    await user.clear(relayField)
    await user.type(relayField, 'wss://elsewhere.example/relay')
    await waitFor(() => expect(screen.getByTestId('settings-secret-check')).toHaveAttribute('data-check', 'idle'))
    expect(verify).not.toHaveBeenCalledWith('wss://elsewhere.example/relay', expect.anything())
    // Across everything: the saved secret went to the saved relay only.
    for (const [relay, secret] of verify.mock.calls as unknown as [string, string][]) {
      if (secret === 'team-secret') expect(relay).toBe(RELAY)
    }
  })

  it('a pinned build ignores a relay saved before the pin, and says so once', async () => {
    const { setDefaultRelay } = await import('../config.js')
    setDefaultRelay('wss://old.example/relay')
    const { props } = await openSync({ pinnedHost: 'ohhi.example.ts.net', teamRelay: RELAY })
    // The read-only field and the card are on the pinned relay, not the saved one
    // (the test build has no VITE_DEFAULT_RELAY, so the build's relay is the fallback).
    expect(screen.getByTestId('settings-relay')).not.toHaveValue('wss://old.example/relay')
    await waitFor(() => expect(props.probe).toHaveBeenCalled())
    expect(props.probe).not.toHaveBeenCalledWith('wss://old.example/relay')
    expect(screen.getByTestId('settings-relay-ignored')).toHaveTextContent(
      sync.relay_pinned_saved_ignored({ saved: 'wss://old.example/relay', host: 'ohhi.example.ts.net' })
    )
    cleanup()
    // A saved relay ON the pinned host is used, and nothing is said.
    setDefaultRelay(RELAY)
    await openSync({ pinnedHost: 'ohhi.example.ts.net', teamRelay: RELAY })
    expect(screen.getByTestId('settings-relay')).toHaveValue(RELAY)
    expect(screen.queryByTestId('settings-relay-ignored')).toBeNull()
  })

  it('the relay guide is a real link (the e2e reads its href)', async () => {
    await openSync()
    expect(screen.getByTestId('settings-relay-guide')).toHaveAttribute('href', '/guide/relay.html')
  })

  it('Your devices: without a secret, what is missing and where it lives', async () => {
    await openSync()
    expect(screen.getByTestId('settings-device-link')).toHaveTextContent(sync.devices())
    expect(screen.getByTestId('settings-link-device-needs-secret')).toHaveTextContent(LL.web.device_link.needs_secret())
    expect(screen.getByTestId('settings-link-device-where-body')).toHaveTextContent(card.secret.where_generic())
  })
})
