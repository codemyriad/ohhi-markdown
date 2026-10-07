/**
 * The resource loader (quiet-shell F8, spike-resource-root Q4): one kind of
 * person- or agent-authored file — `layouts`, `keymaps` (F10) and
 * `templates` (F11); themes are the same shape later — read from ORDERED roots:
 *
 *   1. the vault's `.ohhi/<kind>/`   (travels with the folder; git, Dropbox)
 *   2. the user root `<config>/ohhi/<kind>/` — desktop only (`~/.config/ohhi`)
 *   3. built-in                       (the `default` layout beside `layout-spec.ts`, the
 *                                      `default` keymap, `templates/*.md`)
 *
 * The first root that has a name wins: **the vault wins over the user root**
 * (Fork 8, Pi's project-over-user). The device holds only the CHOICE
 * (`config.layout.active`, set by the palette's *Use layout file…*) and its
 * own overrides (`config.layout.overrides`, Settings › Layout); the files are
 * data, never code.
 *
 * A runes module built by a factory over an explicit host, so a test drives
 * it with fake roots.
 */
import { untrack } from 'svelte'
import { getLL } from '@ohhi/i18n'
import type { LayoutChoice } from './layout.js'
import { layoutName } from './layout.js'
import {
  BUILTIN_LAYOUTS,
  EXAMPLE_FILES,
  LayoutError,
  LayoutFileSchema,
  NO_OVERRIDES,
  PRESET_FILES,
  applyOverrides,
  layoutAlias,
  PRESETS,
  resolveSpec,
  type LayoutFile,
  type ShellSpec,
} from './layout-spec.js'
import {
  BUILTIN_KEYMAP_FILES,
  BUILTIN_KEYMAPS,
  KeymapError,
  KeymapFileSchema,
  keymapFile,
  keymapName,
  ownBindings,
  resolveKeymap,
  type KeymapBindings,
  type KeymapChoice,
  type KeymapFile,
} from './keymap-spec.js'
import { MAX_EXTENDS_DEPTH, RESOURCE_NAME, parseJsonFile, savableName } from './resource-kind.js'
import { BUILTIN_TEMPLATES } from './template.js'
import { applyPins, type LayoutPins } from './pin-layout.js'

export const RESOURCE_KINDS = ['layouts', 'keymaps', 'templates'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** The file extension each kind is stored with. */
const KIND_EXT: Record<ResourceKind, string> = { layouts: '.json', keymaps: '.json', templates: '.md' }

export type RootId = 'vault' | 'user' | 'builtin'

/** One root's view of the resource tree: basenames in, text out. */
export interface ResourceRoot {
  id: RootId
  /** Where a kind lives in this root, as a person would type it (shown in Settings). */
  location(kind: ResourceKind): string
  /** File basenames (with extension) directly in this root's `<kind>/`. */
  list(kind: ResourceKind): Promise<string[]>
  read(kind: ResourceKind, file: string): Promise<string | null>
}

/** The open vault's side of the resource tree: `Workspace`'s app-file trio, and its `.ohhi/` change feed. */
export interface VaultAppFiles {
  readAppFile(path: string): Promise<string | null>
  listAppDir(dir: string): Promise<string[]>
  writeAppFile(path: string, text: string): Promise<void>
  /** Remove a file under `.ohhi/` (journaled first); absent → deleting is not offered. */
  deleteAppFile?(path: string): Promise<void>
  /** Absent → no watcher (a test, the browser's OPFS); `app.reload-resources` is the way back. */
  onAppFileChange?(prefix: string, cb: (paths: string[]) => void): () => void
}

/**
 * Why a kind's files should be read again: another vault (or none) is open,
 * a file under `.ohhi/<kind>/` changed, or `app.reload-resources` asked.
 */
export type ResourceChange = 'open' | 'change' | 'reload'

export interface ResourceEntry {
  /** The name it is chosen by (`writing` for `writing.json`). */
  name: string
  /** The root it is read from — the first that has it. */
  root: RootId
  /** The file, for Settings: `.ohhi/layouts/writing.json`, `built-in`, … */
  path: string
  /** Lower roots that have the same name and lose to this one. */
  shadows: RootId[]
}

export interface ResourcesHost {
  /** The open vault's app files; null between vaults. */
  vault(): VaultAppFiles | null
  /** The user root — desktop only; resolves to null in the browser. */
  userRoot(): Promise<ResourceRoot | null>
  /** A layout (or keymap) file could not be used; the shell falls back and says so. */
  warn(name: string, error: string, kind?: ResourceKind): void
}

/** `.ohhi/<kind>` in the open vault, through the workspace's guarded app-file calls. */
export function vaultRoot(files: VaultAppFiles): ResourceRoot {
  const dir = (kind: ResourceKind): string => `.ohhi/${kind}`
  return {
    id: 'vault',
    location: dir,
    list: async (kind) =>
      (await files.listAppDir(dir(kind)).catch(() => [] as string[])).map((p) => p.slice(p.lastIndexOf('/') + 1)),
    read: (kind, file) => files.readAppFile(`${dir(kind)}/${file}`).catch(() => null),
  }
}

/** The built-in files of each kind, basename → text. */
function builtinFiles(kind: ResourceKind): Record<string, string> {
  if (kind === 'layouts') {
    return Object.fromEntries(BUILTIN_LAYOUTS.map((n) => [`${n}.json`, JSON.stringify(PRESET_FILES[n])]))
  }
  if (kind === 'keymaps') {
    return Object.fromEntries(BUILTIN_KEYMAPS.map((n) => [`${n}.json`, JSON.stringify(BUILTIN_KEYMAP_FILES[n])]))
  }
  return Object.fromEntries(Object.entries(BUILTIN_TEMPLATES).map(([n, text]) => [`${n}.md`, text]))
}

/**
 * Files the built-in root answers by name but never lists: the example
 * layouts (`dense`), so `?layout=dense` — the e2e fixtures' boot — still
 * resolves, while nothing offers them as a built-in.
 */
function unlistedFiles(kind: ResourceKind): Record<string, string> {
  if (kind !== 'layouts') return {}
  return Object.fromEntries(Object.entries(EXAMPLE_FILES).map(([n, f]) => [`${n}.json`, JSON.stringify(f)]))
}

/** The `default` layout and keymap and the example templates shipped with the app. */
export const builtinRoot: ResourceRoot = {
  id: 'builtin',
  location: () => 'built-in',
  list: async (kind) => Object.keys(builtinFiles(kind)),
  read: async (kind, file) => {
    const files = { ...unlistedFiles(kind), ...builtinFiles(kind) }
    return Object.hasOwn(files, file) ? files[file]! : null
  },
}

/** What a resolved keymap came from, for Settings and the registry. */
export interface ResolvedKeymap {
  /** The bindings in force: the file over its `extends` chain. Empty = the defaults. */
  bindings: KeymapBindings
  /** What the file's parent chain alone resolves to — a row Reset goes back to this. */
  parent: KeymapBindings
  /** The active file as read (its own bindings are what Settings edits). */
  file: KeymapFile
  /** The entry that was resolved; null when it fell back to the built-in default. */
  entry: ResourceEntry | null
  /** Why it fell back, when it did. */
  error: string | null
}

/** What a resolved layout came from, for Settings and the notice. */
export interface ResolvedLayout {
  /** What the shell renders: the file's spec, this device's overrides, then its pins (`applyPins`). */
  spec: ShellSpec
  /** The file's spec with the overrides, before the pins; absent → the same as `spec`. */
  unpinned?: ShellSpec
  /** The file's own spec, before the overrides and the pins; absent → `unpinned`. */
  file?: ShellSpec
  /** The entry that was resolved; null when it fell back to the built-in default. */
  entry: ResourceEntry | null
  /** Why it fell back, when it did. */
  error: string | null
}

/** What the loader needs to know about a JSON kind: everything else is the same pipeline. */
interface JsonKind<F extends { extends?: string | undefined }> {
  kind: 'layouts' | 'keymaps'
  builtins: readonly string[]
  /** A retired built-in's name → the one there is (`light`, `dense` → `default`); absent → names are as written. */
  alias?(name: string): string
  parse(json: unknown): { ok: true; value: F } | { ok: false; error: string }
  fail(message: string): Error
  text(): { not_found(p: { name: string }): string; needs_vault(): string; bad_name(): string }
}

const LAYOUTS: JsonKind<LayoutFile> = {
  kind: 'layouts',
  builtins: BUILTIN_LAYOUTS,
  alias: layoutAlias,
  parse: (json) => parseJsonFile(LayoutFileSchema, json),
  fail: (message) => new LayoutError(message),
  text: () => getLL().web.layouts,
}

const KEYMAPS: JsonKind<KeymapFile> = {
  kind: 'keymaps',
  builtins: BUILTIN_KEYMAPS,
  parse: (json) => parseJsonFile(KeymapFileSchema, json),
  fail: (message) => new KeymapError(message),
  text: () => getLL().web.keymaps,
}

const sameChords = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((x, i) => x === b[i])

export function createResources(host: ResourcesHost) {
  /** The layouts every root offers, winners only, sorted built-ins first. */
  let layouts = $state<ResourceEntry[]>(BUILTIN_LAYOUTS.map((name) => builtinEntry('layouts', name)))
  /** The keymaps every root offers, the same way (F10). */
  let keymaps = $state<ResourceEntry[]>(BUILTIN_KEYMAPS.map((name) => builtinEntry('keymaps', name)))

  function builtinEntry(kind: ResourceKind, name: string): ResourceEntry {
    return { name, root: 'builtin', path: builtinRoot.location(kind), shadows: [] }
  }

  async function roots(): Promise<ResourceRoot[]> {
    const out: ResourceRoot[] = []
    const vault = host.vault()
    if (vault) out.push(vaultRoot(vault))
    const user = await host.userRoot().catch(() => null)
    if (user) out.push(user)
    out.push(builtinRoot)
    return out
  }

  /** Every name in a kind across the roots; the first root that has it wins. */
  async function list(kind: ResourceKind, over?: readonly ResourceRoot[]): Promise<ResourceEntry[]> {
    const ext = KIND_EXT[kind]
    const byName = new Map<string, ResourceEntry>()
    for (const root of over ?? (await roots())) {
      const files = await root.list(kind).catch(() => [] as string[])
      for (const file of files) {
        if (!file.endsWith(ext)) continue
        const name = file.slice(0, -ext.length)
        if (!RESOURCE_NAME.test(name)) continue
        const won = byName.get(name)
        if (won) won.shadows.push(root.id)
        else {
          const path = root.id === 'builtin' ? root.location(kind) : `${root.location(kind)}/${file}`
          byName.set(name, { name, root: root.id, path, shadows: [] })
        }
      }
    }
    const rank = (e: ResourceEntry): number => (e.root === 'builtin' ? 0 : 1)
    return [...byName.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }

  /**
   * The text of `name` from the first root that has it, searching from root
   * `from` down (a file that extends its own name reads the one it shadows).
   */
  async function read(
    kind: ResourceKind,
    name: string,
    from = 0
  ): Promise<{ text: string; entry: ResourceEntry; index: number } | null> {
    const file = `${name}${KIND_EXT[kind]}`
    const all = await roots()
    for (let i = from; i < all.length; i++) {
      const root = all[i]!
      const text = await root.read(kind, file).catch(() => null)
      if (text === null) continue
      const shadows: RootId[] = []
      for (const lower of all.slice(i + 1)) {
        if ((await lower.list(kind).catch(() => [] as string[])).includes(file)) shadows.push(lower.id)
      }
      const path = root.id === 'builtin' ? root.location(kind) : `${root.location(kind)}/${file}`
      return { text, entry: { name, root: root.id, path, shadows }, index: i }
    }
    return null
  }

  /** Read and validate one file of a JSON kind by name, or throw the kind's error saying why not. */
  async function readFile<F extends { extends?: string | undefined }>(
    def: JsonKind<F>,
    name: string,
    from = 0
  ): Promise<{ file: F; entry: ResourceEntry; index: number }> {
    // A renamed built-in (`default`) is found under its new name when no root has a file by the old one.
    let found = await read(def.kind, name, from)
    if (!found) {
      const aliased = def.alias?.(name) ?? name
      if (aliased !== name) found = await read(def.kind, aliased, from)
    }
    if (!found) throw def.fail(def.text().not_found({ name }))
    const parsed = def.parse(found.text)
    if (!parsed.ok) throw def.fail(`${found.entry.path}: ${parsed.error}`)
    return { file: parsed.value, entry: found.entry, index: found.index }
  }

  /**
   * The winning file for `name` (searching from root `from` down) and every
   * file its `extends` chain names, read through the same roots — what a
   * kind's pure resolver walks. A file that extends its OWN name
   * (`.ohhi/layouts/default.json` with `"extends": "default"`) extends the
   * file it shadows, keyed `<name>@<root>`; any other cycle is left for the
   * resolver to name. Throws the kind's error when a file cannot be read.
   */
  async function readChain<F extends { extends?: string | undefined }>(
    def: JsonKind<F>,
    name: string,
    from = 0
  ): Promise<{ file: F; root: F; chain: Record<string, F>; entry: ResourceEntry }> {
    const top = await readFile(def, name, from)
    const root: F = { ...top.file }
    const chain: Record<string, F> = {}
    let node = root
    let nodeName = name
    let nodeIndex = top.index
    for (let depth = 0; node.extends !== undefined && depth < MAX_EXTENDS_DEPTH; depth++) {
      const target = node.extends
      const own = nodeName.split('@')[0]!
      // `light.json` extending `default` extends the built-in it shadows, as `extends: "light"` would.
      const self = target === own || (def.alias?.(target) ?? target) === own
      // A cycle through other names: stop reading; the resolver names it.
      if (!self && (Object.hasOwn(chain, target) || target === name)) break
      const parent = await readFile(def, target, self ? nodeIndex + 1 : 0).catch((err: unknown) => {
        throw def.fail(`extends "${target}": ${err instanceof Error ? err.message : String(err)}`)
      })
      const key = self ? `${target}@${parent.entry.root}` : target
      if (self) node.extends = key
      const copy: F = { ...parent.file }
      chain[key] = copy
      node = copy
      nodeName = key
      nodeIndex = parent.index
    }
    return { file: top.file, root, chain, entry: top.entry }
  }

  /** A layout by name, resolved through the roots; throws a `LayoutError` saying why it cannot be. */
  async function resolveLayoutName(name: string, from = 0): Promise<{ spec: ShellSpec; entry: ResourceEntry }> {
    const { root, chain, entry } = await readChain(LAYOUTS, name, from)
    return { spec: resolveSpec(root, chain, name), entry }
  }

  /**
   * The spec a choice resolves to: the winning file for its name, `extends`
   * followed through the same roots, validated. An invalid file, a cycle or
   * an unknown parent falls back to the built-in `default` and is reported
   * through `host.warn` — the shell never renders a half-spec.
   *
   * Then the device's own layers, in order (round 3, Q6): `overrides` —
   * Settings › Layout's edits, a file-shaped delta (`applyOverrides`) — and
   * `pins` (Round 2, P7), so a pinned side is a column under every layout
   * and every override, the fallback included. `file` is the file's own
   * spec; `unpinned` that with the overrides.
   */
  async function resolveLayout(
    active: LayoutChoice,
    pins: LayoutPins = {},
    overrides: LayoutFile = NO_OVERRIDES
  ): Promise<ResolvedLayout> {
    const name = layoutName(active)
    let file: ShellSpec = PRESETS.default
    let entry: ResourceEntry | null = null
    let error: string | null = null
    try {
      ;({ spec: file, entry } = await resolveLayoutName(name))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      host.warn(name, error)
    }
    const unpinned = applyOverrides(file, overrides)
    return { spec: applyPins(unpinned, pins), unpinned, file, entry, error }
  }

  /** A keymap by name, resolved through the roots; throws a `KeymapError` saying why it cannot be. */
  async function resolveKeymapName(name: string, from = 0): Promise<Omit<ResolvedKeymap, 'error'>> {
    const { file, root, chain, entry } = await readChain(KEYMAPS, name, from)
    return {
      bindings: resolveKeymap(root, chain, name),
      parent: resolveKeymap({ ...root, bindings: {} }, chain, name),
      file,
      entry,
    }
  }

  /**
   * The bindings a keymap choice resolves to — the layouts' pipeline: an
   * invalid file, a cycle or an unknown parent falls back to the built-in
   * `default` (no overrides) and is reported through `host.warn`.
   */
  async function resolveKeymapChoice(active: KeymapChoice): Promise<ResolvedKeymap> {
    const name = keymapName(active)
    try {
      return { ...(await resolveKeymapName(name)), error: null }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      host.warn(name, error, 'keymaps')
      return { bindings: {}, parent: {}, file: BUILTIN_KEYMAP_FILES.default, entry: null, error }
    }
  }

  /** The open vault, when `name` may be written into it; throws the kind's error saying why not. */
  function writableVault<F extends { extends?: string | undefined }>(def: JsonKind<F>, name: string): VaultAppFiles {
    const vault = host.vault()
    if (!vault) throw def.fail(def.text().needs_vault())
    if (!savableName(name, def.builtins)) throw def.fail(def.text().bad_name())
    return vault
  }

  /** Where `extends` is read from when saving `name`: its own name means the file it shadows (below the vault). */
  const parentFrom = (name: string, extendsName: string): number => (extendsName === name ? 1 : 0)

  async function write(vault: VaultAppFiles, kind: ResourceKind, name: string, value: unknown): Promise<string> {
    const path = `.ohhi/${kind}/${name}${KIND_EXT[kind]}`
    await vault.writeAppFile(path, `${JSON.stringify(value, null, 2)}\n`)
    return path
  }

  /** Re-list the keymaps every root offers. */
  async function refreshKeymaps(): Promise<ResourceEntry[]> {
    keymaps = await list('keymaps')
    return keymaps
  }

  /**
   * Write `.ohhi/keymaps/<name>.json` in the open vault — journaled, atomic
   * (`Workspace.writeAppFile`), from Settings › Hotkeys or the `config.hotkeys`
   * migration. Only what the file adds over the keymap it `extends` is
   * written: a binding its parent chain already says is dropped, and a
   * parent that does not resolve refuses the save (the file would not
   * either). Returns the vault-relative path written.
   */
  async function saveKeymap(name: string, file: KeymapFile): Promise<string> {
    const vault = writableVault(KEYMAPS, name)
    const parsed = KEYMAPS.parse(file)
    if (!parsed.ok) throw new KeymapError(parsed.error)
    const own = ownBindings(parsed.value)
    const base = parsed.value.extends
    if (base !== undefined) {
      const parent = await resolveKeymapName(base, parentFrom(name, base))
      for (const id of Object.keys(own)) if (sameChords(own[id], parent.bindings[id])) delete own[id]
    }
    const path = await write(vault, 'keymaps', name, keymapFile(own, base))
    await refreshKeymaps()
    return path
  }

  /** The text of one template (F11) from the first root that has it, or null. */
  async function readTemplate(name: string): Promise<{ text: string; entry: ResourceEntry } | null> {
    const found = await read('templates', name)
    return found ? { text: found.text, entry: found.entry } : null
  }

  /**
   * Every file of a kind with its text, each from the root that wins it: one
   * listing per root and one read per file (correctness #28 — `read` per name
   * re-lists every lower root to find shadows, an N×R IPC cost on desktop;
   * `list` already knows them).
   */
  async function readAll(kind: ResourceKind): Promise<{ text: string; entry: ResourceEntry }[]> {
    const all = await roots()
    const out: { text: string; entry: ResourceEntry }[] = []
    for (const entry of await list(kind, all)) {
      const root = all.find((r) => r.id === entry.root)
      const text = root ? await root.read(kind, `${entry.name}${KIND_EXT[kind]}`).catch(() => null) : null
      if (text !== null) out.push({ text, entry })
    }
    return out
  }

  /** Re-list the layouts every root offers (the palette's *Use layout file…*, a reload, a vault switch). */
  async function refresh(): Promise<ResourceEntry[]> {
    layouts = await list('layouts')
    return layouts
  }

  // ---- change feed: one `.ohhi/` subscription for every kind ----
  const listeners = new Map<ResourceKind, Set<(why: ResourceChange) => void>>()
  function emit(kinds: readonly ResourceKind[], why: ResourceChange): void {
    for (const kind of kinds) for (const cb of [...(listeners.get(kind) ?? [])]) cb(why)
  }
  /** Run `cb` whenever `kind`'s files should be read again (see `ResourceChange`). Returns the unsubscribe. */
  function onChange(kind: ResourceKind, cb: (why: ResourceChange) => void): () => void {
    const set = listeners.get(kind) ?? new Set()
    listeners.set(kind, set)
    set.add(cb)
    return () => set.delete(cb)
  }
  // A new vault (or none) re-reads every kind; a change under `.ohhi/<kind>/`
  // re-reads that kind. One subscription for all of them, for the app's life.
  $effect.root(() => {
    $effect(() => {
      const vault = host.vault()
      untrack(() => emit(RESOURCE_KINDS, 'open'))
      return vault?.onAppFileChange?.('.ohhi/', (paths) =>
        emit(
          RESOURCE_KINDS.filter((kind) => paths.some((p) => p.startsWith(`.ohhi/${kind}/`))),
          'change'
        )
      )
    })
  })

  return {
    get layouts() {
      return layouts
    },
    get keymaps() {
      return keymaps
    },
    list,
    read,
    resolveLayout,
    resolveLayoutName,
    refresh,
    resolveKeymap: resolveKeymapChoice,
    refreshKeymaps,
    saveKeymap,
    readTemplate,
    readAll,
    onChange,
    /** `app.reload-resources` (quiet-shell F9): every kind re-reads, the layout re-seeding its columns. */
    reloadAll: (): void => emit(RESOURCE_KINDS, 'reload'),
  }
}

export type Resources = ReturnType<typeof createResources>
