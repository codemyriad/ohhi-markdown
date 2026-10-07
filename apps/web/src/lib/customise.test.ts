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
  const customise = createCustomise({
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
