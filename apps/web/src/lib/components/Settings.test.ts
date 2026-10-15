// @vitest-environment jsdom
/**
 * Settings, host-neutral (settings-shaping ST1/ST2): the grouped nav, one
 * save model (no Save, no close guard), the sections that need a vault, and
 * — as before — Appearance's fonts (none to pick since round 3, Q7) and Sync & devices
 * (first-run D1/D2). Keys has its own file (`HotkeySettings.test.ts`).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { CommandRegistry } from '../commands.js'
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
  it('lists the nine sections in three groups, in order (Customise and its parts first); picking one asks the host to move', async () => {
    const user = userEvent.setup()
    const onSection = vi.fn()
    render(Settings, { section: 'customise', onSection, vault: VAULT, registry: registryWith() })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('data-testid'))).toEqual(SETTINGS_SECTIONS.map((s) => `settings-tab:${s}`))
    expect(tabs.map((tab) => tab.textContent!.trim())).toEqual([
      'Customise', 'Editor', 'Layout', 'Appearance', 'Keys', 'Sync & devices', 'AI', 'Developer', 'About',
    ])
    // A gap starts the second and third groups (drawn by the tab itself: the list holds tabs only);
    // Customise's four parts sit under it.
    const starts = tabs.filter((tab) => tab.hasAttribute('data-group-start')).map((tab) => tab.dataset.testid)
    expect(starts).toEqual(['settings-tab:sync', 'settings-tab:developer'])
    const parts = tabs.filter((tab) => tab.dataset.depth === '1').map((tab) => tab.dataset.testid)
    expect(parts).toEqual(['settings-tab:editor', 'settings-tab:layout', 'settings-tab:appearance', 'settings-tab:keys'])

    await user.click(screen.getByTestId('settings-tab:about'))
    expect(onSection).toHaveBeenCalledWith('about')
  })

  it('the nav is one tablist: one tab stop, arrows move and select, Home/End; every tab named, with a tooltip for the rail', async () => {
    const user = userEvent.setup()
    const onSection = vi.fn()
    const view = render(Settings, { section: 'customise', onSection, vault: VAULT, registry: registryWith() })
    const list = screen.getByRole('tablist', { name: LL.web.settings.sections() })
    const tabs = screen.getAllByRole('tab')
    // One tab stop: the active tab.
    expect(tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.dataset.testid)).toEqual(['settings-tab:customise'])
    // The panel names its tab, and the active tab controls the panel.
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id)
    expect(tabs[0]).toHaveAttribute('aria-controls', panel.id)
    // Every tab has its name (the rail draws only the glyph, so the name never rides on the visible text alone).
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-label', tab.textContent!.trim())

    await user.tab()
    expect(tabs[0]).toHaveFocus()
    // Its name as a tooltip on keyboard focus (CSS hides it while the labels show).
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(LL.web.settings.nav.customise())
    // Drawn in the nav, outside the tablist (which may hold tabs only — axe's aria-required-children).
    await waitFor(() => expect(list.contains(tip)).toBe(false))
    expect(list.closest('nav')!.contains(tip)).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(onSection).toHaveBeenLastCalledWith('editor')
    expect(tabs[1]).toHaveFocus()
    // The host moves; the active tab and the tab stop follow.
    await view.rerender({ section: 'editor', onSection, vault: VAULT, registry: registryWith() })
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]!.tabIndex).toBe(0)
    await user.keyboard('{End}')
    expect(onSection).toHaveBeenLastCalledWith('about')
    await user.keyboard('{Home}')
    expect(onSection).toHaveBeenLastCalledWith('customise')
    await user.keyboard('{ArrowUp}')
    expect(onSection).toHaveBeenLastCalledWith('about')
    expect(list).toBeInTheDocument()
  })

  it('follows the host: a new section prop shows that section', async () => {
    const view = render(Settings, { section: 'sync', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(screen.getByTestId('settings-section:sync')).toBeVisible()
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

  it('Customise renders with a vault open; AI holds the outside agents (Agents folded into AI)', async () => {
    const view = render(Settings, { section: 'customise', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(screen.getByTestId('settings-customise')).toHaveTextContent(LL.web.settings.customise.intro())
    await view.rerender({ section: 'ai', onSection: vi.fn(), vault: VAULT, registry: registryWith() })
    expect(await screen.findByTestId('settings-agents')).toHaveTextContent(LL.web.settings.agents.intro())
  })
})

describe('Settings: one save model (R3) — no Save buttons, nothing to guard', () => {
  it('has no Save button in any section, Keys included (ST3: it writes through)', async () => {
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
    const view = render(Settings, { ...props, section: 'customise' })
    for (const section of SETTINGS_SECTIONS) {
      await view.rerender({ ...props, section })
      await screen.findByTestId(`settings-section:${section}`)
      expect(screen.queryByRole('button', { name: /\bSave\b/ }), section).toBeNull()
    }
  })

  it('the name (Sync & devices’ first row) commits on leaving the field, and an empty one is refused inline', async () => {
    const user = userEvent.setup()
    const onConfigChange = vi.fn()
    render(Settings, { section: 'sync', onSection: vi.fn(), vault: VAULT, registry: registryWith(), onConfigChange, pinnedHost: '', teamRelay: '' })
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
    expect(screen.getByTestId('field-errors:name')).toHaveTextContent(LL.web.settings.sync.name_required())
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
    // Typed, not committed (the address commits on Enter or when left — R3).
    for (const typed of ['wss://other.example/relay', 'ws://plain.example/relay', 'wss://ohhi.exmaple.ts.net/relay']) {
      await user.clear(relayField)
      await user.type(relayField, typed)
      // The card follows what is typed; the secret check does not.
      await waitFor(() => expect(screen.getByTestId('relay-card')).toHaveTextContent(new URL(typed).host))
      expect(screen.getByTestId('settings-secret-check')).toHaveAttribute('data-check', 'idle')
    }
    for (const [relay] of verify.mock.calls as unknown as [string, string][]) expect(relay).toBe(RELAY)
  })

  it('a pinned build ignores a relay saved before the pin, and says so once', async () => {
    const { setDefaultRelay } = await import('../config.js')
    setDefaultRelay('wss://old.example/relay')
    const { props } = await openSync({ pinnedHost: 'ohhi.example.ts.net', teamRelay: RELAY })
    // The read-only field and the card are on the pinned relay, not the saved one.
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
