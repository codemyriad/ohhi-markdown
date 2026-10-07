// @vitest-environment jsdom
/**
 * Templates on the shell's side (quiet-shell F11): the rows every root
 * offers (the vault's `.ohhi/templates/` wins over a built-in of the same
 * name), one `template:<name>` palette row each, and `insert` rendering over
 * a pinned clock into the focused editor.
 */
import { describe, expect, it } from 'vitest'
import { fakeVault } from './resources.fixture.js'
import { createResources } from './resources.svelte.js'
import { createTemplates } from './templates.svelte.js'

const now = new Date(2026, 9, 3, 9, 5).getTime()

function setup(vaultFiles: Record<string, string> = {}, opts: { editable?: boolean } = {}) {
  const v = fakeVault(vaultFiles)
  const resources = createResources({ vault: () => v.vault, userRoot: async () => null, warn: () => {} })
  const inserted: string[] = []
  const warnings: string[] = []
  const templates = createTemplates({
    resources,
    now: () => now,
    notePath: () => 'Meetings/Retro.md',
    dateFormat: () => 'DD-M-Y',
    insertText: (text) => {
      if (opts.editable === false) return false
      inserted.push(text)
      return true
    },
    warn: (text) => warnings.push(text),
  })
  return { templates, inserted, warnings }
}

describe('createTemplates', () => {
  it('lists the built-ins and the vault’s files; the vault wins a name', async () => {
    const { templates } = setup({
      '.ohhi/templates/meeting.md': '---\ndescription: Ours\n---\n# {{title}} {{date}}\n',
      '.ohhi/templates/standup.md': 'Yesterday / today / blockers\n',
    })
    const rows = await templates.reload()
    expect(rows.map((r) => [r.name, r.entry.root])).toEqual([
      ['daily', 'builtin'],
      ['meeting', 'vault'],
      ['standup', 'vault'],
    ])
    expect(rows.find((r) => r.name === 'meeting')?.description).toBe('Ours')
    expect(templates.commands().map((c) => c.id)).toEqual(['template:daily', 'template:meeting', 'template:standup'])
  })

  it('lists each root once per reload, not once per template (review #28)', async () => {
    const v = fakeVault({
      '.ohhi/templates/a.md': 'A\n',
      '.ohhi/templates/b.md': 'B\n',
      '.ohhi/templates/c.md': 'C\n',
    })
    // A user root that counts its listings: the per-name read used to re-list
    // every root below the winner to find shadows, once per template.
    let listings = 0
    const user = {
      id: 'user' as const,
      location: () => '~/.config/ohhi/templates',
      list: async () => {
        listings++
        return []
      },
      read: async () => null,
    }
    const resources = createResources({ vault: () => v.vault, userRoot: async () => user, warn: () => {} })
    const templates = createTemplates({
      resources,
      now: () => now,
      notePath: () => null,
      dateFormat: () => 'Y-MM-DD',
      insertText: () => true,
      warn: () => {},
    })
    const rows = await templates.reload()
    expect(rows.map((r) => r.name)).toEqual(['a', 'b', 'c', 'daily', 'meeting'])
    expect(rows.find((r) => r.name === 'b')?.body).toBe('B\n')
    expect(listings).toBe(1)
  })

  it('inserts at the caret with the pinned clock, the note’s title and the arguments', async () => {
    const { templates, inserted } = setup({ '.ohhi/templates/meeting.md': '# {{title}} — {{date}} — ${1:-Sync}\n' })
    await templates.reload()
    expect(await templates.insert('meeting', ['Retro'])).toBe(true)
    expect(await templates.insert('meeting')).toBe(true)
    expect(inserted).toEqual(['# Retro — 03-10-2026 — Retro\n', '# Retro — 03-10-2026 — Sync\n'])
  })

  it('says so when there is no note to insert into, or no such template', async () => {
    const { templates, warnings } = setup({}, { editable: false })
    await templates.reload()
    expect(await templates.insert('daily')).toBe(false)
    expect(await templates.insert('nope')).toBe(false)
    expect(warnings).toHaveLength(2)
  })
})
