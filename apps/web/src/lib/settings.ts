/**
 * Settings' sections (settings-shaping ST1/ST2; the map is Fork 7, QA round
 * 1): the pure half — the ids, their order and the tree they sit in, which
 * need a vault, and how a view tab's `viewArg` (or an old caller's tab name)
 * becomes a section. The Svelte half is `components/Settings.svelte` (with
 * its nav, `SettingsNav.svelte`), which both hosts render: the `settings`
 * view tab (`SettingsView.svelte`) and the manager's page (`SettingsPage.svelte`).
 *
 * Deep link: `openView('settings', '<section>')` from anything holding the
 * view shell (`getViewShell()?.openSettings('<section>')` says the same), or
 * the palette's `app.settings` for the last section shown.
 */

/** Every section, in the nav's order (top to bottom, children after their parent). */
export const SETTINGS_SECTIONS = [
  'customise',
  'editor',
  'layout',
  'appearance',
  'keys',
  'sync',
  'ai',
  'developer',
  'about',
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** A row of the nav: a section, and the sections drawn under it as its parts. */
export interface SettingsNode {
  readonly id: SettingsSection
  readonly children?: readonly SettingsSection[]
}

/**
 * The nav (Fork 7, map A): three groups, a gap between them. Customise is the
 * umbrella — a page of its own (the hub) with the four things you customise
 * as its children — then Sync & devices and AI, then Developer and About.
 */
export const SETTINGS_GROUPS: readonly (readonly SettingsNode[])[] = [
  [{ id: 'customise', children: ['editor', 'layout', 'appearance', 'keys'] }],
  [{ id: 'sync' }, { id: 'ai' }],
  [{ id: 'developer' }, { id: 'about' }],
]

/** The section a bare `openView('settings')` lands on: the hub. */
export const DEFAULT_SECTION: SettingsSection = 'customise'

/**
 * Sections whose settings are files inside a vault: with none open they say
 * "open a vault to change this" instead of their body (R2). Everything else is
 * this device's config and works from the manager too.
 */
export const NEEDS_VAULT: ReadonlySet<SettingsSection> = new Set<SettingsSection>(['keys', 'customise'])

/**
 * Names that are no longer sections, so a stored tab (a layout's `viewArg`,
 * the palette's last section) or an old caller still lands somewhere
 * sensible: the dialog's old tabs, and the two sections QA round 1 folded
 * away — You (the display name is now Sync & devices' first row) and Agents
 * (now AI's *Outside agents* group).
 */
const LEGACY: Record<string, SettingsSection> = {
  general: 'sync',
  hotkeys: 'keys',
  vaults: 'sync',
  you: 'sync',
  agents: 'ai',
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/** A view tab's `viewArg` (or anything a caller passed) as a section; the default when unknown. */
export function settingsSection(arg: string | undefined | null): SettingsSection {
  if (isSettingsSection(arg)) return arg
  return (arg && LEGACY[arg]) || DEFAULT_SECTION
}

/** The nav's rows in order, each with its depth (0 = top level, 1 = a part of its parent) and group. */
export function settingsRows(): { id: SettingsSection; depth: 0 | 1; group: number }[] {
  return SETTINGS_GROUPS.flatMap((nodes, group) =>
    nodes.flatMap((node) => [
      { id: node.id, depth: 0 as const, group },
      ...(node.children ?? []).map((id) => ({ id, depth: 1 as const, group })),
    ])
  )
}
