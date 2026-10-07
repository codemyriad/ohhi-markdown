/**
 * `docs/customising.md` is what an agent reads to customise the app (quiet-shell
 * F16; foundations Stage 6: "rebind daily-next" and "make my toolbar bottom"
 * from the docs alone). This holds the page to the app:
 *
 *  - every id its lists name exists in the registry or the catalogues, and
 *    every id the app has is listed;
 *  - every JSON example on the page validates against the schema it names;
 *  - both presets, the example keymap and both example templates validate.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMAND_IDS, TOOLBAR_ITEM_IDS } from './command-ids.js'
import { KEYMAP_SCHEMA_ID, KeymapDocSchema, parseKeymap } from './keymap-spec.js'
import { BAR_IDS, LAYOUT_SCHEMA_ID, PRESET_FILES, READOUT_IDS, REGION_IDS, parseSpec, resolveSpec } from './layout-spec.js'
import { VIEW_KINDS } from './panes.js'
import { DOC_LISTS, EXAMPLE_KEYMAP, LayoutDocSchema } from './resource-schemas.js'
import { BUILTIN_TEMPLATES, parseTemplate, render } from './template.js'

function repoRoot(): string {
  let dir = resolve(process.cwd())
  while (!existsSync(join(dir, 'rush.json'))) dir = dirname(dir)
  return dir
}
const docs = readFileSync(join(repoRoot(), 'docs', 'customising.md'), 'utf8')

/** The backticked ids between one generated marker pair. */
function listed(name: string): string[] {
  const from = docs.indexOf(`<!-- generated:${name}`)
  expect(from, `docs/customising.md has no generated:${name} list`).toBeGreaterThan(-1)
  const to = docs.indexOf('<!-- /generated -->', from)
  return [...docs.slice(from, to).matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]!)
}

const CATALOGUES: Record<string, readonly string[]> = {
  'command-ids': COMMAND_IDS,
  'toolbar-item-ids': TOOLBAR_ITEM_IDS,
  'readout-ids': READOUT_IDS,
  'region-ids': REGION_IDS,
  'bar-ids': BAR_IDS,
  'view-ids': VIEW_KINDS,
}

describe('docs/customising.md names only what exists — and all of it', () => {
  it('covers every catalogue the generator lists', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual(Object.keys(DOC_LISTS).sort())
  })
  for (const [name, ids] of Object.entries(CATALOGUES)) {
    it(`${name}: every listed id exists, every id is listed`, () => {
      const names = listed(name)
      for (const id of names) expect(ids, `${name}: "${id}" is not in the app`).toContain(id)
      expect(names.slice().sort()).toEqual([...ids].sort())
    })
  }
  it('every id the prose puts in code (`a.b`) under a known prefix is a real command id', () => {
    const prefixes = /^(?:nav|file|share|view|daily|app|workspace|tab|group|edit|format|template)\.[a-z0-9-]+$/
    const mentioned = [...docs.matchAll(/`([a-z]+\.[a-z0-9-]+)`/g)].map((m) => m[1]!).filter((id) => prefixes.test(id))
    const known = new Set<string>([...COMMAND_IDS, ...TOOLBAR_ITEM_IDS, ...READOUT_IDS, ...BAR_IDS])
    for (const id of mentioned) expect(known, `docs mention "${id}"`).toContain(id)
  })
})

describe('every example validates', () => {
  const blocks = [...docs.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!) as { $schema: string })

  it('the page’s JSON examples, against the schema each names (and the runtime)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    for (const block of blocks) {
      if (block.$schema === LAYOUT_SCHEMA_ID) {
        expect(LayoutDocSchema.safeParse(block).success, JSON.stringify(block)).toBe(true)
        const parsed = parseSpec(block)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) expect(() => resolveSpec(parsed.spec, PRESET_FILES)).not.toThrow()
      } else {
        expect(block.$schema).toBe(KEYMAP_SCHEMA_ID)
        expect(KeymapDocSchema.safeParse(block).success, JSON.stringify(block)).toBe(true)
        expect(parseKeymap(block).ok).toBe(true)
      }
    }
  })

  it('the worked example puts the toolbar at the bottom without the image button', () => {
    const bottom = blocks.find((b) => b.$schema === LAYOUT_SCHEMA_ID && 'bars' in b)!
    const parsed = parseSpec(bottom)
    if (!parsed.ok) throw new Error(parsed.error)
    const spec = resolveSpec(parsed.spec, PRESET_FILES)
    expect(spec.toolbar.position).toBe('bottom')
    expect(spec.bars.format).not.toContain('format.image')
    expect(spec.bars.format).toContain('format.bold')
  })

  it('both presets and the example keymap', () => {
    for (const preset of Object.values(PRESET_FILES)) expect(LayoutDocSchema.safeParse(preset).success).toBe(true)
    expect(KeymapDocSchema.safeParse(EXAMPLE_KEYMAP).success).toBe(true)
  })

  it('both example templates parse, describe themselves and render', () => {
    for (const [name, text] of Object.entries(BUILTIN_TEMPLATES)) {
      const t = parseTemplate(text)
      expect(t.description, name).not.toBe('')
      expect(t.argumentHint, name).not.toBe('')
      expect(render(t.body, { now: 0 })).not.toMatch(/\{\{|\$\{|\$[1-9@]/)
    }
  })
})
