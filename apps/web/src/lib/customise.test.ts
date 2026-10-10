// @vitest-environment jsdom
/**
 * The customising wiring (quiet-shell F8–F11) over a fake vault: the keymap
 * and the templates follow their kind's changes through the ONE `.ohhi/`
 * subscription, `reloadAll` reaches every kind, unusable files are logged
 * warnings, and the keymap reaches the editors.
 */
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from './commands.js'
import { createCustomise } from './customise.svelte.js'
import { KEYMAP_SCHEMA_ID, type KeymapChoice } from './keymap-spec.js'
import type { FlashInput, NoticeInput } from './notices.js'
import { fakeVault } from './resources.fixture.js'
import { box } from './shell-actions.fixture.svelte.js'
import type { ToastData } from './ui/toaster.js'

const settle = async (): Promise<void> => {
  flushSync()
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}

function world(files: Record<string, unknown> = {}) {
  const v = fakeVault(files)
  const notices: NoticeInput[] = []
  const flashes: FlashInput[] = []
  const vault = box<(typeof v.vault & { notify: (i: NoticeInput) => void; flash: (i: FlashInput) => void }) | null>({
    ...v.vault,
    notify: (input) => notices.push(input),
    flash: (input) => flashes.push(input),
  })
  const registry = new CommandRegistry(false)
  registry.register(
    { id: 'tab.close', title: 'Close', keys: 'Mod+w', run: () => {} },
    { id: 'format.bold', title: 'Bold', keys: 'Mod+b', run: () => {} }
  )
  const config = { active: 'default' as KeymapChoice }
  const setFormatBindings = vi.fn()
  const inserted: string[] = []
  const toasts: ToastData[] = []
  const opened: string[] = []
  const customise = createCustomise({
    toast: (data) => void toasts.push(data),
    openSettings: (section) => void opened.push(section),
    workspace: () => vault.value,
    userRoot: async () => null,
    registry,
    setFormatBindings,
    now: () => Date.UTC(2026, 9, 4, 12),
    notePath: () => 'Notes/today.md',
    dateFormat: () => 'YYYY-MM-DD',
    insertText: (text) => (inserted.push(text), true),
    config: {
      legacy: () => ({}),
      clearLegacy: () => {},
      choice: () => config.active,
      setChoice: (c) => (config.active = c),
    },
  })
  return {
    customise,
    v,
    vault,
    notices,
    flashes,
    registry,
    config,
    setFormatBindings,
    inserted,
    toasts,
    opened,
  }
}

describe('createCustomise', () => {
  it('opening a vault reads the keymap and the templates; a change re-reads only its kind', async () => {
    const w = world({
      '.ohhi/keymaps/mine.json': { $schema: KEYMAP_SCHEMA_ID, bindings: { 'format.bold': [] } },
      '.ohhi/templates/meeting.md': '# Meeting {{title}}\n',
    })
    w.config.active = 'custom:mine'
    flushSync()
    await settle()
    expect(w.registry.effectiveKeys('format.bold')).toBe('')
    // The editors are re-keyed from the registry: `[]` reaches CodeMirror too.
    expect(w.setFormatBindings).toHaveBeenLastCalledWith(expect.objectContaining({ 'format.bold': [] }))
    expect(w.customise.templates.rows.map((r) => r.name)).toContain('meeting')
    expect(w.v.feeds.size).toBe(1)

    w.v.disk.set('.ohhi/keymaps/mine.json', JSON.stringify({ $schema: KEYMAP_SCHEMA_ID, bindings: { 'tab.close': 'Alt+w' } }))
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+w')
    expect(w.registry.effectiveKeys('format.bold')).toBe('Mod+b')

    w.v.disk.set('.ohhi/templates/standup.md', 'Standup\n')
    w.v.touch('.ohhi/templates/standup.md')
    await settle()
    expect(w.customise.templates.rows.map((r) => r.name)).toContain('standup')
  })

  it('reloadAll re-reads every kind', async () => {
    const w = world()
    await settle()
    w.v.disk.set('.ohhi/templates/late.md', 'Late\n')
    w.customise.reloadAll()
    await settle()
    expect(w.customise.templates.rows.map((r) => r.name)).toContain('late')
  })

  it('a file that cannot be used is a logged warning, by kind', async () => {
    const w = world({ '.ohhi/keymaps/bad.json': '{ nope' })
    w.config.active = 'custom:bad'
    await settle()
    expect(w.notices).toContainEqual(expect.objectContaining({ level: 'warn', code: 'keymap_invalid' }))
    await w.customise.resources.resolveLayout('custom:gone')
    expect(w.notices).toContainEqual(expect.objectContaining({ level: 'warn', code: 'layout_invalid' }))
  })
})

describe('createCustomise — the keymap in use reloaded (settings-shaping ST6)', () => {
  const mine = (bindings: Record<string, unknown>) => `${JSON.stringify({ $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings })}\n`

  it('a change under it is logged and toasted once, naming the file; Undo writes the old bytes back', async () => {
    const before = mine({ 'tab.close': 'Alt+w' })
    const w = world({ '.ohhi/keymaps/mine.json': before })
    w.config.active = 'custom:mine'
    await settle()
    expect(w.toasts).toEqual([])

    w.v.disk.set('.ohhi/keymaps/mine.json', mine({ 'tab.close': 'Alt+q' }))
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+q')
    expect(w.notices.filter((n) => n.code === 'resource_reloaded')).toEqual([
      { level: 'info', code: 'resource_reloaded', params: { kind: 'keymaps', name: 'mine', file: 'mine.json', root: 'vault' } },
    ])
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]!.title).toBe('Keymap mine.json reloaded from this vault')
    expect(w.toasts[0]!.description).toBe('Undo puts the file back as it was.')
    w.toasts[0]!.secondary!.run()
    expect(w.opened).toEqual(['keys'])

    w.toasts[0]!.action!.run()
    w.toasts[0]!.action!.run() // once only
    await settle()
    expect(w.v.disk.get('.ohhi/keymaps/mine.json')).toBe(before)
    expect(w.v.writes.filter((p) => p === '.ohhi/keymaps/mine.json')).toHaveLength(1)
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+w')
    // The Undo's own write, heard back through the change feed, is not a reload to announce.
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.toasts.map((t) => t.title)).toEqual(['Keymap mine.json reloaded from this vault', 'mine.json is back as it was.'])
  })

  it('the app’s own write (Settings › Keys) is never announced', async () => {
    const w = world({ '.ohhi/keymaps/mine.json': mine({}) })
    w.config.active = 'custom:mine'
    await settle()
    await w.customise.keymap.save('mine', { $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings: { 'tab.close': 'Alt+z' } })
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+z')
    expect(w.toasts).toEqual([])
  })

  it('no Undo for a file the app may not write: a vault keymap named like a built-in', async () => {
    const w = world({ '.ohhi/keymaps/default.json': mine({}) })
    await settle()
    w.v.disk.set('.ohhi/keymaps/default.json', mine({ 'tab.close': 'Alt+q' }))
    w.v.touch('.ohhi/keymaps/default.json')
    await settle()
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]!.title).toBe('Keymap default.json reloaded from this vault')
    expect(w.toasts[0]!.action?.label).toBe('Show')
    expect(w.toasts[0]!.description).toBeUndefined()
  })

  it('only a keymap it extends changed: that parent is named, with no Undo (review MED-1)', async () => {
    const base = (bindings: Record<string, unknown>) => `${JSON.stringify({ $schema: KEYMAP_SCHEMA_ID, extends: 'default', bindings })}\n`
    const own = `${JSON.stringify({ $schema: KEYMAP_SCHEMA_ID, extends: 'base', bindings: {} })}\n`
    const w = world({ '.ohhi/keymaps/mine.json': own, '.ohhi/keymaps/base.json': base({ 'tab.close': 'Alt+w' }) })
    w.config.active = 'custom:mine'
    await settle()
    // Even after the app wrote mine.json itself this session.
    await w.customise.keymap.save('mine', { $schema: KEYMAP_SCHEMA_ID, extends: 'base', bindings: { 'format.bold': 'Alt+b' } })
    await settle()
    w.v.disk.set('.ohhi/keymaps/base.json', base({ 'tab.close': 'Alt+q' }))
    w.v.touch('.ohhi/keymaps/base.json')
    await settle()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+q')
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]!.title).toBe('Keymap base.json reloaded from this vault')
    expect(w.toasts[0]!.action?.label).toBe('Show')
    expect(w.toasts[0]!.description).toBeUndefined()
  })

  it('Undo refuses when the file changed again since the notice (review MED-2)', async () => {
    const before = mine({ 'tab.close': 'Alt+w' })
    const w = world({ '.ohhi/keymaps/mine.json': before })
    w.config.active = 'custom:mine'
    await settle()
    w.v.disk.set('.ohhi/keymaps/mine.json', mine({ 'tab.close': 'Alt+q' }))
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.toasts).toHaveLength(1)
    // Changed again, not yet heard by the watcher.
    const newest = mine({ 'tab.close': 'Alt+z' })
    w.v.disk.set('.ohhi/keymaps/mine.json', newest)
    const writes = w.v.writes.length
    w.toasts[0]!.action!.run()
    await settle()
    expect(w.v.disk.get('.ohhi/keymaps/mine.json')).toBe(newest)
    expect(w.v.writes).toHaveLength(writes)
    expect(w.toasts[1]).toEqual({ level: 'error', title: 'Could not undo: it has changed again since, so nothing was undone' })
  })

  it('overlapping change events for one save are announced once (review PLAUSIBLE)', async () => {
    const w = world({ '.ohhi/keymaps/mine.json': mine({ 'tab.close': 'Alt+w' }) })
    w.config.active = 'custom:mine'
    await settle()
    w.v.disk.set('.ohhi/keymaps/mine.json', mine({ 'tab.close': 'Alt+q' }))
    w.v.touch('.ohhi/keymaps/mine.json')
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.registry.effectiveKeys('tab.close')).toBe('Alt+q')
    expect(w.toasts).toHaveLength(1)
    expect(w.notices.filter((n) => n.code === 'resource_reloaded')).toHaveLength(1)
  })

  it('a keymap that can no longer be used is the fallback warning alone', async () => {
    const w = world({ '.ohhi/keymaps/mine.json': mine({ 'tab.close': 'Alt+w' }) })
    w.config.active = 'custom:mine'
    await settle()
    w.v.disk.set('.ohhi/keymaps/mine.json', '{ nope')
    w.v.touch('.ohhi/keymaps/mine.json')
    await settle()
    expect(w.notices).toContainEqual(expect.objectContaining({ level: 'warn', code: 'keymap_invalid' }))
    expect(w.notices.some((n) => n.code === 'resource_reloaded')).toBe(false)
    expect(w.toasts).toEqual([])
  })
})
