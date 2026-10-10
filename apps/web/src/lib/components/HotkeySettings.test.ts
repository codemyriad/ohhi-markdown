// @vitest-environment jsdom
/**
 * Settings › Keys, K1 (settings-shaping ST3). Keys is a VIEW of the shell's
 * command registry under the ACTIVE keymap file, so the test builds a
 * registry, the real resource loader over a fake vault and the real keymap,
 * the way App.svelte does, renders Settings onto Keys, and asserts what the
 * user can see and do: chips as the control, the default only on a changed
 * row, write-through (the first change to a read-only keymap creating
 * `mine.json`), Undo, recording that runs nothing and cancels on Escape,
 * search by text and by pressed keys, the filter chips and the groups.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { CommandRegistry } from '../commands.js'
import { KEYMAP_SCHEMA_ID, type KeymapChoice } from '../keymap-spec.js'
import { keymapWorld } from '../keymap.fixture.js'
import Settings from './Settings.svelte'

const VAULT = { name: 'black book', kind: 'tauri' as const, path: '/home/me/black book' }
const LL = getLL()
const t = LL.web.settings.keys

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
beforeEach(() => localStorage.clear())

/** Two bound commands, one unbound, and a pair that will clash. */
function registryWith(): CommandRegistry {
  const registry = new CommandRegistry(false)
  registry.register(
    { id: 'nav.back', title: 'Back', group: 'Navigate', keys: 'Mod+[', run: () => {} },
    { id: 'tab.close', title: 'Close tab', group: 'Tab', keys: 'Mod+w', run: () => {} },
    { id: 'group.new', title: 'New group', group: 'Group', run: () => {} },
    { id: 'view.toggle-reading', title: 'Toggle reading view', group: 'View', keys: 'Mod+e', run: () => {} },
    { id: 'view.toggle-source', title: 'Toggle source view', group: 'View', keys: 'Mod+Shift+e', run: () => {} }
  )
  return registry
}

const mine = { $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings: {} }

async function openKeys(opts: { files?: Record<string, unknown>; active?: KeymapChoice } = {}) {
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

const chips = (id: string): string[] =>
  within(screen.getByTestId(`hotkey-binding:${id}`))
    .queryAllByTestId(new RegExp(`^hotkey-chip:${id.replace('.', '\\.')}:`))
    .map((b) => b.textContent!.trim())
const written = (world: ReturnType<typeof keymapWorld>, name: string): unknown => {
  const text = world.disk!.get(`.ohhi/keymaps/${name}.json`)
  return text === undefined ? undefined : JSON.parse(text)
}
const ctrl = (key: string, more: { shiftKey?: boolean } = {}) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  shiftKey: more.shiftKey ?? false,
  altKey: false,
})

describe('Settings › Keys: rows', () => {
  it('one row per command: its chips, nothing repeated on an unchanged row, and where the keymap lives', async () => {
    await openKeys()
    for (const group of ['Navigate', 'Tab', 'Group', 'View']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${group}`) })).toHaveAttribute('aria-expanded', 'true')
    }
    expect(chips('nav.back')).toEqual(['Ctrl+['])
    // An unchanged row shows no default and no Reset.
    expect(screen.queryByTestId('hotkey-default:nav.back')).toBeNull()
    expect(screen.queryByTestId('hotkey-reset:nav.back')).toBeNull()
    expect(screen.getByTestId('hotkey-unbound:group.new')).toHaveTextContent(t.unbound())
    expect(screen.getByTestId('hotkey-chip:nav.back:0')).toHaveAccessibleName(
      t.change_chip({ binding: 'Ctrl+[', command: 'Back' })
    )
    expect(screen.getByTestId('keymap-source-name')).toHaveTextContent('default')
    expect(screen.getByTestId('keymap-from')).toHaveTextContent(t.read_only_hint())
    // No draft, nothing to save.
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
  })

  it('a group collapses and opens again', async () => {
    const user = userEvent.setup()
    await openKeys()
    const toggle = screen.getByTestId('hotkey-group-toggle:Tab')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('hotkey-row:tab.close')).toBeNull()
    await user.click(toggle)
    expect(screen.getByTestId('hotkey-row:tab.close')).toBeVisible()
  })
})

describe('Settings › Keys: write-through (Fork 2)', () => {
  it('the first change to the built-in creates mine.json extending it, uses it, and says so once; Undo walks back', async () => {
    const user = userEvent.setup()
    const world = await openKeys()

    await user.click(screen.getByTestId('hotkey-chip:tab.close:0'))
    await waitFor(() => expect(screen.getByTestId('hotkey-recorder:tab.close')).toHaveFocus())
    await user.keyboard('{Control>}{Shift>}w{/Shift}{/Control}')

    await waitFor(() => expect(world.config.active).toBe('custom:mine'))
    expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'tab.close': 'Mod+Shift+w' } })
    expect(world.registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')
    await waitFor(() => expect(chips('tab.close')).toEqual(['Ctrl+Shift+W']))
    expect(screen.getByTestId('keymap-saved')).toHaveTextContent(t.created({ path: '.ohhi/keymaps/mine.json' }))
    // Changed: now the row shows its default, with a Reset.
    expect(screen.getByTestId('hotkey-default:tab.close')).toHaveTextContent(t.default_is({ binding: 'Ctrl+W' }))
    expect(screen.getByTestId('keymap-source')).toHaveTextContent('.ohhi/keymaps/mine.json')
    expect(screen.getByTestId('keymap-from')).toHaveTextContent(t.extends({ name: 'default' }))
    expect(screen.getByTestId('keymap-from')).not.toHaveTextContent(t.read_only_hint())

    // A second change writes the same file, and only says where.
    await user.click(screen.getByTestId('hotkey-remove:nav.back:0'))
    await waitFor(() =>
      expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'nav.back': [], 'tab.close': 'Mod+Shift+w' } })
    )
    await waitFor(() => expect(screen.getByTestId('keymap-saved')).toHaveTextContent(t.saved({ path: '.ohhi/keymaps/mine.json' })))

    // Undo puts back the bytes the second write replaced…
    await user.click(screen.getByTestId('keymap-undo'))
    await waitFor(() => expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'tab.close': 'Mod+Shift+w' } }))
    await waitFor(() => expect(chips('nav.back')).toEqual(['Ctrl+[']))
    expect(screen.getByTestId('keymap-saved')).toHaveTextContent(t.undone())
    // …and then removes the file the first created, with the built-in active again.
    await user.click(screen.getByTestId('keymap-undo'))
    await waitFor(() => expect(world.config.active).toBe('default'))
    expect(written(world, 'mine')).toBeUndefined()
    expect(world.writes.at(-1)).toBe('-.ohhi/keymaps/mine.json')
    expect(world.registry.effectiveKeys('tab.close')).toBe('Mod+w')
    await waitFor(() => expect(screen.queryByTestId('keymap-undo')).toBeNull())
  })

  it('writes the active vault file in place, extends kept; Reset puts the default back', async () => {
    const user = userEvent.setup()
    const world = await openKeys({ files: { '.ohhi/keymaps/mine.json': mine }, active: 'custom:mine' })
    expect(screen.getByTestId('keymap-source')).toHaveTextContent('.ohhi/keymaps/mine.json')

    await user.click(screen.getByTestId('hotkey-add:group.new'))
    await user.keyboard('{Alt>}g{/Alt}')
    await waitFor(() => expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'group.new': 'Alt+g' } }))
    await waitFor(() => expect(chips('group.new')).toEqual(['Alt+G']))
    expect(screen.getByTestId('keymap-saved')).toHaveTextContent(t.saved({ path: '.ohhi/keymaps/mine.json' }))

    await user.click(screen.getByTestId('hotkey-add:group.new'))
    await user.keyboard('{Control>}{Shift>}g{/Shift}{/Control}')
    await waitFor(() => expect(chips('group.new')).toEqual(['Alt+G', 'Ctrl+Shift+G']))

    await user.click(screen.getByTestId('hotkey-reset:group.new'))
    await waitFor(() => expect(written(world, 'mine')).toEqual(mine))
    expect(screen.getByTestId('hotkey-unbound:group.new')).toBeVisible()
    expect(world.config.active).toBe('custom:mine')
  })

  it('picks mine-2 when mine is taken, extending the active keymap', async () => {
    const user = userEvent.setup()
    const world = await openKeys({ files: { '.ohhi/keymaps/mine.json': { ...mine, bindings: { 'nav.back': 'Alt+b' } } } })
    await user.click(screen.getByTestId('hotkey-remove:tab.close:0'))
    await waitFor(() => expect(world.config.active).toBe('custom:mine-2'))
    expect(written(world, 'mine-2')).toEqual({ ...mine, bindings: { 'tab.close': [] } })
    expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'nav.back': 'Alt+b' } })
  })

  it('a vault file named after a built-in is never written: the change goes to mine.json extending it', async () => {
    const user = userEvent.setup()
    const world = await openKeys({
      files: { '.ohhi/keymaps/default.json': { $schema: KEYMAP_SCHEMA_ID, bindings: { 'nav.back': 'Alt+b' } } },
    })
    expect(screen.getByTestId('keymap-from')).toHaveTextContent(t.shadows_builtin())
    await user.click(screen.getByTestId('hotkey-remove:tab.close:0'))
    await waitFor(() => expect(world.config.active).toBe('custom:mine'))
    expect(written(world, 'mine')).toEqual({ ...mine, bindings: { 'tab.close': [] } })
    // Extending the vault's `default`, so its own binding still holds.
    expect(world.registry.effectiveKeys('nav.back')).toBe('Alt+b')
  })

  it('refuses every change over a keymap that failed to resolve, saying so', async () => {
    const world = await openKeys({ active: 'custom:gone' })
    expect(screen.getByTestId('keymap-source-fallback')).toHaveTextContent(/gone/)
    expect(screen.getByTestId('keymap-blocked')).toHaveTextContent(t.cannot_write())
    expect(screen.getByTestId('hotkey-chip:tab.close:0')).toBeDisabled()
    expect(screen.getByTestId('hotkey-add:tab.close')).toBeDisabled()
    expect(world.writes).toEqual([])
  })
})

describe('Settings › Keys: recording', () => {
  it('runs no command while recording; Escape cancels and writes nothing', async () => {
    const user = userEvent.setup()
    const world = await openKeys()
    await user.click(screen.getByTestId('hotkey-chip:tab.close:0'))
    await waitFor(() => expect(screen.getByTestId('hotkey-recorder:tab.close')).toHaveFocus())
    // Suspended: the chord being recorded must not also run what it is bound to.
    expect(world.registry.match(ctrl('w'))).toBeNull()

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('hotkey-recorder:tab.close')).toBeNull()
    expect(chips('tab.close')).toEqual(['Ctrl+W'])
    expect(world.writes).toEqual([])
    expect(world.registry.match(ctrl('w'))?.id).toBe('tab.close')
  })
})

describe('Settings › Keys: finding a command', () => {
  it('search matches the name, the id and the key', async () => {
    const user = userEvent.setup()
    await openKeys()
    const search = screen.getByTestId('hotkey-search')
    await user.type(search, 'reading')
    expect(screen.getByTestId('hotkey-row:view.toggle-reading')).toBeVisible()
    expect(screen.queryByTestId('hotkey-row:view.toggle-source')).toBeNull()
    await user.clear(search)
    await user.type(search, 'tab.clo')
    expect(screen.getByTestId('hotkey-row:tab.close')).toBeVisible()
    // The id matched, so it is shown.
    expect(screen.getByTestId('hotkey-id:tab.close')).not.toHaveClass('hidden')
    await user.clear(search)
    await user.type(search, 'ctrl+[[')
    expect(screen.getAllByTestId(/^hotkey-row:/).map((r) => r.dataset.testid)).toEqual(['hotkey-row:nav.back'])
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByTestId('hotkey-no-match')).toHaveTextContent(t.no_match())
  })

  it('Press keys: the chord pressed shows what it runs, and runs nothing', async () => {
    const user = userEvent.setup()
    const world = await openKeys()
    await user.click(screen.getByTestId('hotkey-press-keys'))
    expect(screen.getByTestId('hotkey-press-keys')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByTestId('hotkey-search')).toHaveFocus())
    expect(world.registry.match(ctrl('e'))).toBeNull()

    await user.keyboard('{Control>}e{/Control}')
    expect(screen.getByTestId('hotkey-search')).toHaveValue('Ctrl+E')
    expect(screen.getAllByTestId(/^hotkey-row:/).map((r) => r.dataset.testid)).toEqual([
      'hotkey-row:view.toggle-reading',
    ])
    // Escape clears the chord, a second leaves the mode.
    await user.keyboard('{Escape}')
    expect(screen.getAllByTestId(/^hotkey-row:/)).toHaveLength(5)
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('hotkey-press-keys')).toHaveAttribute('aria-pressed', 'false')
    await user.tab()
    expect(world.registry.match(ctrl('e'))?.id).toBe('view.toggle-reading')
  })

  it('the chips filter to Changed, Clashes and No key, with counts; a clash says so on the row', async () => {
    const user = userEvent.setup()
    await openKeys({
      files: { '.ohhi/keymaps/mine.json': { ...mine, bindings: { 'view.toggle-source': 'Mod+e' } } },
      active: 'custom:mine',
    })
    expect(screen.getByTestId('hotkey-filter:all')).toHaveTextContent(`${t.filter.all()} 5`)
    expect(screen.getByTestId('hotkey-filter:changed')).toHaveTextContent(`${t.filter.changed()} 1`)
    expect(screen.getByTestId('hotkey-filter:clashes')).toHaveTextContent(`${t.filter.clashes()} 2`)
    expect(screen.getByTestId('hotkey-filter:unbound')).toHaveTextContent(`${t.filter.unbound()} 1`)
    expect(screen.getByTestId('hotkey-warning:view.toggle-source')).toHaveTextContent(
      t.conflict({ commands: 'Toggle reading view' })
    )

    await user.click(screen.getByTestId('hotkey-filter:clashes'))
    expect(screen.getByTestId('hotkey-filter:clashes')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId(/^hotkey-row:/).map((r) => r.dataset.testid)).toEqual([
      'hotkey-row:view.toggle-reading',
      'hotkey-row:view.toggle-source',
    ])
    await user.click(screen.getByTestId('hotkey-filter:unbound'))
    expect(screen.getAllByTestId(/^hotkey-row:/).map((r) => r.dataset.testid)).toEqual(['hotkey-row:group.new'])
  })
})
