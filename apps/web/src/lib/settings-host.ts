/**
 * What Settings is handed, and what its sections may ask (settings-shaping
 * ST1). Two contexts, both Svelte contexts so nothing threads them through
 * the pane tree:
 *
 *  - `SettingsHost` — the shell's half, set ONCE by App.svelte. The view tab
 *    (`SettingsView.svelte`, rendered by a pane with only `{workspace, tab}`)
 *    reads it to render the body; the manager's page is handed the same
 *    object. Every field is read live (App passes getters).
 *  - `SettingsEnv` — set by `Settings.svelte` for the sections below it:
 *    whether a vault is open (and which), desktop vs browser, and how to move
 *    to another section. A section component (wave B's `CustomiseSettings`,
 *    `AgentSettings`) reads it with `getSettingsEnv()` during init; a unit
 *    test renders a section on its own and gets the default (no vault,
 *    browser), or injects one with `settingsEnvContext(env)`.
 */
import { getContext, hasContext, setContext } from 'svelte'
import type { SharedSnapshot } from '@ohhi/workspace'
import type { CommandRegistry } from './commands.js'
import type { VaultSourceDesc } from './config.js'
import type { Keymap } from './keymap.svelte.js'
import type { Resources } from './resources.svelte.js'
import type { SettingsSection } from './settings.js'
import type { ShellLayout } from './shell-layout.svelte.js'

/** The open vault, as Settings describes it. */
export interface SettingsVault {
  name: string
  /** `tauri` = a folder on disk (`path` set); `opfs` = stored in this browser; `memory` = a test/dev vault. */
  kind: VaultSourceDesc['kind']
  /** The folder on disk, for a `tauri` vault. */
  path?: string
}

/** The layout surface Settings › Layout and › Editor edit (this device's overrides, live). */
export type SettingsLayout = Pick<ShellLayout, 'fileSpec' | 'ownSpec' | 'overrides' | 'setOverrides' | 'resetOverrides'> &
  Partial<Pick<ShellLayout, 'pins' | 'unpin' | 'active' | 'source' | 'specError' | 'held'>>

export interface SettingsHost {
  /** The shell's one command registry (tab-groups R1.3): Keys is a view of it. */
  registry: CommandRegistry
  /** This device's layout overrides (device config: present with or without a vault). */
  layout?: SettingsLayout
  resources?: Partial<Pick<Resources, 'keymaps' | 'refreshKeymaps' | 'read' | 'overview' | 'onChange' | 'themes'>>
  /** The active keymap (quiet-shell F10). */
  keymap?: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'setActive' | 'save' | 'restore'>
  /** Reads the vault's `.ohhi/`; absent with no vault open. */
  readAppFile?: (path: string) => Promise<string | null>
  /** Writes under the vault's `.ohhi/` — journaled, atomic (`Workspace.writeAppFile`); absent with no vault open. */
  writeAppFile?: (path: string, text: string) => Promise<void>
  /** The open vault; null with none. */
  vault: SettingsVault | null
  /** The open vault's relays, as the Shared view rolls them up (Sync & devices' relay card). */
  relays?: SharedSnapshot['relays']
  /** Open the owner's device-link dialog; absent with no vault open. */
  onLinkDevice?: () => void
  /** Show the vault manager (Vaults & shares live there now). */
  onManageVaults?: () => void
  /** A device setting changed (name, relay, secret, developer tools): the shell re-reads config. */
  onConfigChange?: () => void
}

const HOST = Symbol('settings-host')

export function setSettingsHost(host: SettingsHost): void {
  setContext(HOST, host)
}

export function getSettingsHost(): SettingsHost | null {
  return hasContext(HOST) ? getContext<SettingsHost>(HOST) : null
}

export function settingsHostContext(host: SettingsHost): Map<symbol, SettingsHost> {
  return new Map([[HOST, host]])
}

/** What a section may ask about where it is drawn. */
export interface SettingsEnv {
  /** A vault is open (in the view tab: always; on the manager's page: when one is open behind it). */
  readonly vaultOpen: boolean
  readonly vault: SettingsVault | null
  /** The desktop app (a folder on disk is reachable); false in a browser. */
  readonly desktop: boolean
  /** Which host draws it: the view tab or the manager's page. */
  readonly host: 'view' | 'page'
  /** Move Settings to another section (the view tab's `viewArg` follows). */
  openSection(section: SettingsSection): void
  /** Show the vault manager, when the host can. */
  manageVaults?(): void
}

const ENV = Symbol('settings-env')

export function setSettingsEnv(env: SettingsEnv): void {
  setContext(ENV, env)
}

const NO_ENV: SettingsEnv = {
  vaultOpen: false,
  vault: null,
  desktop: false,
  host: 'view',
  openSection: () => {},
}

export function getSettingsEnv(): SettingsEnv {
  return hasContext(ENV) ? getContext<SettingsEnv>(ENV) : NO_ENV
}

export function settingsEnvContext(env: SettingsEnv): Map<symbol, SettingsEnv> {
  return new Map([[ENV, env]])
}
