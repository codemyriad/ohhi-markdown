// @vitest-environment jsdom
/**
 * Settings › Customise's derivations (settings-shaping ST4, quiet-shell F16
 * and Fork 8): the loader's `overview()` over fake roots — every kind, what
 * each name shadows, and every file that cannot be used, listed until it is
 * fixed — and the pure rows, roots and paths the section draws from it.
 */
import { describe, expect, it } from 'vitest'
import {
  filePath,
  kindRows,
  problemInUse,
  problemNames,
  rootLines,
  sourceOf,
  type Resolved,
} from './customise-overview.js'
import { LAYOUT_SCHEMA_ID } from './layout-spec.js'
import { KEYMAP_SCHEMA_ID } from './keymap-spec.js'
import { fakeUserRoot, fakeVault } from './resources.fixture.js'
import { createResources, type ResourceEntry } from './resources.svelte.js'

const $schema = LAYOUT_SCHEMA_ID

function setup(vaultFiles: Record<string, unknown> | null, user?: Record<string, unknown>) {
  const v = vaultFiles === null ? null : fakeVault(vaultFiles)
  const resources = createResources({
    vault: () => v?.vault ?? null,
    userRoot: async () => (user ? fakeUserRoot(user) : null),
    warn: () => {},
  })
  return { resources, disk: v?.disk }
}

describe('resources.overview()', () => {
  it('lists every kind across the roots with what each name shadows, and no problems when every file loads', async () => {
    const { resources } = setup(
      {
        '.ohhi/layouts/writing.json': { $schema, extends: 'default', toolbar: { position: 'bottom' } },
        '.ohhi/layouts/default.json': { $schema, extends: 'default', editor: { measure: 'wide' } },
        '.ohhi/templates/standup.md': '# Standup\n',
      },
      { 'writing.json': { $schema, extends: 'default' } }
    )
    const o = await resources.overview()
    expect(o.roots).toEqual([
      { id: 'vault', base: '.ohhi' },
      { id: 'user', base: '~/.config/ohhi' },
      { id: 'builtin', base: null },
    ])
    expect(o.entries.layouts.map((e) => [e.name, e.root, e.shadows])).toEqual([
      ['default', 'vault', ['builtin']],
      ['writing', 'vault', ['user']],
    ])
    expect(o.entries.keymaps.map((e) => e.name)).toEqual(['default'])
    expect(o.entries.templates.map((e) => [e.name, e.root])).toContainEqual(['standup', 'vault'])
    expect(o.problems).toEqual([])
  })

  it('names every file that cannot be used — not JSON, invalid, a missing parent — whether or not it is in use', async () => {
    const { resources } = setup({
      '.ohhi/layouts/focus.json': '{ "extends": "default", ',
      '.ohhi/layouts/wide.json': { $schema, extends: 'default', editor: { measure: 'enormous' } },
      '.ohhi/layouts/orphan.json': { $schema, extends: 'nowhere' },
      '.ohhi/layouts/fine.json': { $schema, extends: 'default' },
      '.ohhi/keymaps/mine.json': { $schema: KEYMAP_SCHEMA_ID, bindings: 'nope' },
    })
    const o = await resources.overview()
    expect(o.problems.map((p) => [p.kind, p.name, p.root, p.path])).toEqual([
      ['layouts', 'focus', 'vault', '.ohhi/layouts/focus.json'],
      ['layouts', 'orphan', 'vault', '.ohhi/layouts/orphan.json'],
      ['layouts', 'wide', 'vault', '.ohhi/layouts/wide.json'],
      ['keymaps', 'mine', 'vault', '.ohhi/keymaps/mine.json'],
    ])
    const focus = o.problems[0]!
    // The sentence the fallback notice carries, without repeating the path.
    expect(focus.message).toMatch(/^not JSON/)
    expect(o.problems[1]!.message).toContain('nowhere')
    expect(o.problems[2]!.message).toContain('editor.measure')
  })

  it('a problem stays until the file is fixed, then goes', async () => {
    const { resources, disk } = setup({ '.ohhi/layouts/focus.json': 'nope' })
    expect((await resources.overview()).problems.map((p) => p.name)).toEqual(['focus'])
    expect((await resources.overview()).problems.map((p) => p.name)).toEqual(['focus'])
    disk!.set('.ohhi/layouts/focus.json', JSON.stringify({ $schema, extends: 'default' }))
    expect((await resources.overview()).problems).toEqual([])
  })

  it('with no vault open, only the built-in root answers', async () => {
    const { resources } = setup(null)
    const o = await resources.overview()
    expect(o.roots).toEqual([{ id: 'builtin', base: null }])
    expect(o.entries.layouts.map((e) => e.name)).toEqual(['default'])
    expect(o.problems).toEqual([])
  })
})

const entry = (name: string, root: ResourceEntry['root'], shadows: ResourceEntry['root'][] = []): ResourceEntry => ({
  name,
  root,
  path: root === 'builtin' ? 'built-in' : root === 'vault' ? `.ohhi/layouts/${name}.json` : `~/.config/ohhi/layouts/${name}.json`,
  shadows,
})
const ok = (e: ResourceEntry): Resolved => ({ chosen: e.name, entry: e, error: null })

describe('kindRows', () => {
  const layouts = [entry('default', 'builtin'), entry('dense', 'vault'), entry('writing', 'user'), entry('focus', 'vault')]
  const keymaps = [entry('default', 'builtin'), entry('mine', 'vault', ['user'])]
  const templates = [entry('daily', 'builtin'), entry('standup', 'vault')]
  const overview = { entries: { layouts, keymaps, templates } }

  it('one row per kind: in use with its root and shadows, and every other name', () => {
    const rows = kindRows({
      overview,
      layout: ok(layouts[1]!),
      keymap: ok(keymaps[1]!),
      theme: { builtin: true, name: 'Fjord Dark' },
      themes: [
        { name: 'nord-dark', path: '.ohhi/themes/nord-dark/theme.css' },
        { name: 'paper', path: '.ohhi/themes/paper/theme.css' },
      ],
    })
    expect(rows.map((r) => r.kind)).toEqual(['layouts', 'keymaps', 'templates', 'themes'])
    const [layout, keymap, tpl, theme] = rows
    expect(layout!.inUse).toEqual({ name: 'dense', root: 'vault', path: '.ohhi/layouts/dense.json', shadows: [] })
    expect(layout!.others.map((e) => e.name)).toEqual(['default', 'writing', 'focus'])
    expect(keymap!.inUse).toEqual({ name: 'mine', root: 'vault', path: '.ohhi/layouts/mine.json', shadows: ['user'] })
    expect(tpl!.inUse).toBeNull()
    expect(tpl!.total).toBe(2)
    expect(theme!.inUse).toEqual({ name: 'Fjord Dark', root: 'builtin', path: null, shadows: [] })
    // Every theme folder in this vault is "also here", from the vault.
    expect(theme!.others).toEqual([
      { name: 'nord-dark', root: 'vault', path: '.ohhi/themes/nord-dark/theme.css', shadows: [] },
      { name: 'paper', root: 'vault', path: '.ohhi/themes/paper/theme.css', shadows: [] },
    ])
    expect(theme!.total).toBe(2)
  })

  it('a chosen file that cannot be used reads as the built-in default standing in, and its problem as in use', () => {
    const rows = kindRows({
      overview,
      layout: { chosen: 'focus', entry: null, error: 'not JSON' },
      keymap: ok(keymaps[0]!),
      theme: { builtin: false, name: 'paper', path: '.ohhi/themes/paper/theme.css' },
      themes: [
        { name: 'nord-dark', path: '.ohhi/themes/nord-dark/theme.css' },
        { name: 'paper', path: '.ohhi/themes/paper/theme.css' },
      ],
    })
    expect(rows[0]!.inUse).toEqual({ name: 'default', root: 'builtin', path: null, shadows: [] })
    expect(rows[0]!.fellBackFrom).toBe('focus')
    expect(rows[3]!.inUse).toEqual({ name: 'paper', root: 'vault', path: '.ohhi/themes/paper/theme.css', shadows: [] })
    // The one in use is not "also here".
    expect(rows[3]!.others.map((e) => e.name)).toEqual(['nord-dark'])
    const focus = { kind: 'layouts' as const, name: 'focus', root: 'vault' as const, path: '.ohhi/layouts/focus.json', message: 'x' }
    const dense = { ...focus, name: 'dense', path: '.ohhi/layouts/dense.json' }
    expect(problemInUse(focus, rows)).toBe(true)
    expect(problemInUse(dense, rows)).toBe(false)
    expect([...problemNames([focus, dense], 'layouts')]).toEqual(['focus', 'dense'])
    expect([...problemNames([focus], 'keymaps')]).toEqual([])
  })
})

describe('rootLines and paths', () => {
  const desktopVault = { name: 'black book', kind: 'tauri' as const, path: '/home/me/black book' }

  it('the desktop: the vault folder on disk, the config folder read-only, built in', () => {
    const lines = rootLines({
      roots: [
        { id: 'vault', base: '.ohhi' },
        { id: 'user', base: '/home/me/.config/ohhi' },
        { id: 'builtin', base: null },
      ],
      vault: desktopVault,
      desktop: true,
    })
    expect(lines).toEqual([
      { id: 'vault', path: '/home/me/black book/.ohhi', detail: 'disk', copyable: true },
      { id: 'user', path: '/home/me/.config/ohhi', detail: 'read-only', copyable: true },
      { id: 'builtin', path: null, detail: 'ships', copyable: false },
    ])
  })

  it('the browser: .ohhi in this browser, no config folder', () => {
    const lines = rootLines({ roots: null, vault: { name: 'notes', kind: 'opfs' }, desktop: false })
    expect(lines.map((l) => [l.id, l.detail, l.copyable])).toEqual([
      ['vault', 'browser', false],
      ['user', 'desktop-only', false],
      ['builtin', 'ships', false],
    ])
  })

  it('a desktop whose config folder did not answer says so; no vault says it comes with one', () => {
    const lines = rootLines({ roots: [{ id: 'builtin', base: null }], vault: null, desktop: true })
    expect(lines.map((l) => l.detail)).toEqual(['no-vault', 'unreadable', 'ships'])
  })

  it('Copy path is the file on disk on the desktop, the vault-relative path in the browser', () => {
    expect(filePath('.ohhi/layouts/dense.json', 'vault', desktopVault)).toBe('/home/me/black book/.ohhi/layouts/dense.json')
    expect(filePath('.ohhi/layouts/dense.json', 'vault', { name: 'n', kind: 'opfs' })).toBe('.ohhi/layouts/dense.json')
    expect(filePath('/home/me/.config/ohhi/layouts/w.json', 'user', desktopVault)).toBe('/home/me/.config/ohhi/layouts/w.json')
  })

  it('sourceOf: a resolved choice as a section’s source line', () => {
    expect(sourceOf(ok(entry('dense', 'vault', ['builtin'])))).toEqual({
      name: 'dense',
      root: 'vault',
      path: '.ohhi/layouts/dense.json',
      shadows: ['builtin'],
      fellBackFrom: null,
    })
    expect(sourceOf({ chosen: 'focus', entry: null, error: 'bad' })).toMatchObject({
      name: 'default',
      root: 'builtin',
      path: null,
      fellBackFrom: 'focus',
    })
  })
})
