/**
 * Settings' sections (settings-shaping ST1/ST2, Fork 3): the pure half — the
 * ids, their order and grouping, which need a vault, and how a view tab's
 * `viewArg` (or an old caller's tab name) becomes a section. The Svelte half
 * is `components/Settings.svelte`, which both hosts render: the `settings`
 * view tab (`SettingsView.svelte`) and the manager's page (`SettingsPage.svelte`).
 *
 * Deep link: `openView('settings', '<section>')` from anything holding the
 * view shell (`getViewShell()?.openSettings('<section>')` says the same), or
 * the palette's `app.settings` for the last section shown.
 */

export const SETTINGS_SECTIONS = [
  'you',
  'editor',
  'layout',
  'appearance',
  'keys',
  'sync',
  'customise',
  'agents',
  'ai',
  'developer',
  'about',
] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The nav's three groups, drawn with a separator between them (Fork 3). */
export const SETTINGS_GROUPS: readonly (readonly SettingsSection[])[] = [
  ['you', 'editor', 'layout', 'appearance', 'keys'],
  ['sync', 'customise', 'agents', 'ai'],
  ['developer', 'about'],
]

export const DEFAULT_SECTION: SettingsSection = 'you'

/**
 * Sections whose settings are files inside a vault: with none open they say
 * "open a vault to change this" instead of their body (R2). Everything else is
 * this device's config and works from the manager too.
 */
export const NEEDS_VAULT: ReadonlySet<SettingsSection> = new Set<SettingsSection>(['keys', 'customise'])

/** The dialog's old tab names, so a stored tab or an old caller still lands somewhere sensible. */
const LEGACY: Record<string, SettingsSection> = {
  general: 'you',
  hotkeys: 'keys',
  vaults: 'sync',
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

/** A view tab's `viewArg` (or anything a caller passed) as a section; the default when unknown. */
export function settingsSection(arg: string | undefined | null): SettingsSection {
  if (isSettingsSection(arg)) return arg
  return (arg && LEGACY[arg]) || DEFAULT_SECTION
}
