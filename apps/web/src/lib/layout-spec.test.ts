import { describe, expect, it, vi } from 'vitest'
import {
  EXAMPLE_FILES,
  EXAMPLES,
  LAYOUT_SCHEMA_ID,
  LayoutError,
  NO_OVERRIDES,
  PRESET_FILES as BUILTIN_FILES,
  PRESETS,
  applyOverrides,
  hasOverrides,
  layoutAlias,
  normalizeOverrides,
  overridesFor,
  shippedSpec,
  READOUT_IDS,
  REGION_IDS,
  ShellSpecSchema,
  applyList,
  diffSpec,
  parseSpec,
  resolveSpec,
  withPill,
  pillBar,
  pillRegion,
  offersView,
  upgradeLayout,
  type LayoutFile,
  type ShellSpec,
} from './layout-spec.js'
import { LAYOUT_DEFAULTS } from './layout.js'

const $schema = LAYOUT_SCHEMA_ID
const file = (rest: Omit<LayoutFile, '$schema'>): LayoutFile => ({ $schema, ...rest })
/** The built-in and the example a test file may `extends` by name. */
const PRESET_FILES: Record<string, LayoutFile> = { ...BUILTIN_FILES, ...EXAMPLE_FILES }
const DEFAULT = PRESETS.default
const DENSE = EXAMPLES.dense

describe('the built-in and the example', () => {
  it('one built-in, `default`; dense is an example file that extends it', () => {
    expect(ShellSpecSchema.safeParse(DEFAULT).success).toBe(true)
    expect(ShellSpecSchema.safeParse(DENSE).success).toBe(true)
    expect(Object.keys(BUILTIN_FILES)).toEqual(['default'])
    expect(Object.keys(PRESETS)).toEqual(['default'])
    expect(EXAMPLE_FILES.dense.extends).toBe('default')
    expect(shippedSpec('default')).toBe(DEFAULT)
    expect(shippedSpec('dense')).toBe(DENSE)
    expect(shippedSpec('writing')).toBeNull()
  })

  it('light and dense are read as default — dense saying so once on the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(layoutAlias('light')).toBe('default')
    expect(layoutAlias('dense')).toBe('default')
    expect(layoutAlias('dense')).toBe('default')
    expect(layoutAlias('writing')).toBe('writing')
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    warn.mockRestore()
  })

  it('dense is the shell that shipped before layouts: both columns, every tab, a status bar per pane', () => {
    const d = DENSE
    expect(d.regions).toEqual({
      header: 'breadcrumb',
      navigator: 'column',
      rail: 'column',
      tabs: 'always',
      statusbar: 'pane',
      format: 'off',
      status: 'off',
    })
    expect(d.bars.format).toEqual([])
    expect(d.panes.open).toBe('tab')
    expect(d.bars.statusbar).toEqual(['pane.lead', '|', 'words', 'mode', 'sync'])
    // The column booleans the old prefs defaulted to.
    expect(d.regions.navigator === 'column').toBe(true)
    expect(LAYOUT_DEFAULTS.active).toBe('default')
  })

  it('default is the quiet one: arrows, the title, a dock, merged readouts, the format bar, the count in the corner', () => {
    const d = DEFAULT
    expect(d.regions).toEqual({
      header: 'toolbar',
      navigator: 'drawer',
      rail: 'dock',
      // Chris, 2026-10-06: the strip from one note, so a new tab is one click.
      tabs: 'always',
      statusbar: 'merged',
      format: 'bottom',
      status: 'corner',
    })
    expect(d.toolbar.position).toBe('top')
    expect(d.dock.position).toBe('top-right')
    expect(d.bars['toolbar.left']).toEqual(['nav'])
    // Chris, 2026-10-06: nothing in the middle — the tab strip names the note now.
    expect(d.bars['toolbar.center']).toEqual([])
    // Round 3: no mode menu and no word count in the toolbar (Q4, Q5)…
    // …and the inspector's door right of the bell (drawn only with devtools on),
    // the Session view's door (drawn only with a provider; Chris, 2026-10-15),
    // then Help at the far end (first-run E1).
    expect(d.bars['toolbar.right']).toEqual(['sync', 'drawer', 'session', 'inspector', 'help'])
    // …the words and characters ride the corner. (`last-agent-write` is a
    // catalogue readout a layout opts into: the corner's " · " join is drawn
    // between ids, so a readout that draws nothing would leave a stray dot.)
    expect(d.bars.status).toEqual(['words', 'chars'])
    expect(d.bars.format.filter((id) => id !== '|')).toHaveLength(19)
    // E6: the tab strip's end carries the two split commands.
    expect(d.bars.tabs).toEqual(['workspace.split-right', 'workspace.split-down'])
    // The format commands, then (QA round 1) the comment button after its own separator.
    expect(d.bars.format.slice(0, -2).filter((id) => id !== '|').every((id) => id.startsWith('format.'))).toBe(true)
    expect(d.bars.format.slice(-2)).toEqual(['|', 'note.comment'])
    expect(d.bars.statusbar).toEqual(['pane.lead', '|', 'sync'])
    expect(d.panes.open).toBe('replace')
    expect(d.editor).toEqual({ measure: 'comfortable', typewriter: false, inlineTitle: true })
    // The format bar is a region: Focus mode hides it in default.
    expect(d.focus.keep).toEqual(['toolbar', 'format'])
  })

  it('names the catalogues it validates against', () => {
    expect(READOUT_IDS).toContain('sync')
    expect(READOUT_IDS).toContain('note.pill')
    expect(READOUT_IDS).not.toContain('note.menu')
    expect(READOUT_IDS).toContain('chars')
    expect(READOUT_IDS).toContain('inspector')
    expect(READOUT_IDS).toContain('help')
    expect(READOUT_IDS).toContain('last-agent-write')
    expect(READOUT_IDS).toContain('session')
    expect(READOUT_IDS).toHaveLength(19)
    expect(REGION_IDS).toContain('format')
    expect(REGION_IDS).toContain('status')
  })
})

describe('parseSpec', () => {
  it('accepts a minimal delta file (a retired built-in read as default)', () => {
    const r = parseSpec(JSON.stringify({ $schema, extends: 'light', toolbar: { position: 'bottom' } }))
    expect(r).toEqual({ ok: true, spec: { $schema, extends: 'default', toolbar: { position: 'bottom' } } })
  })

  it('refuses what is not JSON, an unknown key, a wrong enum and an unknown readout — saying where', () => {
    const bad = (v: unknown): string => {
      const r = parseSpec(v)
      if (r.ok) throw new Error('expected a refusal')
      return r.error
    }
    expect(bad('{ nope')).toMatch(/not JSON/)
    expect(bad({ $schema, regoins: {} })).toMatch(/regoins/)
    expect(bad({ $schema, toolbar: { position: 'left' } })).toMatch(/toolbar\.position/)
    expect(bad({ $schema, bars: { statusbar: ['wordz'] } })).toMatch(/bars\.statusbar\.0/)
    expect(bad({ $schema, bars: { statusbar: ['+wordz'] } })).toMatch(/bars\.statusbar/)
    expect(bad({ $schema: 'ohhi.layout.v9' })).toMatch(/\$schema/)
  })

  it('refuses a list that mixes plain ids with deltas', () => {
    const r = parseSpec({ $schema, bars: { statusbar: ['words', '+mode'] } })
    expect(r.ok).toBe(false)
  })

  it('leaves format ids to the registry: any id is accepted in bars.format', () => {
    expect(parseSpec({ $schema, bars: { format: ['format.someday', '|', '+x'] } }).ok).toBe(false)
    expect(parseSpec({ $schema, bars: { format: ['+format.someday', '|'] } }).ok).toBe(true)
  })
})

describe('reading a file written before round 2', () => {
  it('toolbar.format is read as bars.format; rail "menu" as "dock"; extends "default" stays', () => {
    const r = parseSpec({
      $schema,
      extends: 'default',
      regions: { rail: 'menu' },
      bars: { 'toolbar.format': ['-format.image'] },
    })
    expect(r).toEqual({
      ok: true,
      spec: { $schema, extends: 'default', regions: { rail: 'dock' }, bars: { format: ['-format.image'] } },
    })
    if (!r.ok) return
    const spec = resolveSpec(r.spec, PRESET_FILES)
    expect(spec.bars.format).not.toContain('format.image')
    expect(spec.regions.rail).toBe('dock')
  })

  it('note.pill and people are read as sync — bare, +id and -id — and never twice', () => {
    expect(upgradeLayout({ bars: { 'toolbar.right': ['people', 'note.pill', '|', 'drawer'] } })).toEqual({
      bars: { 'toolbar.right': ['sync', '|', 'drawer'] },
    })
    expect(upgradeLayout({ bars: { statusbar: ['-note.pill', '+people'] } })).toEqual({
      bars: { statusbar: ['-sync', '+sync'] },
    })
    expect(upgradeLayout({ bars: { statusbar: ['sync', 'note.pill'] } })).toEqual({ bars: { statusbar: ['sync'] } })
    // The format bar holds command ids: never touched.
    expect(upgradeLayout({ bars: { format: ['people'] } })).toEqual({ bars: { format: ['people'] } })
    const input = { bars: { statusbar: ['note.pill'] } }
    upgradeLayout(input)
    expect(input.bars.statusbar).toEqual(['note.pill'])
  })

  it('an old complete file with no extends still resolves: the new fields take their defaults', () => {
    const old = {
      $schema,
      regions: { header: 'breadcrumb', navigator: 'column', rail: 'column', tabs: 'always', statusbar: 'pane' },
      bars: { 'toolbar.left': [], 'toolbar.format': [], 'toolbar.right': [], statusbar: ['words', 'note.pill'] },
      toolbar: { position: 'top' },
      panes: { borders: 'hairline', focusMark: false, lead: true, open: 'tab' },
      views: [],
      editor: { measure: 'comfortable', typewriter: false },
      focus: { keep: ['header', 'statusbar'] },
    }
    const r = parseSpec(old)
    if (!r.ok) throw new Error(r.error)
    const spec = resolveSpec(r.spec, PRESET_FILES)
    expect(spec.regions.format).toBe('bottom')
    expect(spec.dock.position).toBe('top-right')
    expect(spec.editor.inlineTitle).toBe(true)
    expect(spec.bars['toolbar.center']).toEqual([])
    expect(spec.bars.statusbar).toEqual(['words', 'sync'])
    // Round 3's fields too: the corner, with words and characters.
    expect(spec.regions.status).toBe('corner')
    expect(spec.bars.status).toEqual(['words', 'chars'])
  })

  it('a file built in code that extends "light" resolves over default', () => {
    expect(resolveSpec(file({ extends: 'light' }), BUILTIN_FILES)).toEqual(DEFAULT)
    expect(resolveSpec(file({ extends: 'dense' }), BUILTIN_FILES)).toEqual(DEFAULT)
  })
})

describe('applyList — the delta grammar', () => {
  const base = ['a', 'b', '|', 'c']
  it('plain ids replace', () => {
    expect(applyList(base, ['x', 'y'])).toEqual(['x', 'y'])
  })
  it('+id appends when absent, keeps order, never duplicates', () => {
    expect(applyList(base, ['+d', '+a'])).toEqual(['a', 'b', '|', 'c', 'd'])
  })
  it('-id removes, and a separator it strands is dropped', () => {
    expect(applyList(base, ['-c'])).toEqual(['a', 'b'])
    expect(applyList(base, ['-a', '-b'])).toEqual(['c'])
  })
  it('separators append, collapse, and -| drops them all', () => {
    expect(applyList(base, ['|', '+d'])).toEqual(['a', 'b', '|', 'c', '|', 'd'])
    expect(applyList(base, ['+|', '+|', '+d'])).toEqual(['a', 'b', '|', 'c', '|', 'd'])
    expect(applyList(base, ['-|'])).toEqual(['a', 'b', 'c'])
    expect(applyList([], ['|', 'a', '|', '|', 'b', '|'])).toEqual(['a', '|', 'b'])
  })
})

describe('resolveSpec — extends and precedence', () => {
  it('a file over a preset: scalars override, lists delta, the rest inherits', () => {
    const spec = resolveSpec(
      file({
        extends: 'dense',
        toolbar: { position: 'bottom' },
        bars: { statusbar: ['-mode', '+reading-time'] },
        regions: { rail: 'dock' },
      }),
      PRESET_FILES
    )
    expect(spec.toolbar.position).toBe('bottom')
    expect(spec.bars.statusbar).toEqual(['pane.lead', '|', 'words', 'sync', 'reading-time'])
    expect(spec.regions).toEqual({ ...DENSE.regions, rail: 'dock' })
    expect(spec.panes).toEqual(DENSE.panes)
  })

  it('follows extends through several files, nearest wins', () => {
    const presets = {
      ...PRESET_FILES,
      mine: file({ extends: 'light', editor: { measure: 'wide' }, bars: { 'toolbar.right': ['-drawer'] } }),
      later: file({ extends: 'mine', editor: { typewriter: true } }),
    }
    const spec = resolveSpec(file({ extends: 'later', editor: { measure: 'narrow' } }), presets)
    expect(spec.editor).toEqual({ measure: 'narrow', typewriter: true, inlineTitle: true })
    expect(spec.bars['toolbar.right']).toEqual(['sync', 'session', 'inspector', 'help'])
  })

  it('refuses a cycle, a self-extend and an unknown parent instead of looping', () => {
    const presets = {
      a: file({ extends: 'b' }),
      b: file({ extends: 'a' }),
      me: file({ extends: 'me' }),
    }
    expect(() => resolveSpec(presets.a, presets, 'a')).toThrow(/cycle/)
    expect(() => resolveSpec(presets.me, presets, 'me')).toThrow(/cycle/)
    expect(() => resolveSpec(file({ extends: 'nowhere' }), presets)).toThrow(/unknown layout "nowhere"/)
    // Without the name, the cycle is still caught one step later.
    expect(() => resolveSpec(presets.a, presets)).toThrow(LayoutError)
  })

  it('a file with no extends must be complete', () => {
    expect(() => resolveSpec(file({ toolbar: { position: 'top' } }), PRESET_FILES)).toThrow(/regions/)
  })

  it('refuses a spec that takes sync off the bar on screen (golden rule 4)', () => {
    // dense shows the pane status bar: removing the pill from it is refused…
    expect(() => resolveSpec(file({ extends: 'dense', bars: { statusbar: ['-sync'] } }), PRESET_FILES)).toThrow(
      /"sync" must be in bars\.statusbar/
    )
    // …and its old name is the same id.
    expect(() => resolveSpec(file({ extends: 'dense', bars: { statusbar: ['-note.pill'] } }), PRESET_FILES)).toThrow(
      /sync/
    )
    // …and light merges it into the toolbar, so the toolbar must carry it.
    expect(() =>
      resolveSpec(file({ extends: 'light', bars: { 'toolbar.right': ['-sync'] } }), PRESET_FILES)
    ).toThrow(/bars\.toolbar\.right/)
    // Any of the toolbar's three groups carries it.
    expect(
      resolveSpec(
        file({ extends: 'light', bars: { 'toolbar.right': ['-sync'], 'toolbar.left': ['+sync'] } }),
        PRESET_FILES
      ).bars['toolbar.left']
    ).toEqual(['nav', 'sync'])
    // Off the bar that is NOT on screen, removing it is fine.
    expect(
      resolveSpec(file({ extends: 'light', bars: { statusbar: ['-sync'] } }), PRESET_FILES).bars.statusbar
    ).toEqual(['pane.lead'])
  })

  it('refuses a Focus keep that hides the bar carrying sync (golden rule 4)', () => {
    // dense: the pill is on the pane status bar, so Focus must keep it…
    expect(() => resolveSpec(file({ extends: 'dense', focus: { keep: ['-statusbar'] } }), PRESET_FILES)).toThrow(
      /focus\.keep: "statusbar" must be in focus\.keep/
    )
    // …light: it rides the toolbar, so Focus must keep that.
    expect(() => resolveSpec(file({ extends: 'light', focus: { keep: ['header'] } }), PRESET_FILES)).toThrow(
      /focus\.keep: "toolbar" must be in focus\.keep/
    )
    // Moving the pill's bar moves the requirement: merged dense (toolbar header) needs the toolbar kept.
    expect(() =>
      resolveSpec(
        file({
          extends: 'dense',
          regions: { statusbar: 'merged', header: 'toolbar' },
          bars: { 'toolbar.right': ['sync'] },
        }),
        PRESET_FILES
      )
    ).toThrow(/"toolbar" must be in focus\.keep/)
    // Keeping more than the pill's region is fine — the format bar included.
    expect(
      resolveSpec(file({ extends: 'light', focus: { keep: ['+navigator', '+format'] } }), PRESET_FILES).focus.keep
    ).toEqual(['toolbar', 'format', 'navigator'])
  })

  it('refuses merged status bars under the breadcrumb header: no bar would carry sync (golden rule 4)', () => {
    // The toolbar is drawn only as the header, and merged hides every pane's bar.
    expect(() =>
      resolveSpec(file({ extends: 'light', regions: { header: 'breadcrumb' } }), PRESET_FILES)
    ).toThrow(/regions\.statusbar: "merged" needs regions\.header "toolbar"/)
    expect(() =>
      resolveSpec(
        file({ extends: 'dense', regions: { statusbar: 'merged' }, bars: { 'toolbar.right': ['sync'] } }),
        PRESET_FILES
      )
    ).toThrow(/needs regions\.header "toolbar"/)
    // …and the other way round: the breadcrumb header with pane bars is the dense preset, fine.
    expect(pillBar(DENSE)).toBe('statusbar')
    expect(pillRegion(DENSE)).toBe('statusbar')
    expect(pillBar({ regions: { ...DENSE.regions, statusbar: 'merged' } })).toBe('statusbar')
    expect(pillBar(DEFAULT)).toBe('toolbar.right')
    expect(pillRegion(DEFAULT)).toBe('toolbar')
  })

  it('withPill turns a homeless merged bar back into pane bars', () => {
    const homeless: ShellSpec = { ...DEFAULT, regions: { ...DEFAULT.regions, header: 'breadcrumb' } }
    expect(ShellSpecSchema.safeParse(homeless).success).toBe(false)
    const fixed = withPill(homeless)
    expect(fixed.regions.statusbar).toBe('pane')
    expect(fixed.bars.statusbar).toContain('sync')
    expect(fixed.focus.keep).toContain('statusbar')
    expect(ShellSpecSchema.safeParse(fixed).success).toBe(true)
  })

  it('withPill puts the pill where a region change moved the bar', () => {
    const merged: ShellSpec = {
      ...DENSE,
      regions: { ...DENSE.regions, statusbar: 'merged', header: 'toolbar' },
    }
    expect(ShellSpecSchema.safeParse(merged).success).toBe(false)
    expect(ShellSpecSchema.safeParse(withPill(merged)).success).toBe(true)
    expect(withPill(merged).focus.keep).toEqual(['header', 'statusbar', 'toolbar'])
    expect(withPill(DENSE)).toBe(DENSE)
    // default → a pane status bar: the pill and its region both follow.
    const pane: ShellSpec = { ...DEFAULT, regions: { ...DEFAULT.regions, statusbar: 'pane' } }
    expect(ShellSpecSchema.safeParse(pane).success).toBe(false)
    expect(withPill(pane).focus.keep).toEqual(['toolbar', 'format', 'statusbar'])
    expect(ShellSpecSchema.safeParse(withPill(pane)).success).toBe(true)
  })
})

describe('diffSpec', () => {
  const roundTrip = (base: ShellSpec, full: ShellSpec, name: 'default' | 'dense') => {
    const delta = diffSpec(base, full, name)
    expect(parseSpec(JSON.parse(JSON.stringify(delta))).ok).toBe(true)
    expect(resolveSpec(delta, PRESET_FILES)).toEqual(full)
    return delta
  }

  it('an unchanged spec is just the header', () => {
    expect(diffSpec(DEFAULT, DEFAULT, 'default')).toEqual({ $schema, extends: 'default' })
  })

  it('writes only the fields that changed — three lines for the demo', () => {
    const full = { ...DEFAULT, toolbar: { position: 'bottom' as const } }
    expect(roundTrip(DEFAULT, full, 'default')).toEqual({
      $schema,
      extends: 'default',
      toolbar: { position: 'bottom' },
    })
  })

  it('a list becomes a delta when that is shorter, a replacement when not', () => {
    const fewer: ShellSpec = {
      ...DEFAULT,
      bars: { ...DEFAULT.bars, 'toolbar.right': ['sync', 'drawer', 'session', 'inspector', 'help', 'words', 'reading-time'] },
    }
    expect(roundTrip(DEFAULT, fewer, 'default').bars).toEqual({
      'toolbar.right': ['+words', '+reading-time'],
    })
    const reordered: ShellSpec = {
      ...DEFAULT,
      bars: { ...DEFAULT.bars, statusbar: ['sync', 'words'] },
    }
    expect(roundTrip(DEFAULT, reordered, 'default').bars).toEqual({ statusbar: ['sync', 'words'] })
  })

  it('round-trips dense → default and back', () => {
    roundTrip(DENSE, DEFAULT, 'dense')
    roundTrip(DEFAULT, DENSE, 'default')
  })
})

describe('offersView', () => {
  it('a listed view is offered; an empty list offers every view', () => {
    expect(DEFAULT.views).toEqual(['inspector', 'log', 'shared', 'session'])
    expect(offersView({ views: ['log'] }, 'log')).toBe(true)
    expect(offersView({ views: ['log'] }, 'shared')).toBe(false)
    expect(offersView({ views: [] }, 'shared')).toBe(true)
  })
})

describe("a device's overrides (round 3, Q6)", () => {
  it('none: the same spec object back', () => {
    expect(hasOverrides(NO_OVERRIDES)).toBe(false)
    expect(applyOverrides(DEFAULT, NO_OVERRIDES)).toBe(DEFAULT)
  })

  it('lay over the resolved file like a file over its parent: scalars override, lists delta', () => {
    const spec = applyOverrides(
      DEFAULT,
      file({ toolbar: { position: 'bottom' }, regions: { status: 'off' }, bars: { status: ['-chars'] } })
    )
    expect(spec.toolbar.position).toBe('bottom')
    expect(spec.regions).toEqual({ ...DEFAULT.regions, status: 'off' })
    expect(spec.bars.status).toEqual(['words'])
    expect(spec.panes).toEqual(DEFAULT.panes)
  })

  it('never take the pill off the screen (golden rule 4): a breaking override is repaired or ignored', () => {
    const repaired = applyOverrides(DEFAULT, file({ regions: { header: 'breadcrumb' } }))
    expect(repaired.regions.statusbar).toBe('pane')
    expect(repaired.bars.statusbar).toContain('sync')
    expect(ShellSpecSchema.safeParse(repaired).success).toBe(true)
  })

  it('overridesFor stores only what differs from the file, and a value set back stops being one', () => {
    const next = { ...DEFAULT, toolbar: { position: 'bottom' as const } }
    const overrides = overridesFor(DEFAULT, next)
    expect(overrides).toEqual({ $schema, toolbar: { position: 'bottom' } })
    expect(applyOverrides(DEFAULT, overrides)).toEqual(next)
    expect(overridesFor(DEFAULT, DEFAULT)).toEqual({ $schema })
    // Over another file, the same edit is still a one-field delta.
    expect(overridesFor(DENSE, { ...DENSE, regions: { ...DENSE.regions, navigator: 'drawer' } })).toEqual({
      $schema,
      regions: { navigator: 'drawer' },
    })
  })

  it('normalizeOverrides is tolerant: garbage is none, extends is dropped, old shapes upgrade', () => {
    expect(normalizeOverrides(undefined)).toEqual(NO_OVERRIDES)
    expect(normalizeOverrides('nope')).toEqual(NO_OVERRIDES)
    expect(normalizeOverrides({ toolbar: { position: 'left' } })).toEqual(NO_OVERRIDES)
    expect(normalizeOverrides({ extends: 'x', toolbar: { position: 'bottom' } })).toEqual({
      $schema,
      toolbar: { position: 'bottom' },
    })
    expect(normalizeOverrides({ regions: { rail: 'menu' } })).toEqual({ $schema, regions: { rail: 'dock' } })
  })
})
