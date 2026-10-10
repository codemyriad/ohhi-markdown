// @vitest-environment jsdom
/**
 * Settings, host-neutral (settings-shaping ST1/ST2): the grouped nav, one
 * save model (no Save, no close guard), the sections that need a vault, and
 * — as before — Keys (tab-groups R1.3, quiet-shell F10), Appearance's fonts
 * (none to pick since round 3, Q7) and Sync & devices (first-run D1/D2).
 *
 * Keys is a VIEW of the shell's command registry under the ACTIVE keymap
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
import { box } from '../shell-actions.fixture.svelte.js'
import Settings from './Settings.svelte'
import { SETTINGS_SECTIONS } from '../settings.js'

const VAULT = { name: 'black book', kind: 'tauri' as const, path: '/home/me/black book' }

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

/** Render Settings straight onto Keys, over a vault holding `files`. */
async function openHotkeys(opts: { files?: Record<string, unknown>; active?: 'default' | `custom:${string}` } = {}) {
  const world = keymapWorld({ registry: registryWith(), vault: opts.files ?? {}, active: opts.active ?? 'default' })
  await world.keymap.reload()
  render(Settings, {
    section: 'keys',
    onSection: vi.fn(),
    vault: VAULT,
    registry: world.registry,
    keymap: world.keymap,
    resources: world.resources,
    readAppFile: (p: string) => world.vault!.readAppFile(p),
  })
  await screen.findByTestId('settings-hotkeys')
  return world
}

const input = (id: string): HTMLInputElement => screen.getByTestId(`hotkey-input:${id}`)
const shown = (id: string): string => screen.getByTestId(`hotkey-binding:${id}`).textContent!.trim()
const written = (world: ReturnType<typeof keymapWorld>, name: string): unknown =>
  JSON.parse(world.disk!.get(`.ohhi/keymaps/${name}.json`)!)

describe('Settings › Keys', () => {
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

describe('Settings › Appearance › Fonts (round 3 Q7)', () => {
  it('offers no font pickers: the faces come from the theme, and nothing is set inline', async () => {
    document.documentElement.removeAttribute('style')
    render(Settings, { section: 'appearance', onSection: vi.fn(), vault: null, registry: registryWith() })
    await screen.findByText(LL.web.settings.appearance.theme())
    expect(screen.queryByTestId('font-pickers')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Notes' })).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--ed-font-prose')).toBe('')
  })
})

/** The shell layout's override surface, as `createShellLayout` exposes it. */
function liveLayout() {
  const overrides = box<LayoutFile>(NO_OVERRIDES)
  return {
    fileSpec: PRESETS.default as ShellSpec,
    get ownSpec(): ShellSpec {
      return applyOverrides(PRESETS.default, overrides.value)
    },
    get overrides(): LayoutFile {
      return overrides.value
    },
    setOverrides: vi.fn((next: LayoutFile) => {
      overrides.value = next
    }),
    resetOverrides: vi.fn(() => {
      overrides.value = NO_OVERRIDES
    }),
  }
}

describe('Settings: the nav and its hosts (ST1/ST2)', () => {
  it('lists the ten sections in three groups, in order; picking one asks the host to move', async () => {
    const user = userEvent.setup()
    const onSection = vi.fn()
    render(Settings, { section: 'you', onSection, vault: VAULT, registry: registryWith() })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('data-testid'))).toEqual(SETTINGS_SECTIONS.map((s) => `settings-tab:${s}`))
    expect(tabs.map((tab) => tab.textContent!.trim())).toEqual([
      'You', 'Editor', 'Layout', 'Appearance', 'Keys', 'Sync & devices', 'Customise', 'Agents', 'Developer', 'About',
    ])
    // A rule starts the second and third groups (drawn by the tab itself: the list holds tabs only).
    const separated = tabs.filter((tab) => tab.className.includes('before:border-t')).map((tab) => tab.dataset.testid)
    expect(separated).toEqual(['settings-tab:sync', 'settings-tab:developer'])

    await user.click(screen.getByTestId('settings-tab:about'))
    expect(onSection).toHaveBeenCalledWith('about')
  })

  it('follows the host: a new section prop shows that section', async () => {
    const view = render(Settings, { section: 'you', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(screen.getByTestId('settings-section:you')).toBeVisible()
    await view.rerender({ section: 'developer', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(await screen.findByTestId('settings-section:developer')).toBeVisible()
    expect(screen.getByTestId('settings-tab:developer')).toHaveAttribute('aria-selected', 'true')
  })

  it('no vault open: Keys and Customise say so (with the way to one) instead of hiding; Layout says where its file comes from', async () => {
    const onManageVaults = vi.fn()
    const user = userEvent.setup()
    const view = render(Settings, {
      section: 'keys',
      onSection: vi.fn(),
      vault: null,
      registry: registryWith(),
      layout: liveLayout(),
      onManageVaults,
    })
    expect(screen.getByTestId('settings-needs-vault:keys')).toHaveTextContent(LL.web.settings.needs_vault.body())
    expect(screen.queryByTestId('settings-hotkeys')).toBeNull()
    await user.click(screen.getByTestId('settings-needs-vault-open'))
    expect(onManageVaults).toHaveBeenCalledOnce()

    await view.rerender({ section: 'customise', onSection: vi.fn(), vault: null, registry: registryWith(), layout: liveLayout() })
    expect(await screen.findByTestId('settings-needs-vault:customise')).toBeVisible()

    await view.rerender({ section: 'layout', onSection: vi.fn(), vault: null, registry: registryWith(), layout: liveLayout() })
    expect(await screen.findByTestId('settings-layout-no-vault')).toHaveTextContent(LL.web.settings.layout.no_vault())
    expect(screen.getByTestId('settings-layout')).toBeVisible()
  })

  it('the Customise and Agents placeholders render with a vault open', async () => {
    const view = render(Settings, { section: 'customise', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(screen.getByTestId('settings-customise')).toHaveTextContent(LL.web.settings.customise.intro())
    await view.rerender({ section: 'agents', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(await screen.findByTestId('settings-agents')).toHaveTextContent(LL.web.settings.agents.intro())
  })
})

describe('Settings: one save model (R3) — no Save buttons, nothing to guard', () => {
  it('has no Save button in any section but Keys (ST3 makes Keys write through)', async () => {
    const world = keymapWorld({ registry: registryWith(), vault: {}, active: 'default' })
    await world.keymap.reload()
    const props = {
      onSection: vi.fn(),
      vault: VAULT,
      registry: world.registry,
      layout: liveLayout(),
      keymap: world.keymap,
      resources: world.resources,
      readAppFile: (p: string) => world.vault!.readAppFile(p),
      onLinkDevice: vi.fn(),
      probe: vi.fn(async () => ({ ok: true as const })),
      verify: vi.fn(async () => 'ok' as const),
      pinnedHost: '',
      teamRelay: '',
    }
    const view = render(Settings, { ...props, section: 'you' })
    for (const section of SETTINGS_SECTIONS.filter((s) => s !== 'keys')) {
      await view.rerender({ ...props, section })
      await screen.findByTestId(`settings-section:${section}`)
      expect(screen.queryByRole('button', { name: /^Save$/ }), section).toBeNull()
    }
  })

  it('the name commits on leaving the field, and an empty one is refused inline', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    render(Settings, { section: 'you', onSection: vi.fn(), vault: VAULT, registry: registryWith(), onConfigChange })
    const field = screen.getByTestId('settings-name')
    await user.type(field, 'Chris B')
    expect(localStorage.getItem('editor:user')).toBeNull()
    await user.tab()
    expect(localStorage.getItem('editor:user')).toBe('Chris B')
    expect(screen.getByTestId('settings-name-status')).toHaveTextContent(LL.web.settings.saved())
    expect(onConfigChange).toHaveBeenCalledOnce()

    await user.clear(field)
    await user.keyboard('{Enter}')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('field-errors:name')).toHaveTextContent(LL.web.settings.you.name_required())
    expect(localStorage.getItem('editor:user')).toBe('Chris B')
  })

  it('a layout change applies at once; Editor holds the editor options, each part resets only its own', async () => {
    const user = userEvent.setup()
    const layout = liveLayout()
    const view = render(Settings, { section: 'layout', onSection: vi.fn(), vault: VAULT, registry: registryWith(), layout })
    await user.selectOptions(screen.getByTestId('layout-field:toolbar'), 'bottom')
    expect(layout.setOverrides).toHaveBeenLastCalledWith({ $schema: LAYOUT_SCHEMA_ID, toolbar: { position: 'bottom' } })
    // The editor's fields moved to Editor.
    expect(screen.queryByTestId('layout-field:measure')).toBeNull()

    await view.rerender({ section: 'editor', onSection: vi.fn(), vault: VAULT, registry: registryWith(), layout })
    await screen.findByTestId('settings-editor-layout')
    expect(screen.getByTestId('default-mode')).toBeVisible()
    expect(screen.queryByTestId('layout-field:toolbar')).toBeNull()
    await user.selectOptions(screen.getByTestId('layout-field:measure'), 'wide')
    expect(layout.overrides).toMatchObject({ toolbar: { position: 'bottom' }, editor: { measure: 'wide' } })

    // Editor's reset puts back the editor's fields and keeps the toolbar's.
    await user.click(screen.getByTestId('layout-reset-editor'))
    expect(layout.overrides).toEqual({ $schema: LAYOUT_SCHEMA_ID, toolbar: { position: 'bottom' } })
    expect(screen.getByTestId('layout-reset-editor')).toBeDisabled()
  })

  it('About: the version line is the updater’s honest outcome; no Check now; the guides and the report', async () => {
    const { help } = await import('../help.svelte.js')
    help.version = '1.4.0'
    help.update = { kind: 'current', checkedAt: 1_000_000 }
    const clock = { now: () => 1_000_000 + 2 * 3_600_000, schedule: () => () => {} }
    render(Settings, { section: 'about', onSection: vi.fn(), vault: null, registry: registryWith(), desktop: true, clock })
    expect(screen.getByTestId('settings-version')).toHaveTextContent(
      LL.web.help.version.current({ version: '1.4.0', when: LL.web.relative_time.hours({ count: 2 }) })
    )
    expect(screen.queryByRole('button', { name: /check now/i })).toBeNull()
    expect(screen.getByTestId('settings-guide:changes')).toHaveTextContent(LL.web.help.menu.changes({ version: '1.4.0' }))
    expect(screen.getByTestId('settings-report')).toBeVisible()
    help.version = null
    help.update = { kind: 'unchecked' }
  })
})

describe('Settings › Sync & devices (first-run D1/D2, R10)', () => {
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
      section: 'sync' as const,
      onSection: vi.fn(),
      vault: VAULT,
      registry: registryWith(),
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
    render(Settings, props)
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

  it('Your devices: without a secret, what is missing and where it lives', async () => {
    await openSync()
    expect(screen.getByTestId('settings-device-link')).toHaveTextContent(sync.devices())
    expect(screen.getByTestId('settings-link-device-needs-secret')).toHaveTextContent(LL.web.device_link.needs_secret())
    expect(screen.getByTestId('settings-link-device-where-body')).toHaveTextContent(card.secret.where_generic())
  })

  it('the relay address commits on Enter, validated inline; a bad one is never stored', async () => {
    const { defaultRelay } = await import('../config.js')
    const onConfigChange = vi.fn()
    const { user } = await openSync({ onConfigChange })
    const field = screen.getByTestId('settings-relay')
    await user.clear(field)
    await user.type(field, 'http://nope{Enter}')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('field-errors:relay')).toHaveTextContent(sync.relay_invalid())
    await user.clear(field)
    await user.type(field, `${RELAY}{Enter}`)
    expect(defaultRelay()).toBe(RELAY)
    expect(onConfigChange).toHaveBeenCalledOnce()
    expect(field).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('the secret commits when the field is left; Link a device… opens with it saved', async () => {
    const { operatorSecret } = await import('../config.js')
    const { props, user } = await openSync()
    await user.type(secretField(), 's3cret')
    expect(operatorSecret()).toBe('')
    await user.click(screen.getByTestId('settings-link-device'))
    expect(operatorSecret()).toBe('s3cret')
    expect(props.onLinkDevice).toHaveBeenCalledOnce()
  })

  it('vaults and shares live in the manager now: one door to it; a browser shows its storage here', async () => {
    const onManageVaults = vi.fn()
    const { user } = await openSync({ onManageVaults, desktop: false })
    expect(screen.getByTestId('settings-vaults')).toHaveTextContent(sync.vaults_body())
    await user.click(screen.getByTestId('settings-manage-vaults'))
    expect(onManageVaults).toHaveBeenCalledOnce()
    expect(screen.getByTestId('settings-storage')).toBeVisible()
  })

  it('the desktop keeps real files: no browser-storage section', async () => {
    await openSync({ desktop: true })
    expect(screen.queryByTestId('settings-storage')).toBeNull()
  })
})
