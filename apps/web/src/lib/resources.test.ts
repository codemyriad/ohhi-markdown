// @vitest-environment jsdom
/**
 * The resource loader over fake roots: precedence (vault → user → built-in,
 * first name wins), `extends` across roots, the fallback to `default` with a
 * warning, and the device's layers — overrides, then pins — over the file.
 */
import { flushSync } from 'svelte'
import { describe, expect, it } from 'vitest'
import { EXAMPLES, LAYOUT_SCHEMA_ID, PRESETS, type LayoutFile } from './layout-spec.js'
import { RESOURCE_KINDS, createResources } from './resources.svelte.js'
import { box } from './shell-actions.fixture.svelte.js'
import { fakeUserRoot as fakeUser, fakeVault } from './resources.fixture.js'

const $schema = LAYOUT_SCHEMA_ID

function setup(opts: { vault?: Record<string, unknown> | null; user?: Record<string, unknown> | null } = {}) {
  const v = opts.vault === null ? null : fakeVault(opts.vault ?? {})
  const warnings: { name: string; error: string }[] = []
  const resources = createResources({
    vault: () => v?.vault ?? null,
    userRoot: async () => (opts.user ? fakeUser(opts.user) : null),
    warn: (name, error) => warnings.push({ name, error }),
  })
  return { resources, warnings, disk: v?.disk, writes: v?.writes }
}

describe('createResources — precedence', () => {
  it('lists the one built-in with nothing else, and it resolves exactly; the dense example answers by name, unlisted', async () => {
    const { resources, warnings } = setup({ vault: null })
    expect((await resources.refresh()).map((e) => [e.name, e.root])).toEqual([['default', 'builtin']])
    expect((await resources.resolveLayout('default')).spec).toEqual(PRESETS.default)
    // `?layout=dense` (the e2e fixtures' boot) is `custom:dense`: the example file.
    expect((await resources.resolveLayout('custom:dense')).spec).toEqual(EXAMPLES.dense)
    expect(warnings).toEqual([])
  })

  it('the vault wins over the user root, which wins over built-in — and the loser is named', async () => {
    const { resources } = setup({
      vault: { '.ohhi/layouts/writing.json': { $schema, extends: 'default', toolbar: { position: 'bottom' } } },
      user: {
        'writing.json': { $schema, extends: 'default', editor: { measure: 'wide' } },
        'mine.json': { $schema, extends: 'default', editor: { typewriter: true } },
      },
    })
    const entries = await resources.refresh()
    expect(entries.map((e) => [e.name, e.root, e.shadows])).toEqual([
      ['default', 'builtin', []],
      ['mine', 'user', []],
      ['writing', 'vault', ['user']],
    ])
    expect(entries.find((e) => e.name === 'writing')?.path).toBe('.ohhi/layouts/writing.json')

    const writing = await resources.resolveLayout('custom:writing')
    expect(writing.spec.toolbar.position).toBe('bottom')
    expect(writing.spec.editor.measure).toBe('comfortable') // the user root's file lost
    expect(writing.entry?.root).toBe('vault')
    expect((await resources.resolveLayout('custom:mine')).spec.editor.typewriter).toBe(true)
  })

  it('a vault file may shadow the built-in name and extend the one it shadows', async () => {
    const { resources, warnings } = setup({
      vault: { '.ohhi/layouts/default.json': { $schema, extends: 'default', regions: { rail: 'column' } } },
    })
    const own = await resources.resolveLayout('default')
    expect(warnings).toEqual([])
    expect(own.entry?.root).toBe('vault')
    expect(own.spec.regions).toEqual({ ...PRESETS.default.regions, rail: 'column' })
  })

  it('reads `light` and `dense` — retired built-ins — as default: an `extends`, a vault file shadowing it', async () => {
    const { resources, warnings } = setup({
      vault: {
        '.ohhi/layouts/old.json': { $schema, extends: 'light', editor: { measure: 'wide' } },
        '.ohhi/layouts/older.json': { $schema, extends: 'dense', editor: { measure: 'narrow' } },
        '.ohhi/layouts/default.json': { $schema, extends: 'light', toolbar: { position: 'bottom' } },
      },
    })
    expect((await resources.resolveLayoutName('default')).spec.toolbar.position).toBe('bottom')
    const old = (await resources.resolveLayout('custom:old')).spec
    expect(old.editor.measure).toBe('wide')
    expect(old.toolbar.position).toBe('bottom') // the vault's default.json wins the name
    expect(old.regions).toEqual(PRESETS.default.regions)
    expect((await resources.resolveLayout('custom:older')).spec.editor.measure).toBe('narrow')
    expect(warnings).toEqual([])
  })

  it('follows extends across roots: a vault file over a user file over the built-in', async () => {
    const { resources } = setup({
      vault: { '.ohhi/layouts/team.json': { $schema, extends: 'base', bars: { statusbar: ['+reading-time'] } } },
      user: { 'base.json': { $schema, extends: 'default', editor: { measure: 'narrow' } } },
    })
    const team = (await resources.resolveLayout('custom:team')).spec
    expect(team.editor.measure).toBe('narrow')
    expect(team.bars.statusbar).toEqual([...PRESETS.default.bars.statusbar, 'reading-time'])
    expect(team.regions).toEqual(PRESETS.default.regions)
  })
})

describe('createResources — invalid files fall back to default and say so', () => {
  const cases: [string, unknown][] = [
    ['not JSON', '{ nope'],
    ['an unknown readout', { $schema, extends: 'default', bars: { statusbar: ['wordz'] } }],
    ['the pill taken off the bar on screen', { $schema, extends: 'default', bars: { 'toolbar.right': ['-note.pill'] } }],
    ['a cycle', { $schema, extends: 'other' }],
    ['an unknown parent', { $schema, extends: 'nowhere' }],
  ]
  for (const [what, body] of cases) {
    it(what, async () => {
      const { resources, warnings } = setup({
        vault: {
          '.ohhi/layouts/broken.json': body,
          '.ohhi/layouts/other.json': { $schema, extends: 'broken' },
        },
      })
      const r = await resources.resolveLayout('custom:broken')
      expect(r.spec).toEqual(PRESETS.default)
      expect(r.entry).toBeNull()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.name).toBe('broken')
      expect(warnings[0]?.error).toBeTruthy()
    })
  }

  it('a chosen layout that no root has', async () => {
    const { resources, warnings } = setup()
    expect((await resources.resolveLayout('custom:gone')).spec).toEqual(PRESETS.default)
    expect(warnings[0]?.error).toMatch(/gone/)
  })
})

describe('createResources — the device layers: file → overrides → pins', () => {
  it('lays the device pins over the file AFTER it resolves, one side at a time (Round 2, P7)', async () => {
    const { resources } = setup({
      vault: { '.ohhi/layouts/mine.json': { $schema, extends: 'default', editor: { measure: 'wide' } } },
    })
    const r = await resources.resolveLayout('custom:mine', { rail: 'column' })
    expect(r.spec.regions).toEqual({ ...PRESETS.default.regions, rail: 'column' })
    expect(r.spec.editor.measure).toBe('wide')
    expect(r.unpinned?.regions).toEqual(PRESETS.default.regions)
    // …the fallback included: a pinned side is a column under every layout.
    expect((await resources.resolveLayout('custom:gone', { navigator: 'column' })).spec.regions.navigator).toBe('column')
  })

  it('overrides go over the file, pins over the overrides (round 3, Q6)', async () => {
    const { resources } = setup({
      vault: { '.ohhi/layouts/mine.json': { $schema, extends: 'default', editor: { measure: 'wide' } } },
    })
    const overrides: LayoutFile = {
      $schema,
      editor: { measure: 'narrow' },
      toolbar: { position: 'bottom' },
      regions: { navigator: 'drawer', rail: 'dock' },
    }
    const r = await resources.resolveLayout('custom:mine', { rail: 'column' }, overrides)
    // The override beats the file…
    expect(r.file?.editor.measure).toBe('wide')
    expect(r.unpinned?.editor.measure).toBe('narrow')
    expect(r.spec.editor.measure).toBe('narrow')
    expect(r.spec.toolbar.position).toBe('bottom')
    // …and the pin beats the override, on its own side only.
    expect(r.unpinned?.regions.rail).toBe('dock')
    expect(r.spec.regions.rail).toBe('column')
    expect(r.spec.regions.navigator).toBe('drawer')
    // The fallback gets them too.
    const gone = await resources.resolveLayout('custom:gone', {}, overrides)
    expect(gone.spec.toolbar.position).toBe('bottom')
    expect(gone.file).toEqual(PRESETS.default)
  })
})

describe('createResources — the change feed', () => {
  it('one .ohhi/ subscription; a change reaches only its kind; a vault switch and reloadAll reach every kind', async () => {
    const first = fakeVault({})
    const vault = box<ReturnType<typeof fakeVault> | null>(first)
    const seen: string[] = []
    const resources = createResources({
      vault: () => vault.value?.vault ?? null,
      userRoot: async () => null,
      warn: () => {},
    })
    for (const kind of RESOURCE_KINDS) resources.onChange(kind, (why) => seen.push(`${kind}:${why}`))
    flushSync()
    expect(seen).toEqual(['layouts:open', 'keymaps:open', 'templates:open'])
    expect(first.feeds.size).toBe(1)
    seen.length = 0
    first.touch('.ohhi/keymaps/mine.json')
    expect(seen).toEqual(['keymaps:change'])
    seen.length = 0
    vault.value = null
    flushSync()
    expect(first.feeds.size).toBe(0)
    expect(seen).toEqual(['layouts:open', 'keymaps:open', 'templates:open'])
    seen.length = 0
    resources.reloadAll()
    expect(seen).toEqual(['layouts:reload', 'keymaps:reload', 'templates:reload'])
  })
})
