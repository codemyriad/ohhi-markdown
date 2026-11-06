/**
 * The layout spec (quiet-shell-shaping F1, F2; foundations-plan Stage 1): what
 * the shell renders, as data. A layout FILE (`.ohhi/layouts/<name>.json`, the
 * one built-in `default` beside this module) is a partial that may `extends`
 * another by name and edit its lists with deltas; RESOLVING it yields a
 * complete `ShellSpec`, which is what the shell reads. A device's own edits
 * (Settings › Layout, round 3 Q6) are a file too — `config.layout.overrides`,
 * laid over the resolved spec by `applyOverrides`.
 *
 * List grammar, the same for every list field:
 *  - plain ids (`["words", "|", "sync"]`) REPLACE the inherited list;
 *  - `+id` appends `id` if it is absent, `-id` removes it, order preserved —
 *    a list holding any `+`/`-` entry is a delta over the inherited list;
 *  - `"|"` is a separator: in a replace list it sits where it is written, in a
 *    delta list (`"|"` or `"+|"`) it is appended; `"-|"` drops them all.
 *    Separators are collapsed and trimmed, so a removal never strands one.
 *
 * Pure: no runes, no I/O. The loader is `resources.svelte.ts`; the shell's
 * reactive copy is `shell-layout.svelte.ts`.
 */
import { z } from 'zod'
import { RESOURCE_NAME, parseJsonFile, walkExtends } from './resource-kind.js'
import defaultPreset from './layouts/default.json'
import denseExample from './layouts/examples/dense.json'

/** The built-in selection handle's items, for a complete file that predates `bars.selection`. */
const defaultSelection: readonly string[] = defaultPreset.bars.selection

export const LAYOUT_SCHEMA_ID = 'ohhi.layout.v1'
export const SEPARATOR = '|'

/**
 * The readout catalogue (F6): every id a readout bar may name. `note.pill`
 * and `people` are the two readouts `sync` merged (round 2, P5): still
 * accepted in a file, read as `sync` (`READOUT_ALIASES`).
 */
export const READOUT_IDS = [
  'nav',
  'title',
  'sync',
  'words',
  /** Round 3, Q4: the focused note's characters, beside `words` in the corner. */
  'chars',
  'reading-time',
  'mode',
  'vault.pill',
  'pane.lead',
  'daily.nav',
  'breadcrumb',
  'group.chip',
  'drawer',
  /** Chris, 2026-10-06: the inspector's door, beside the bell — drawn only while developer tools are on. */
  'inspector',
  /** first-run E1: the Help menu (guides, shortcuts, what's new, Report a problem, the version). */
  'help',
  /** Writing-harness B7: the in-app agent's last edit, "Tighten edited Plan 3 min ago"; drawn only once it has written. */
  'last-agent-write',
  /** Chris, 2026-10-15: the Session view's door, right after the shares drawer's — drawn only while a provider exists. */
  'session',
  /**
   * Nextcloud (`nextcloud-build` decision 8): whether the notes' files in
   * Nextcloud Files match — *In Files* / *N waiting* / *Blocked (423)* — from
   * the vault's custodian; drawn only while one is present.
   */
  'files',
  'note.pill',
  'people',
] as const
export type ReadoutId = (typeof READOUT_IDS)[number]

/** The readout that carries the open note's sync state: golden rule 4's id. */
export const PILL = 'sync' satisfies ReadoutId

/** Readout ids a file may still name, and the id each is read as. */
export const READOUT_ALIASES: Readonly<Record<string, ReadoutId>> = { 'note.pill': PILL, people: PILL }

const ALIAS_TARGETS = new Set<string>(Object.values(READOUT_ALIASES))

/** Regions Focus mode (F7) can keep. */
export const REGION_IDS = ['toolbar', 'header', 'navigator', 'rail', 'tabs', 'statusbar', 'format', 'status'] as const
export type RegionId = (typeof REGION_IDS)[number]

export const BAR_IDS = ['toolbar.left', 'toolbar.center', 'toolbar.right', 'format', 'statusbar', 'status', 'tabs', 'selection'] as const
export type BarId = (typeof BAR_IDS)[number]

/**
 * The bars that hold COMMAND ids, drawn as buttons (`format`, the tab
 * strip's end, `tabs` — E6's split buttons — and the selection handle,
 * `selection`); every other bar holds readout ids.
 */
export const COMMAND_BARS: readonly BarId[] = ['format', 'tabs', 'selection']

/** The toolbar's three readout groups: merged readouts may ride any of them. */
export const TOOLBAR_BARS = ['toolbar.left', 'toolbar.center', 'toolbar.right'] as const

/**
 * The built-in layout names; anything else is `custom:<name>`. One since
 * round 3 (Q6): `default` — a device's own changes are overrides over it,
 * never a second built-in.
 */
export const BUILTIN_LAYOUTS = ['default'] as const
export type BuiltinLayout = (typeof BUILTIN_LAYOUTS)[number]

/**
 * Built-in names that are gone, and what they are read as: `light` was
 * `default`'s name in round 2; `dense` was a second built-in until round 3
 * (Q6) — it is an example file now (`examples/layouts/dense.json`), so a
 * stored choice or an `extends` naming it reads as `default`, and says so
 * once on the console. A file's `extends` and a device's stored choice both
 * go through this.
 */
export const LAYOUT_ALIASES: Readonly<Record<string, BuiltinLayout>> = { light: 'default', dense: 'default' }

let warnedDense = false

/** A layout name with a retired built-in read as the one there is. */
export function layoutAlias(name: string): string {
  if (!Object.hasOwn(LAYOUT_ALIASES, name)) return name
  if (name === 'dense' && !warnedDense) {
    warnedDense = true
    console.warn(
      'The "dense" layout is no longer built in: "default" is in use. examples/layouts/dense.json is the same layout as a file — copy it to .ohhi/layouts/ to keep it.'
    )
  }
  return LAYOUT_ALIASES[name]!
}

/** A name a person can save a layout under (and the file's basename): the one resource-name rule. */
export const LAYOUT_NAME = RESOURCE_NAME

// ---------------------------------------------------------------------------
// The resolved spec
// ---------------------------------------------------------------------------

const regions = {
  header: z.enum(['toolbar', 'breadcrumb']),
  navigator: z.enum(['column', 'drawer', 'off']),
  /** `dock` (was `menu`): the floating icon strip and its panel; `column`: the rail. */
  rail: z.enum(['dock', 'column']),
  tabs: z.enum(['auto', 'always']),
  statusbar: z.enum(['pane', 'merged']),
  /** The format bar: under the panes (above a bottom toolbar), under the header, or none. */
  format: z.enum(['bottom', 'top', 'off']),
  /** Round 3, Q4: `bars.status` floating at the editor's bottom right (Obsidian's word count), or none. */
  status: z.enum(['corner', 'off']),
  /**
   * The selection handle (selection explorations, shape B): `bars.selection`
   * on a small pill at the end of a settled selection, or none. Beside the
   * format bar, never instead of it.
   */
  selection: z.enum(['on', 'off']),
}
const toolbar = { position: z.enum(['top', 'bottom']) }
const dock = { position: z.enum(['top-right', 'bottom-right']) }
const panes = {
  borders: z.enum(['hairline', 'none']),
  focusMark: z.boolean(),
  lead: z.boolean(),
  open: z.enum(['tab', 'replace']),
}
const editor = {
  measure: z.enum(['narrow', 'comfortable', 'wide']),
  typewriter: z.boolean(),
  /** The note's title as an editable heading at the top of its body (P3). */
  inlineTitle: z.boolean(),
}

/** The scalar sections, for the documented schema (`resource-schemas.ts`, F16). */
export const LAYOUT_SECTIONS = { regions, toolbar, dock, panes, editor } as const


const readoutList = z.array(z.union([z.enum(READOUT_IDS), z.literal(SEPARATOR)]))
/** Format ids are checked against the command registry at runtime, not here. */
const commandList = z.array(z.string().min(1))

/**
 * Which bar is on screen for the open note's sync state: golden rule 4 in the
 * file format. Merged readouts ride the toolbar, and the toolbar is drawn only
 * when it is the header — so `merged` puts the pill on the toolbar only under
 * `header: "toolbar"`; anything else is the pane status bar (and `merged`
 * without the toolbar header is refused outright: no bar would carry it).
 * `toolbar.right` names the toolbar: `sync` may sit in any of its three
 * groups (`carriesPill`), and `withPill` adds it to the right one.
 */
export function pillBar(spec: Pick<ShellSpec, 'regions'>): 'statusbar' | 'toolbar.right' {
  return spec.regions.statusbar === 'merged' && spec.regions.header === 'toolbar' ? 'toolbar.right' : 'statusbar'
}

/** `merged` status bars with no toolbar header: every pane's bar is gone and nothing else is drawn. */
export const pillHomeless = (spec: Pick<ShellSpec, 'regions'>): boolean =>
  spec.regions.statusbar === 'merged' && spec.regions.header !== 'toolbar'

/**
 * The Focus-mode region that bar lives in: the pane status bar, or the
 * toolbar the merged readouts ride on. Focus mode (F7) hides every region
 * outside `focus.keep`, so this one must be kept or the pill goes with it.
 */
export function pillRegion(spec: Pick<ShellSpec, 'regions'>): 'statusbar' | 'toolbar' {
  return pillBar(spec) === 'statusbar' ? 'statusbar' : 'toolbar'
}

/** Whether the bar on screen (`pillBar`) carries `sync` — any of the toolbar's groups, when it is the toolbar. */
export function carriesPill(spec: Pick<ShellSpec, 'regions' | 'bars'>): boolean {
  const bars: readonly BarId[] = pillBar(spec) === 'statusbar' ? ['statusbar'] : TOOLBAR_BARS
  return bars.some((bar) => spec.bars[bar].includes(PILL))
}

// ---------------------------------------------------------------------------
// Reading older files: renamed keys, values and ids
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A list's entries with every aliased readout id (bare, `+id` or `-id`) read as its new id; repeats dropped. */
function upgradeList(list: unknown): unknown {
  if (!Array.isArray(list)) return list
  const out: unknown[] = []
  for (const entry of list) {
    if (typeof entry !== 'string') {
      out.push(entry)
      continue
    }
    const sign = /^[+-]/.test(entry) ? entry[0]! : ''
    const id = entry.slice(sign.length)
    const now = Object.hasOwn(READOUT_ALIASES, id) ? READOUT_ALIASES[id]! : id
    // `["people", "note.pill"]` is one `sync`, not two.
    if (now !== id || ALIAS_TARGETS.has(now)) {
      if (out.includes(`${sign}${now}`)) continue
    }
    out.push(`${sign}${now}`)
  }
  return out
}

/**
 * A layout file or spec as written before round 2, read as today's: the
 * format bar's key `toolbar.format` → `format`, `regions.rail: "menu"` →
 * `"dock"`, the `note.pill` / `people` readouts → `sync`, and `extends:
 * "default"` → `"light"`. Anything already current passes through as it is;
 * the input is never mutated. Applied by both schemas, so every reader sees
 * one shape.
 */
export function upgradeLayout(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  if (typeof out.extends === 'string') out.extends = layoutAlias(out.extends)
  if (isRecord(out.regions) && out.regions.rail === 'menu') out.regions = { ...out.regions, rail: 'dock' }
  if (isRecord(out.bars)) {
    const bars: Record<string, unknown> = { ...out.bars }
    if ('toolbar.format' in bars) {
      if (!('format' in bars)) bars.format = bars['toolbar.format']
      delete bars['toolbar.format']
    }
    for (const bar of Object.keys(bars)) if (!(COMMAND_BARS as readonly string[]).includes(bar)) bars[bar] = upgradeList(bars[bar])
    out.bars = bars
  }
  return out
}

export const ShellSpecSchema = z.preprocess(
  upgradeLayout,
  z
    .strictObject({
      $schema: z.literal(LAYOUT_SCHEMA_ID),
      regions: z.strictObject(regions),
      bars: z.strictObject({
        'toolbar.left': readoutList,
        'toolbar.center': readoutList,
        'toolbar.right': readoutList,
        format: commandList,
        statusbar: readoutList,
        status: readoutList,
        tabs: commandList,
        selection: commandList,
      }),
      toolbar: z.strictObject(toolbar),
      dock: z.strictObject(dock),
      panes: z.strictObject(panes),
      views: z.array(z.string().min(1)),
      editor: z.strictObject(editor),
      focus: z.strictObject({ keep: z.array(z.enum(REGION_IDS)) }),
    })
    .superRefine((spec, ctx) => {
      if (pillHomeless(spec)) {
        ctx.addIssue({
          code: 'custom',
          path: ['regions', 'statusbar'],
          message: `"merged" needs regions.header "toolbar": the merged readouts ride the toolbar, and with the "${spec.regions.header}" header no bar would carry "${PILL}"`,
        })
        return
      }
      const bar = pillBar(spec)
      if (!carriesPill(spec)) {
        ctx.addIssue({
          code: 'custom',
          path: ['bars', bar],
          message:
            bar === 'statusbar'
              ? `"${PILL}" must be in bars.statusbar: it is the bar on screen when regions.statusbar is "${spec.regions.statusbar}"`
              : `"${PILL}" must be in the toolbar (bars.toolbar.left, toolbar.center or toolbar.right): it is the bar on screen when regions.statusbar is "${spec.regions.statusbar}"`,
        })
      }
      // …and Focus mode may not hide that bar: the pill is on screen in every mode.
      const region = pillRegion(spec)
      if (!spec.focus.keep.includes(region)) {
        ctx.addIssue({
          code: 'custom',
          path: ['focus', 'keep'],
          message: `"${region}" must be in focus.keep: it carries "${PILL}" when regions.statusbar is "${spec.regions.statusbar}", and Focus mode would hide the open note's sync state`,
        })
      }
    })
)

export type ShellSpec = z.output<typeof ShellSpecSchema>

/**
 * Whether the layout offers a view kind (`views`): its palette command is
 * registered only then. An empty list offers every view.
 */
export function offersView(spec: Pick<ShellSpec, 'views'>, id: string): boolean {
  return spec.views.length === 0 || spec.views.includes(id)
}

// ---------------------------------------------------------------------------
// The file (a partial, with `extends` and deltas)
// ---------------------------------------------------------------------------

const DELTA = /^[+-]/
const isDeltaList = (entries: readonly string[]): boolean => entries.some((e) => DELTA.test(e))
const bareId = (entry: string): string => entry.replace(DELTA, '')

/** A list field of a file: plain ids (replace) or deltas, never both. */
function listOf(valid?: readonly string[]) {
  return z
    .array(
      z
        .string()
        .min(1)
        .refine(
          (entry) => {
            const id = bareId(entry)
            return id === SEPARATOR || (id.length > 0 && (!valid || valid.includes(id)))
          },
          { message: valid ? `not one of: ${valid.join(', ')}` : 'empty id' }
        )
    )
    .refine(
      (entries) =>
        !isDeltaList(entries) || entries.every((e) => DELTA.test(e) || e === SEPARATOR),
      { message: 'a list is either plain ids (replace) or +id / -id deltas, not both' }
    )
}

const partial = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape).partial()

/** A layout file, read through `upgradeLayout`: an older file loads as today's shape. */
export const LayoutFileSchema = z.preprocess(
  upgradeLayout,
  z.strictObject({
    $schema: z.literal(LAYOUT_SCHEMA_ID),
    extends: z.string().min(1).optional(),
    regions: partial(regions).optional(),
    bars: z
      .strictObject({
        'toolbar.left': listOf(READOUT_IDS),
        'toolbar.center': listOf(READOUT_IDS),
        'toolbar.right': listOf(READOUT_IDS),
        format: listOf(),
        statusbar: listOf(READOUT_IDS),
        status: listOf(READOUT_IDS),
        tabs: listOf(),
        selection: listOf(),
      })
      .partial()
      .optional(),
    toolbar: partial(toolbar).optional(),
    dock: partial(dock).optional(),
    panes: partial(panes).optional(),
    views: listOf().optional(),
    editor: partial(editor).optional(),
    focus: z.strictObject({ keep: listOf(REGION_IDS).optional() }).optional(),
  })
)

export type LayoutFile = z.output<typeof LayoutFileSchema>

export class LayoutError extends Error {
  readonly name = 'LayoutError'
}

/** Read a layout file's text (or an already-parsed value) into a validated partial. */
export function parseSpec(json: unknown): { ok: true; spec: LayoutFile } | { ok: false; error: string } {
  const parsed = parseJsonFile(LayoutFileSchema, json)
  return parsed.ok ? { ok: true, spec: parsed.value } : parsed
}

// ---------------------------------------------------------------------------
// Lists, resolution, diff
// ---------------------------------------------------------------------------

/** Collapse runs of separators and trim them from both ends. */
function tidy(list: readonly string[]): string[] {
  const out: string[] = []
  for (const id of list) {
    if (id === SEPARATOR && (out.length === 0 || out[out.length - 1] === SEPARATOR)) continue
    out.push(id)
  }
  while (out[out.length - 1] === SEPARATOR) out.pop()
  return out
}

/** Apply one list field of a file over the inherited list (see the grammar above). */
export function applyList(base: readonly string[], entries: readonly string[]): string[] {
  if (!isDeltaList(entries)) return tidy(entries)
  let out = [...base]
  for (const entry of entries) {
    if (entry === SEPARATOR || entry === `+${SEPARATOR}`) out.push(SEPARATOR)
    else if (entry === `-${SEPARATOR}`) out = out.filter((id) => id !== SEPARATOR)
    else if (entry.startsWith('+')) {
      const id = entry.slice(1)
      if (!out.includes(id)) out.push(id)
    } else {
      const id = entry.slice(1)
      out = out.filter((x) => x !== id)
    }
  }
  return tidy(out)
}

type Loose = {
  regions?: Record<string, unknown>
  bars?: Record<string, string[]>
  toolbar?: Record<string, unknown>
  dock?: Record<string, unknown>
  panes?: Record<string, unknown>
  views?: string[]
  editor?: Record<string, unknown>
  focus?: { keep?: string[] }
}

const SCALAR_SECTIONS = ['regions', 'toolbar', 'dock', 'panes', 'editor'] as const

function merge(base: Loose, file: LayoutFile): Loose {
  const out: Loose = {}
  for (const section of SCALAR_SECTIONS) {
    const over = file[section]
    if (base?.[section] || over) out[section] = { ...base?.[section], ...over }
  }
  const bars: Record<string, string[]> = { ...base?.bars }
  for (const bar of BAR_IDS) {
    const over = file.bars?.[bar]
    if (over) bars[bar] = applyList(base?.bars?.[bar] ?? [], over)
  }
  out.bars = bars
  if (file.views) out.views = applyList(base?.views ?? [], file.views)
  else if (base?.views) out.views = base.views
  const keep = file.focus?.keep
  if (keep) out.focus = { keep: applyList(base?.focus?.keep ?? [], keep) }
  else if (base?.focus) out.focus = base.focus
  return out
}


/**
 * The bottom layer every resolution starts from: what a file that predates a
 * field gets for it — the fields round 2 added — so a complete file written
 * before them (no `extends`) still resolves.
 */
const defaultsLayer = (): Loose => ({
  regions: { format: 'bottom', status: 'corner', selection: 'on' },
  dock: { position: 'top-right' },
  editor: { inlineTitle: true },
  // A complete file written before the selection handle gets the built-in's items.
  bars: { 'toolbar.center': [], format: [], status: ['words', 'chars'], tabs: [], selection: [...defaultSelection] },
})

/**
 * A file → the complete spec: `extends` applied recursively over `presets`
 * (by name; a cycle or an unknown name is refused — a renamed built-in,
 * `default`, is found under its new name), then this file's own values and
 * deltas. Throws a `LayoutError` saying what is wrong when the result is not
 * a valid `ShellSpec` — including the `sync` rule.
 *
 * `self` names the file being resolved, so a file that extends itself is a
 * cycle rather than an infinite walk.
 */
export function resolveSpec(
  file: LayoutFile,
  presets: Readonly<Record<string, LayoutFile>>,
  self?: string
): ShellSpec {
  // A file built in code (not read through the schema) may still say `extends: "default"`.
  const files: Record<string, LayoutFile> = { ...presets }
  for (const [old, now] of Object.entries(LAYOUT_ALIASES)) {
    if (!Object.hasOwn(files, old) && Object.hasOwn(files, now)) files[old] = files[now]!
  }
  const layers = walkExtends(file, files, {
    ...(self ? { self } : {}),
    what: 'layout',
    fail: (message) => new LayoutError(message),
  })
  // …or an old readout id: every layer is read as today's shape.
  const loose = layers.reduce<Loose>((base, layer) => merge(base, upgradeLayout(layer) as LayoutFile), defaultsLayer())
  const parsed = parseJsonFile(ShellSpecSchema, { $schema: LAYOUT_SCHEMA_ID, ...loose })
  if (!parsed.ok) throw new LayoutError(parsed.error)
  return parsed.value
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** The shortest list entry that turns `base` into `next`: a delta when one exists and is shorter. */
function diffList(base: readonly string[], next: readonly string[]): string[] | undefined {
  if (sameList(base, next)) return undefined
  const removals = [...new Set(base)]
    .filter((id) => id !== SEPARATOR && !next.includes(id))
    .map((id) => `-${id}`)
  const kept = removals.length > 0 ? applyList(base, removals) : tidy(base)
  // What is left of the base must be the head of the result, in order.
  if (sameList(kept, next.slice(0, kept.length))) {
    const added = next.slice(kept.length).map((id) => (id === SEPARATOR ? SEPARATOR : `+${id}`))
    const delta = [...removals, ...added]
    if (delta.length > 0 && delta.length < next.length && sameList(applyList(base, delta), next)) return delta
  }
  return [...next]
}

/**
 * The minimal file that, extending `base` (named `extendsName`), resolves to
 * `full`: only what differs, lists as deltas when that is shorter. What
 * *Save as* writes, so a hand-read `git diff` shows the choice and nothing else.
 */
export function diffSpec(base: ShellSpec, full: ShellSpec, extendsName?: string): LayoutFile {
  const out: LayoutFile = { $schema: LAYOUT_SCHEMA_ID }
  if (extendsName) out.extends = extendsName
  for (const section of SCALAR_SECTIONS) {
    const changed: Record<string, unknown> = {}
    const from = base[section] as Record<string, unknown>
    const to = full[section] as Record<string, unknown>
    for (const key of Object.keys(to)) if (to[key] !== from[key]) changed[key] = to[key]
    if (Object.keys(changed).length > 0) (out as Record<string, unknown>)[section] = changed
  }
  const bars: Record<string, string[]> = {}
  for (const bar of BAR_IDS) {
    const d = diffList(base.bars[bar], full.bars[bar])
    if (d) bars[bar] = d
  }
  if (Object.keys(bars).length > 0) out.bars = bars
  const views = diffList(base.views, full.views)
  if (views) out.views = views
  const keep = diffList(base.focus.keep, full.focus.keep)
  if (keep) out.focus = { keep: keep as RegionId[] }
  return out
}

/**
 * Keep the `sync` rule true after a region change in *Customise*: a
 * `merged` status bar under a header that is not the toolbar goes back to
 * `pane` (nothing else would be on screen), the pill is added to whichever
 * bar the spec now puts on screen, and that bar's region to what Focus mode keeps.
 */
export function withPill(spec: ShellSpec): ShellSpec {
  let out = pillHomeless(spec) ? { ...spec, regions: { ...spec.regions, statusbar: 'pane' as const } } : spec
  const bar = pillBar(out)
  const region = pillRegion(out)
  if (!carriesPill(out)) out = { ...out, bars: { ...out.bars, [bar]: [...out.bars[bar], PILL] } }
  if (!out.focus.keep.includes(region)) out = { ...out, focus: { ...out.focus, keep: [...out.focus.keep, region] } }
  return out
}

// ---------------------------------------------------------------------------
// A device's overrides (round 3, Q6)
// ---------------------------------------------------------------------------

/** No overrides: the file as it is. */
export const NO_OVERRIDES: LayoutFile = { $schema: LAYOUT_SCHEMA_ID }

/**
 * Tolerant read of a device's stored overrides (`config.layout.overrides`):
 * anything that is not a valid layout file is no overrides at all, and an
 * `extends` is dropped — overrides lay over whatever file is active.
 */
export function normalizeOverrides(raw: unknown): LayoutFile {
  if (raw === null || typeof raw !== 'object') return NO_OVERRIDES
  const parsed = LayoutFileSchema.safeParse({ ...(raw as object), $schema: LAYOUT_SCHEMA_ID })
  if (!parsed.success) return NO_OVERRIDES
  const { extends: _drop, ...own } = parsed.data
  return own
}

/** True when the overrides change nothing (only `$schema`). */
export const hasOverrides = (overrides: LayoutFile): boolean =>
  Object.keys(overrides).some((key) => key !== '$schema' && key !== 'extends')

/**
 * The resolved spec with a device's overrides laid over it — the same
 * merge a file's own values get over the file it extends. The `sync` rule
 * still holds (`withPill`): an override can move the pill's bar, never take
 * it off the screen. Overrides that cannot apply are ignored (the spec as
 * it was); the same object back when there is nothing to apply.
 */
export function applyOverrides(spec: ShellSpec, overrides: LayoutFile): ShellSpec {
  if (!hasOverrides(overrides)) return spec
  const loose = merge(spec as unknown as Loose, upgradeLayout(overrides) as LayoutFile)
  const parsed = ShellSpecSchema.safeParse({ $schema: LAYOUT_SCHEMA_ID, ...loose })
  if (parsed.success) return parsed.data
  const unchecked = { $schema: LAYOUT_SCHEMA_ID, ...loose } as ShellSpec
  const repaired = ShellSpecSchema.safeParse(withPill(unchecked))
  return repaired.success ? repaired.data : spec
}

/**
 * The overrides that turn `base` (the active file, resolved) into `next`:
 * only what differs (`diffSpec`, no `extends`). What Settings › Layout
 * stores after every change, so a field set back to the file's own value
 * stops being an override.
 */
export const overridesFor = (base: ShellSpec, next: ShellSpec): LayoutFile => diffSpec(base, withPill(next))

// ---------------------------------------------------------------------------
// The built-in and the examples
// ---------------------------------------------------------------------------

/** The shipped file, as a file (what a vault file may `extends`). */
export const PRESET_FILES: Readonly<Record<BuiltinLayout, LayoutFile>> = {
  default: LayoutFileSchema.parse(defaultPreset),
}

/** The built-in, resolved. */
export const PRESETS: Readonly<Record<BuiltinLayout, ShellSpec>> = {
  default: resolveSpec(PRESET_FILES.default, PRESET_FILES, 'default'),
}

/**
 * Example layout files (`examples/layouts/`, generated from these): written
 * for an agent or a person to copy into `.ohhi/layouts/`, never built in —
 * not listed, never offered in Settings. `dense` is the shell before
 * round 2 (both columns, a status bar per pane); the e2e fixtures boot it
 * with `?layout=dense`, which the built-in root still answers (`resources`).
 */
export const EXAMPLE_FILES: Readonly<Record<'dense', LayoutFile>> = {
  dense: LayoutFileSchema.parse(denseExample),
}

/** The examples, resolved over the built-in. */
export const EXAMPLES: Readonly<Record<keyof typeof EXAMPLE_FILES, ShellSpec>> = {
  dense: resolveSpec(EXAMPLE_FILES.dense, PRESET_FILES, 'dense'),
}

/** The spec a built-in or example NAME resolves to without reading any root; null for any other name. */
export function shippedSpec(name: string): ShellSpec | null {
  if (Object.hasOwn(PRESETS, name)) return PRESETS[name as BuiltinLayout]
  if (Object.hasOwn(EXAMPLES, name)) return EXAMPLES[name as keyof typeof EXAMPLES]
  return null
}
