/**
 * Settings › Customise, the pure half (settings-shaping ST4; quiet-shell F16
 * and Fork 8): what the overview draws, derived from the loader's
 * `overview()` and what the device has chosen — the roots strip, one row per
 * kind (in use, where it came from, what it shadows, what else is there),
 * and whether a problem file is the one in use. The Svelte half is
 * `components/CustomiseSettings.svelte`; the one-line source on Layout and
 * Appearance is `components/ResourceSource.svelte` over `sourceOf` here.
 *
 * Themes are not a loader kind (`RESOURCE_KINDS`): a theme is a folder,
 * `.ohhi/themes/<name>/theme.css`, read by name by `useCustomTheme` from the
 * vault only. The loader lists those folders (`resources.themes`, over the
 * adapters' `listAppDirs`), so the theme row names the one in use and every
 * other theme folder in this vault.
 *
 * Pure: no runes, no I/O.
 */
import type { SettingsVault } from './settings-host.js'
import type {
  ResourceEntry,
  ResourceKind,
  ResourceOverview,
  ResourceProblem,
  RootId,
  ThemeEntry,
} from './resources.svelte.js'

export type CustomiseKind = ResourceKind | 'themes'

export const CUSTOMISE_KINDS: readonly CustomiseKind[] = ['layouts', 'keymaps', 'templates', 'themes']

/** The file a kind has in use, and where it came from. */
export interface InUse {
  name: string
  root: RootId
  /** The file, as Settings shows it (`.ohhi/layouts/writing.json`); null for a built-in. */
  path: string | null
  /** Lower roots that also have the name and lose to this one. */
  shadows: RootId[]
}

export interface KindRow {
  kind: CustomiseKind
  /** What is in use; null for templates (every one is offered, none is chosen). */
  inUse: InUse | null
  /** The name the device chose, when it could not be used and the built-in stood in. */
  fellBackFrom: string | null
  /** Every other name of the kind, each from the root that wins it. */
  others: ResourceEntry[]
  /** Every name of the kind (templates: the count is the row). */
  total: number
}

/** A resolved choice as the shell holds it: the entry it resolved to, or null and why it fell back. */
export interface Resolved {
  /** The name the device chose (`writing` for `custom:writing`). */
  chosen: string
  entry: ResourceEntry | null
  error: string | null
}

/** The theme the device uses: a built-in by label, or a vault theme by folder name. */
export type ThemeInUse = { builtin: true; name: string } | { builtin: false; name: string; path: string }

/** A loader entry as "in use"; a built-in has no file to show. */
export function inUseOf(entry: ResourceEntry): InUse {
  return {
    name: entry.name,
    root: entry.root,
    path: entry.root === 'builtin' ? null : entry.path,
    shadows: [...entry.shadows],
  }
}

const BUILTIN_DEFAULT: InUse = { name: 'default', root: 'builtin', path: null, shadows: [] }

/** A choice's in-use file: its entry, or the built-in `default` it fell back to. */
function chosenRow(kind: 'layouts' | 'keymaps', entries: readonly ResourceEntry[], resolved: Resolved): KindRow {
  const inUse = resolved.entry ? inUseOf(resolved.entry) : BUILTIN_DEFAULT
  const fellBackFrom = resolved.entry === null && resolved.error !== null ? resolved.chosen : null
  return {
    kind,
    inUse,
    fellBackFrom,
    others: entries.filter((e) => e.name !== inUse.name),
    total: entries.length,
  }
}

/** One row per kind, in the order the section draws them. */
export function kindRows(input: {
  overview: Pick<ResourceOverview, 'entries'>
  layout: Resolved
  keymap: Resolved
  theme: ThemeInUse
  /** The open vault's theme folders (`resources.themes`); absent → none listed. */
  themes?: readonly ThemeEntry[]
}): KindRow[] {
  const { entries } = input.overview
  const theme = input.theme
  const folders = input.themes ?? []
  const otherThemes: ResourceEntry[] = folders
    .filter((f) => theme.builtin || f.name !== theme.name)
    .map((f) => ({ name: f.name, root: 'vault', path: f.path, shadows: [] }))
  return [
    chosenRow('layouts', entries.layouts, input.layout),
    chosenRow('keymaps', entries.keymaps, input.keymap),
    { kind: 'templates', inUse: null, fellBackFrom: null, others: [...entries.templates], total: entries.templates.length },
    {
      kind: 'themes',
      inUse: theme.builtin
        ? { name: theme.name, root: 'builtin', path: null, shadows: [] }
        : { name: theme.name, root: 'vault', path: theme.path, shadows: [] },
      fellBackFrom: null,
      others: otherThemes,
      total: folders.length,
    },
  ]
}

/** Is this problem file the one a kind has in use (so the built-in stood in), or unused? */
export function problemInUse(problem: ResourceProblem, rows: readonly KindRow[]): boolean {
  const row = rows.find((r) => r.kind === problem.kind)
  return row?.fellBackFrom === problem.name
}

/** The names of a kind that are problems, for marking them in the "also here" list. */
export function problemNames(problems: readonly ResourceProblem[], kind: CustomiseKind): Set<string> {
  return new Set(problems.filter((p) => p.kind === kind).map((p) => p.name))
}

/** Why a root line reads the way it does. */
export type RootDetail =
  /** A desktop vault: a folder on disk (`path` absolute). */
  | 'disk'
  /** A browser (OPFS) vault: `.ohhi` lives in this browser. */
  | 'browser'
  /** No vault is open: the vault root comes with one. */
  | 'no-vault'
  /** The desktop's user root, read-only from the app. */
  | 'read-only'
  /** The desktop's user root did not answer (no scope, or no folder support). */
  | 'unreadable'
  /** The browser has no user root. */
  | 'desktop-only'
  /** Shipped with the app. */
  | 'ships'

export interface RootLine {
  id: RootId
  /** The folder, as a person would type or paste it; null when there is none to show. */
  path: string | null
  detail: RootDetail
  /** Whether a path here can be copied (a folder on this disk). */
  copyable: boolean
}

/** The three roots in precedence order, each saying where it is and whether it is in play. */
export function rootLines(input: {
  roots: ResourceOverview['roots'] | null
  vault: SettingsVault | null
  desktop: boolean
}): RootLine[] {
  const { vault, desktop } = input
  const user = input.roots?.find((r) => r.id === 'user') ?? null
  const vaultLine: RootLine = !vault
    ? { id: 'vault', path: null, detail: 'no-vault', copyable: false }
    : vault.kind === 'tauri' && vault.path
      ? { id: 'vault', path: joinPath(vault.path, '.ohhi'), detail: 'disk', copyable: true }
      : { id: 'vault', path: '.ohhi', detail: 'browser', copyable: false }
  const userLine: RootLine = !desktop
    ? { id: 'user', path: null, detail: 'desktop-only', copyable: false }
    : user?.base
      ? { id: 'user', path: user.base, detail: 'read-only', copyable: true }
      : { id: 'user', path: null, detail: 'unreadable', copyable: false }
  return [vaultLine, userLine, { id: 'builtin', path: null, detail: 'ships', copyable: false }]
}

/** `a` + `/` + `b`, without doubling the separator. */
export function joinPath(a: string, b: string): string {
  return `${a.replace(/[/\\]+$/, '')}/${b.replace(/^[/\\]+/, '')}`
}

/**
 * The path *Show file* copies: on the desktop the file on disk (a vault path
 * made absolute under the vault's folder; the user root's is absolute
 * already), in the browser the vault-relative path. There is no reveal: the
 * desktop app carries no opener plugin (and this slice adds no capability).
 */
export function filePath(path: string, root: RootId, vault: SettingsVault | null): string {
  if (root === 'vault' && vault?.kind === 'tauri' && vault.path) return joinPath(vault.path, path)
  return path
}

/** What a file-backed section's one source line names (Fork 4). */
export interface Source {
  name: string
  root: RootId
  path: string | null
  shadows: RootId[]
  /** The name chosen, when it could not be used and the built-in stood in. */
  fellBackFrom: string | null
}

/** A resolved choice as a source line. */
export function sourceOf(resolved: Resolved): Source {
  const inUse = resolved.entry ? inUseOf(resolved.entry) : BUILTIN_DEFAULT
  return { ...inUse, fellBackFrom: resolved.entry === null && resolved.error !== null ? resolved.chosen : null }
}
