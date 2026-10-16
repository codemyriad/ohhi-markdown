/**
 * The app's resource files, described for people and agents (quiet-shell
 * F16; golden rule 9's "generated, never hand-edited", applied to `.ohhi/`).
 *
 *   cd apps/web && rushx gen-schemas
 *
 * writes, at the repo root:
 *   spec/ohhi.layout.v1.schema.json   `.ohhi/layouts/*.json`
 *   spec/ohhi.keymap.v1.schema.json   `.ohhi/keymaps/*.json`
 *   examples/layouts/{default,dense}.json, examples/keymaps/my-keys.json
 *   the generated id lists inside docs/customising.md
 *
 * The schemas are the DOCUMENTED shape: every list entry, command id, readout
 * id, region id and view id is enumerated, so a validator tells you about a
 * typo. The runtime schemas (`layout-spec.ts`, `keymap-spec.ts`) are a little
 * more tolerant (a file written for a newer build still loads). The drift test
 * is `resource-schemas.test.ts`, mirroring apps/cli's conformance test.
 *
 * Lives in apps/web, not beside the CLI's generator in `libs/agent`: the
 * command table, the readout catalogue and the view kinds are the shell's,
 * and `libs/agent` must not import the app. Pure: no I/O — the writer is
 * `scripts/gen-schemas.mjs`.
 */
import { z } from 'zod'
import { COMMAND_IDS, TOOLBAR_ITEM_IDS } from './command-ids.js'
import { KEYMAP_SCHEMA_ID, KeymapDocSchema, type KeymapFile } from './keymap-spec.js'
import {
  BAR_IDS,
  LAYOUT_SCHEMA_ID,
  LAYOUT_SECTIONS,
  EXAMPLE_FILES,
  PILL,
  PRESET_FILES,
  READOUT_ALIASES,
  READOUT_IDS,
  REGION_IDS,
  SEPARATOR,
} from './layout-spec.js'
import { VIEW_KINDS } from './panes.js'

export const SCHEMA_ID_BASE = 'https://ohhi.md/schema'

/** A list field's entries: plain ids, `+id` / `-id` deltas, and the separator. */
function entries(ids: readonly string[]) {
  const sep = [SEPARATOR, `+${SEPARATOR}`, `-${SEPARATOR}`]
  return z.array(z.enum([...sep, ...ids, ...ids.map((i) => `+${i}`), ...ids.map((i) => `-${i}`)] as [string, ...string[]]))
}

const partial = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).partial()

/** `.ohhi/layouts/<name>.json`, documented (the runtime is `LayoutFileSchema`). */
export const LayoutDocSchema = z.strictObject({
  $schema: z.literal(LAYOUT_SCHEMA_ID),
  extends: z
    .string()
    .min(1)
    .optional()
    .describe(
      'A layout by name ("default", the one built-in, or a file name); this file\'s values and deltas apply over it. "light" and "dense", built-ins before, are read as "default".'
    ),
  regions: partial({
    ...LAYOUT_SECTIONS.regions,
    rail: z.enum([...LAYOUT_SECTIONS.regions.rail.options, 'menu']).describe('"menu" is read as "dock", its name before.'),
  })
    .optional()
    .describe('What each region of the shell is. statusbar "merged" needs header "toolbar": the merged readouts ride the toolbar.'),
  bars: z
    .strictObject({
      'toolbar.left': entries(READOUT_IDS).describe('Readout ids: the toolbar\'s left end.'),
      'toolbar.center': entries(READOUT_IDS).describe('Readout ids: the toolbar\'s centre.'),
      'toolbar.right': entries(READOUT_IDS).describe('Readout ids: the toolbar\'s right end.'),
      format: entries([...COMMAND_IDS, ...TOOLBAR_ITEM_IDS]).describe(
        'The format bar (placed by regions.format): command ids, shown as buttons, and the grouped toolbar items.'
      ),
      'toolbar.format': entries([...COMMAND_IDS, ...TOOLBAR_ITEM_IDS]).describe('Read as "format", its name before.'),
      statusbar: entries(READOUT_IDS).describe('Readout ids: the bar under each pane (regions.statusbar "pane").'),
      status: entries(READOUT_IDS).describe(
        'Readout ids: the corner at the editor\'s bottom right (regions.status "corner"), by default the word and character counts.'
      ),
      tabs: entries(COMMAND_IDS).describe(
        'Command ids, shown as faint buttons at the end of every pane\'s tab strip (by default split right and split down).'
      ),
      selection: entries(COMMAND_IDS).describe(
        'The selection handle (regions.selection "on"): command ids drawn on a small pill at the end of a settled selection, by default Comment and Ask. An item whose command cannot run now is left out (ai.* until a provider is added).'
      ),
    })
    .partial()
    .optional()
    .describe(
      `Plain ids REPLACE the inherited list; "+id" appends, "-id" removes (a list is one or the other); "|" is a separator. ${Object.keys(READOUT_ALIASES)
        .map((id) => `"${id}"`)
        .join(' and ')} are read as "${PILL}". The "${PILL}" invariant, three rules: "${PILL}" must be in the bar on screen (one of the toolbar's groups when regions.statusbar is "merged", statusbar otherwise); regions.statusbar "merged" is refused unless regions.header is "toolbar"; focus.keep must keep the region whose bar carries it.`
    ),
  toolbar: partial(LAYOUT_SECTIONS.toolbar).optional(),
  dock: partial(LAYOUT_SECTIONS.dock)
    .optional()
    .describe('Where the floating dock sits when regions.rail is "dock".'),
  panes: partial(LAYOUT_SECTIONS.panes).optional(),
  views: entries(VIEW_KINDS)
    .optional()
    .describe(
      'Decides which view commands the command palette offers (same list grammar); an empty list offers every registered view.'
    ),
  editor: partial(LAYOUT_SECTIONS.editor).optional(),
  focus: z
    .strictObject({ keep: entries(REGION_IDS).optional().describe(
        `Regions Focus mode keeps on screen. Must keep the region whose bar carries "${PILL}" (toolbar when merged, statusbar otherwise).`
      ) })
    .optional(),
})

/** The one example keymap in `examples/` — the worked example in docs/customising.md. */
export const EXAMPLE_KEYMAP: KeymapFile = {
  $schema: KEYMAP_SCHEMA_ID,
  extends: 'default',
  bindings: {
    'daily.prev': 'Alt+ArrowLeft',
    'daily.next': 'Alt+ArrowRight',
    'nav.quick-open': ['Mod+o', 'Mod+k'],
    'format.link': 'Mod+Shift+k',
    'template.insert': 'Mod+Shift+i',
  },
}

function toSchema(schema: z.ZodType, name: string, description: string): string {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
  const { $schema, ...rest } = json
  const document = {
    $schema: ($schema as string | undefined) ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: `${SCHEMA_ID_BASE}/${name}.schema.json`,
    title: name,
    description,
    ...rest,
  }
  return JSON.stringify(document, null, 2) + '\n'
}

/** Every file `spec/` gains from the app, as `name → JSON text`. */
export function generateResourceSchemas(): Map<string, string> {
  return new Map([
    [
      `${LAYOUT_SCHEMA_ID}.schema.json`,
      toSchema(
        LayoutDocSchema,
        LAYOUT_SCHEMA_ID,
        'An Oh Hi markdown layout file: <vault>/.ohhi/layouts/<name>.json (or ~/.config/ohhi/layouts/ on desktop). A partial over the layout it extends. See docs/customising.md.'
      ),
    ],
    [
      `${KEYMAP_SCHEMA_ID}.schema.json`,
      toSchema(
        KeymapDocSchema,
        KEYMAP_SCHEMA_ID,
        'An Oh Hi markdown keymap file: <vault>/.ohhi/keymaps/<name>.json (or ~/.config/ohhi/keymaps/ on desktop). Overrides over the command table\'s default keys: a chord, several, or [] to unbind. See docs/customising.md.'
      ),
    ],
  ])
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2) + '\n'

/** Every file `examples/` holds, as `relative path → text`. */
export function generateExamples(): Map<string, string> {
  return new Map([
    ['layouts/default.json', pretty(PRESET_FILES.default)],
    ['layouts/dense.json', pretty(EXAMPLE_FILES.dense)],
    ['keymaps/my-keys.json', pretty(EXAMPLE_KEYMAP)],
  ])
}

/** The id catalogues docs/customising.md lists, by marker name. */
export const DOC_LISTS: Readonly<Record<string, readonly string[]>> = {
  'command-ids': COMMAND_IDS,
  'toolbar-item-ids': TOOLBAR_ITEM_IDS,
  'readout-ids': READOUT_IDS,
  'region-ids': REGION_IDS,
  'bar-ids': BAR_IDS,
  'view-ids': VIEW_KINDS,
}

const START = (name: string): string => `<!-- generated:${name} — rushx gen-schemas in apps/web; never hand-edit -->`
const END = '<!-- /generated -->'

/**
 * `docs/customising.md` with every generated list re-written between its
 * markers. A marker pair that is missing is left missing (the drift test
 * names it).
 */
export function renderDocLists(markdown: string): string {
  let out = markdown
  for (const [name, ids] of Object.entries(DOC_LISTS)) {
    const start = START(name)
    const from = out.indexOf(start)
    if (from === -1) continue
    const to = out.indexOf(END, from)
    if (to === -1) continue
    const body = ids.map((id) => `- \`${id}\``).join('\n')
    out = `${out.slice(0, from)}${start}\n${body}\n${out.slice(to)}`
  }
  return out
}
