// @vitest-environment jsdom
/**
 * The active keymap on the shell's side (quiet-shell F10): resolving the
 * choice through the resource roots, falling back with a warning, and the
 * one-time `config.hotkeys` → `.ohhi/keymaps/device.json` migration.
 */
import { describe, expect, it } from 'vitest'
import { CommandRegistry } from './commands.js'
import { KEYMAP_SCHEMA_ID, type KeymapFile } from './keymap-spec.js'
import { keymapWorld } from './keymap.fixture.js'
import { formatBindingsOf, migrationName } from './keymap.svelte.js'

const $schema = KEYMAP_SCHEMA_ID

function registry(): CommandRegistry {
  const r = new CommandRegistry(false)
  r.register(
    { id: 'daily.next', title: 'Next', keys: 'Mod+=', run: () => {} },
    { id: 'tab.close', title: 'Close', keys: 'Mod+w', run: () => {} },
    { id: 'format.bold', title: 'Bold', keys: 'Mod+b', run: () => {} },
    { id: 'format.italic', title: 'Italic', keys: 'Mod+i', run: () => {} }
  )
  return r
}

describe('createKeymap — resolving the active file', () => {
  it('the built-in default applies no overrides', async () => {
    const w = keymapWorld({ registry: registry() })
    await w.keymap.reload()
    expect(w.keymap.resolved?.entry).toMatchObject({ name: 'default', root: 'builtin' })
    expect(w.registry.effectiveKeys('daily.next')).toBe('Mod+=')
  })

  it('a vault file is read, its extends followed, and applied', async () => {
    const w = keymapWorld({
      registry: registry(),
      active: 'custom:mine',
      vault: {
        '.ohhi/keymaps/base.json': { $schema, extends: 'default', bindings: { 'tab.close': 'Alt+w' } },
        '.ohhi/keymaps/mine.json': { $schema, extends: 'base', bindings: { 'daily.next': 'Alt+ArrowRight' } },
      },
    })
    await w.keymap.reload()
    expect(w.registry.effectiveKeys('daily.next')).toBe('Alt+ArrowRight')
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+w')
    expect(w.keymap.resolved?.parent).toEqual({ 'tab.close': ['Alt+w'] })
    expect(w.keymap.resolved?.entry?.path).toBe('.ohhi/keymaps/mine.json')
  })

  it('a vault default.json that extends "default" extends the built-in it shadows', async () => {
    const w = keymapWorld({
      registry: registry(),
      vault: { '.ohhi/keymaps/default.json': { $schema, extends: 'default', bindings: { 'format.bold': [] } } },
    })
    await w.keymap.reload()
    expect(w.registry.effectiveKeys('format.bold')).toBe('')
    expect(w.warnings).toEqual([])
  })

  it('an invalid file falls back to the defaults and says so', async () => {
    const w = keymapWorld({
      registry: registry(),
      active: 'custom:broken',
      vault: { '.ohhi/keymaps/broken.json': { $schema, bindings: { 'tab.close': 'Hyper+W' } } },
    })
    await w.keymap.reload()
    expect(w.keymap.resolved?.entry).toBeNull()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Mod+w')
    expect(w.warnings).toEqual([{ name: 'broken', error: expect.stringContaining('broken.json'), kind: 'keymaps' }])
  })

  it('setActive persists the choice and applies it', async () => {
    const w = keymapWorld({
      registry: registry(),
      vault: { '.ohhi/keymaps/mine.json': { $schema, bindings: { 'tab.close': [] } } },
    })
    await w.keymap.setActive('custom:mine')
    expect(w.config.active).toBe('custom:mine')
    expect(w.registry.effectiveKeys('tab.close')).toBe('')
  })
})

describe('createKeymap — the config.hotkeys migration', () => {
  it('with a vault open: writes device.json extending default, makes it active, clears config — once', async () => {
    const w = keymapWorld({ registry: registry(), hotkeys: { 'tab.close': 'Mod+Shift+w', 'daily.next': null } })
    await w.keymap.reload()
    expect(w.writes).toEqual(['.ohhi/keymaps/device.json'])
    expect(JSON.parse(w.disk!.get('.ohhi/keymaps/device.json')!)).toEqual({
      $schema,
      extends: 'default',
      bindings: { 'daily.next': [], 'tab.close': 'Mod+Shift+w' },
    })
    expect(w.config.active).toBe('custom:device')
    expect(w.config.hotkeys).toEqual({})
    expect(w.notices).toEqual([{ path: '.ohhi/keymaps/device.json' }])
    expect(w.registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')
    expect(w.registry.effectiveKeys('daily.next')).toBe('')
    await w.keymap.reload()
    expect(w.writes).toHaveLength(1)
  })

  it('with no vault yet: config.hotkeys is the fallback, and it migrates when one opens', async () => {
    const w = keymapWorld({ registry: registry(), vault: null, hotkeys: { 'tab.close': null } })
    await w.keymap.reload()
    expect(w.keymap.legacy).toBe(true)
    expect(w.registry.effectiveKeys('tab.close')).toBe('')
    expect(w.config.hotkeys).toEqual({ 'tab.close': null })

    w.open()
    await w.keymap.reload()
    expect(w.keymap.legacy).toBe(false)
    expect(w.writes).toEqual(['.ohhi/keymaps/device.json'])
    expect(w.registry.effectiveKeys('tab.close')).toBe('')
  })

  it('never overwrites a device.json that is already there (another device’s, via git)', async () => {
    const theirs = { $schema, bindings: { 'tab.close': 'Alt+q' } }
    const w = keymapWorld({
      registry: registry(),
      hotkeys: { 'tab.close': 'Mod+Shift+w' },
      vault: { '.ohhi/keymaps/device.json': theirs },
    })
    await w.keymap.reload()
    expect(w.writes).toEqual(['.ohhi/keymaps/device-2.json'])
    expect(JSON.parse(w.disk!.get('.ohhi/keymaps/device.json')!)).toEqual(theirs)
    expect(w.config.active).toBe('custom:device-2')
    expect(migrationName(new Set(['device', 'device-2']))).toBe('device-3')
  })
})

describe('createKeymap — the migration never loops', () => {
  it('a config clear that fails does not write a second file on the reloads that follow', async () => {
    const w = keymapWorld({ registry: registry(), hotkeys: { 'tab.close': 'Mod+Shift+w' }, clearFails: true })
    await w.keymap.reload()
    expect(w.config.hotkeys).toEqual({ 'tab.close': 'Mod+Shift+w' }) // localStorage refused the clear
    await w.keymap.reload()
    await w.keymap.reload()
    expect(w.writes).toEqual(['.ohhi/keymaps/device.json'])
    expect(w.config.active).toBe('custom:device')
    expect(w.registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')
  })

  it('a later boot over the same vault adopts the device file that already says the map', async () => {
    const first = keymapWorld({ registry: registry(), hotkeys: { 'tab.close': 'Mod+Shift+w' } })
    await first.keymap.reload()
    const disk = Object.fromEntries(first.disk!)
    const again = keymapWorld({ registry: registry(), hotkeys: { 'tab.close': 'Mod+Shift+w' }, vault: disk })
    await again.keymap.reload()
    expect(again.writes).toEqual([])
    expect(again.config.active).toBe('custom:device')
    expect(again.config.hotkeys).toEqual({})
    expect(again.registry.effectiveKeys('tab.close')).toBe('Mod+Shift+w')
  })
})

describe('formatBindingsOf — what the editors are re-keyed with', () => {
  it('carries a cleared format.bold as [] so CodeMirror drops Mod-b too', () => {
    const r = registry()
    r.setKeymap({ 'format.bold': [] })
    const b = formatBindingsOf(r)
    expect(b['format.bold']).toEqual([])
    expect(b['format.italic']).toEqual(['Mod+i'])
  })
  it('carries edit.toggle-checkbox too, so [] takes Mod-l out of the editor', () => {
    const r = registry()
    r.register({ id: 'edit.toggle-checkbox', title: 'Toggle', keys: 'Mod+l', run: () => {} })
    r.setKeymap({ 'edit.toggle-checkbox': [] })
    expect(formatBindingsOf(r)['edit.toggle-checkbox']).toEqual([])
  })
})

describe('resources — the keymaps kind', () => {
  it('lists the built-in default beside the vault’s files; saveKeymap refuses a built-in or bad name', async () => {
    const w = keymapWorld({ vault: { '.ohhi/keymaps/mine.json': { $schema, bindings: {} } } })
    expect((await w.resources.refreshKeymaps()).map((e) => [e.name, e.root])).toEqual([
      ['default', 'builtin'],
      ['mine', 'vault'],
    ])
    const file: KeymapFile = { $schema, bindings: {} }
    await expect(w.resources.saveKeymap('default', file)).rejects.toThrow()
    await expect(w.resources.saveKeymap('../x', file)).rejects.toThrow()
    await expect(keymapWorld({ vault: null }).resources.saveKeymap('mine', file)).rejects.toThrow()
  })
})
