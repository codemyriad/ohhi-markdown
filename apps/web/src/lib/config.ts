/**
 * Persisted shell config, v2 (dogfood-shaping M2): a registry of named vaults
 * replaces the single last-session, plus app-level settings (default relay,
 * operator secret for in-app minting — consumed by M4) and remembered shares.
 * Backed by localStorage under one key; all access is guarded so a missing or
 * throwing storage (private mode, SSR) degrades to "nothing remembered"
 * rather than crashing the boot.
 *
 * v1 keys (`editor:lastSession`, `editor:shares`) migrate on first load and
 * are then ignored; `editor:user` stays its own key (the name helpers below
 * also heal values double-JSON-encoded by earlier builds).
 */
import { normalizeOverrides, type BindingOverrides } from './commands.js'
import { parseKeymapChoice, type KeymapChoice } from './keymap-spec.js'
import { normalizeLayout, type LayoutPrefs } from './layout.js'
import { normalizePins, type LayoutPins } from './pin-layout.js'
import { normalizeOverrides as normalizeLayoutOverrides, type LayoutFile } from './layout-spec.js'
import { VIEW_MODES, type ViewMode } from './panes.js'
import type { ShareGrant, ShareKind } from './share-link.js'
import type { BuiltinTheme } from '@ohhi/ui/tokens'

/** How to (re)build the VaultAdapter for a session. */
export type VaultSourceDesc =
  | { kind: 'memory' }
  | { kind: 'tauri'; path: string }
  | { kind: 'opfs'; id: string }

/** The bootable description of a workspace (what boot.ts consumes). */
export interface SessionDesc {
  vault: VaultSourceDesc
  /** Folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /** Present → connect to the relay (background, except a first-join pull). */
  relay?: { url: string; token: string }
  /** Pending first join: no durable/local state yet, must pull the relay. */
  firstJoin?: boolean
}

/** A vault the manager lists: a bootable session plus its display metadata. */
export interface VaultEntry extends SessionDesc {
  name: string
  lastOpenedAt?: number
}

export interface StoredShare {
  link: string
  /** Folder GUID, used to dedupe. */
  room: string
  label: string
}

/** The relay a build falls back to when it was given none: local dev. */
export const FALLBACK_RELAY = 'ws://localhost:8787'

/** A relay URL as Settings › Sync accepts it (and as a build may set it). */
export const isRelayUrl = (url: string): boolean => /^wss?:\/\/\S+$/.test(url)

/**
 * `VITE_DEFAULT_RELAY` when it is a relay URL, else the local-dev fallback: a
 * typo in a CI variable must not ship a build whose every new share points
 * nowhere.
 */
export function resolveDefaultRelay(buildValue: unknown): string {
  const url = typeof buildValue === 'string' ? buildValue.trim() : ''
  return isRelayUrl(url) ? url : FALLBACK_RELAY
}

/** This build's default relay (`.env.example`); never stored — see `AppConfigV2.defaultRelay`. */
export const DEFAULT_RELAY = resolveDefaultRelay(import.meta.env.VITE_DEFAULT_RELAY)

/**
 * Whether the build was GIVEN a relay (`VITE_DEFAULT_RELAY` is a relay URL),
 * as opposed to running on the local-dev fallback. A team build with the
 * relay baked in knows where shares go before anyone opens Settings; a build
 * with no variable does not, even though `DEFAULT_RELAY` reads
 * `ws://localhost:8787` (first-run-shaping D3).
 */
export function isDefaultRelayConfigured(buildValue: unknown): boolean {
  const url = typeof buildValue === 'string' ? buildValue.trim() : ''
  return isRelayUrl(url)
}

/** This build was given a relay (see `isDefaultRelayConfigured`). */
export const DEFAULT_RELAY_CONFIGURED = isDefaultRelayConfigured(import.meta.env.VITE_DEFAULT_RELAY)

/** A build-time sentence: trimmed, '' when unset or not a string. */
export const buildText = (buildValue: unknown): string => (typeof buildValue === 'string' ? buildValue.trim() : '')

/**
 * Where this deployment keeps the operator secret, in one sentence
 * (`VITE_TEAM_SECRET_HINT`, first-run-shaping D2) — '' when the build says
 * nothing. Rendered by the secret field's *Where do I get this?*.
 */
export const TEAM_SECRET_HINT = buildText(import.meta.env.VITE_TEAM_SECRET_HINT)

/**
 * One sentence about reaching this deployment's relay
 * (`VITE_TEAM_NETWORK_NOTE`, e.g. "only while you are on the company
 * tailnet") — '' when the build says nothing.
 */
export const TEAM_NETWORK_NOTE = buildText(import.meta.env.VITE_TEAM_NETWORK_NOTE)

/**
 * The host this build's content security policy is pinned to
 * (`VITE_TEAM_HOST`, the release workflow's `TEAM_HOST`: a bare host, no
 * scheme or path) — '' for a generic build. When set, `connect-src` allows no
 * other relay (apps/desktop/scripts/pin-csp.mjs), so the app must never offer
 * one: no *Use another…* / *Change…*, and the relay card says the build syncs
 * through this host only (first-run-shaping R10). Lower-cased; anything that
 * is not a bare host reads as unset.
 */
export function resolveTeamHost(buildValue: unknown): string {
  const host = buildText(buildValue).toLowerCase()
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(host) ? host : ''
}

/** This build's pinned host ('' = not pinned; see `resolveTeamHost`). */
export const TEAM_HOST = resolveTeamHost(import.meta.env.VITE_TEAM_HOST)

/** One room's stored credential. */
export interface RoomToken {
  token: string
  /** Absent ⇒ 'folder' (every token stored before N1). */
  kind?: ShareKind
}

interface AppConfigV2 {
  version: 2
  vaults: VaultEntry[]
  /** Room of the vault to auto-reopen on launch; null → show the manager. */
  lastRoom: string | null
  /**
   * The relay the user chose in Settings › Sync; '' = none, follow the build's
   * `DEFAULT_RELAY` (read through `defaultRelay()`). Storing the build default
   * instead would freeze every install on the build it first ran. Configs from
   * earlier builds hold a literal `ws://localhost:8787` — indistinguishable
   * from a deliberate choice, so it is kept.
   */
  defaultRelay: string
  /** Relay admin credential for in-app token minting (M4). '' = unset. */
  operatorSecret: string
  shares: StoredShare[]
  /**
   * Bearer token per room for shares this device created or joined (M4).
   * Tokens NEVER live in mounts.json/folder maps (parent D4: descs are
   * advisory, never an auth source) — only here, in app config.
   *
   * The `kind` (device-link-shaping A4-A, spike S10 Q2) is what makes the
   * ancestry fallback safe: a DEVICE token for the root room is one the relay
   * also accepts in rooms carved out of that vault, so a mount with no token
   * of its own may use it. A FOLDER token never reaches beyond its own room —
   * on the client (the fallback is gated on the kind) and on the relay (a
   * folder token never consults ancestry). Values written before N1 are bare
   * strings and read as `{ token, kind: 'folder' }`: the conservative default,
   * and the truth for every token the pre-N1 app ever minted.
   */
  tokensByRoom: Record<string, RoomToken>
  /**
   * Relay URL per room, parallel to `tokensByRoom` (device-link-shaping
   * A4-B): a device link bundles {room, relay, token} triples, and the room
   * of a *foreign* mount has no other home for its relay URL here —
   * mounts.json stays the mount authority, config only holds credentials.
   * Additive: configs written before N2 have no map and are backfilled on
   * load, exactly as `tokensByRoom` was when M4 added it.
   */
  relayByRoom: Record<string, string>
  /** Sync devtools inspector (M6); `?debug=1` forces it on for a session. */
  devtools?: boolean
  /**
   * Theme preference (V2a). Device-level, NOT vault-level: it is a preference
   * about this screen, and pushing it through the CRDT would make one
   * collaborator's aesthetics another's problem.
   */
  theme?: ThemePref
  /**
   * The active layout file (quiet-shell F2: `default` or `custom:<name>`,
   * chosen by the palette's *Use layout file…*), plus the navigator width
   * (chrome U2). Device-level, like theme: the FILE travels with the vault,
   * the device holds only the choice. Which columns are open is not stored —
   * the spec seeds it; the toggles are session-only. `overrides` (round 3,
   * Q6): Settings › Layout's edits, a layout-file delta laid over the active
   * file. `pins` (Round 2, P7): the sides this device shows as a column
   * whatever the layout and the overrides say (`pin-layout.ts`).
   */
  layout?: Partial<LayoutPrefs> & { pins?: LayoutPins; overrides?: LayoutFile }
  /**
   * Per-command binding overrides (tab-groups R1.3), Obsidian's
   * `hotkeys.json`: `null` clears a default, an absent id keeps it. Additive
   * and tolerant on read like `layout` — a config written before this shipped
   * simply has none, and garbage in one entry never costs the others.
   */
  hotkeys?: BindingOverrides
  /**
   * The active keymap FILE (quiet-shell F10): `default` or `custom:<name>`.
   * Device-level like `layout.active` — the file travels with the vault, the
   * device holds only the choice. A non-empty `hotkeys` above is migrated
   * into `.ohhi/keymaps/device.json` the first time a vault is open, and
   * this then names it (`keymap.svelte.ts`).
   */
  keymap?: { active?: KeymapChoice }
  /**
   * Reading preferences (read-shaping B3): the view mode a tab that was never
   * given one is read in. Device-level like `layout` and `theme` — how you
   * read is about this screen — and additive on read, so a config written
   * before this shipped simply has none.
   */
  read?: Partial<ReadPrefs>
  /** The browser-storage note was dismissed. Device-level: the grant is per browser profile. */
  storageNoticeDismissed?: boolean
  /**
   * When the notification drawer was last opened, per vault room (quiet-shell
   * F13, spike-one-log): the event log persists, so what has been read of it
   * does too. Device-level — reading is about this screen. Additive on read.
   */
  drawerSeen?: Record<string, number>
}

/** Device-level reading preferences. One field today; the shape is the seam. */
export interface ReadPrefs {
  /** The mode a new tab opens in (Live, as Obsidian's 36 of 36 leaves are). */
  defaultMode: ViewMode
}

export const READ_DEFAULTS: ReadPrefs = { defaultMode: 'live' }

/**
 * `system` is a preference, not a theme — it resolves to a built-in at boot
 * against `prefers-color-scheme`. `custom:<name>` names a theme file in
 * `<vault>/.ohhi/themes/<name>/theme.css`.
 */
export type ThemePref = BuiltinTheme | 'system' | `custom:${string}`

const K_USER = 'editor:user'
const K_CONFIG = 'editor:config'
/**
 * Fast-path mirror of `theme`, read by the synchronous boot script in
 * index.html before first paint. A dedicated string key rather than a
 * JSON.parse of the whole config blob: the blob grows with every vault, share
 * and room token, and a shape change or half-written migration throwing on
 * the critical paint path is the one failure we cannot afford. A missing or
 * corrupt mirror degrades to `system`, which is always defensible.
 */
export const K_THEME = 'editor:theme'
/** v1 keys, read once by the migration and never written again. */
const K_LAST_V1 = 'editor:lastSession'
const K_SHARES_V1 = 'editor:shares'

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Shared with the other device-local stores (workspace-layout.ts). */
export function readJson<T>(key: string): T | null {
  const s = store()
  if (!s) return null
  const raw = s.getItem(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown): void {
  const s = store()
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — remembering is best-effort */
  }
}

// ---- user name (own key; healed) ----

export function loadUser(): string | null {
  let name = store()?.getItem(K_USER) ?? ''
  // Heal values stored by earlier builds, where saveUser JSON-encoded but
  // loadUser read raw — each save added a quoting layer ("\"Chris\"", …).
  while (name.startsWith('"') && name.endsWith('"')) {
    try {
      name = JSON.parse(name)
    } catch {
      break
    }
  }
  name = name.trim()
  return name ? name : null
}

export function saveUser(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) return
  try {
    store()?.setItem(K_USER, trimmed)
  } catch {
    /* quota / private mode — remembering is best-effort */
  }
}

// ---- config v2 load/save + v1 migration ----

function emptyConfig(): AppConfigV2 {
  return {
    version: 2,
    vaults: [],
    lastRoom: null,
    defaultRelay: '', // follow the build's DEFAULT_RELAY (see AppConfigV2)
    operatorSecret: '',
    shares: [],
    tokensByRoom: {},
    relayByRoom: {},
    devtools: false,
  }
}

/** Display name for a migrated/created vault when none was given. */
export function deriveVaultName(vault: VaultSourceDesc): string {
  switch (vault.kind) {
    case 'tauri': {
      const base = vault.path.replace(/\/+$/, '').split('/').pop()
      return base || 'My vault'
    }
    case 'opfs':
      return 'Browser vault'
    case 'memory':
      return 'Memory vault'
  }
}

function migrateV1(): AppConfigV2 {
  const cfg = emptyConfig()
  const last = readJson<SessionDesc>(K_LAST_V1)
  if (last && typeof last.room === 'string' && last.vault) {
    cfg.vaults = [{ ...last, name: deriveVaultName(last.vault) }]
    cfg.lastRoom = last.room
    if (last.relay?.url) cfg.defaultRelay = last.relay.url
  }
  const shares = readJson<StoredShare[]>(K_SHARES_V1)
  if (Array.isArray(shares)) {
    cfg.shares = shares.filter((s) => s && typeof s.link === 'string')
  }
  return cfg
}

function isValidConfig(c: unknown): c is AppConfigV2 {
  const cfg = c as AppConfigV2
  return (
    !!cfg &&
    cfg.version === 2 &&
    Array.isArray(cfg.vaults) &&
    Array.isArray(cfg.shares) &&
    typeof cfg.defaultRelay === 'string'
  )
}

export function loadConfig(): AppConfigV2 {
  const existing = readJson<AppConfigV2>(K_CONFIG)
  if (isValidConfig(existing)) {
    existing.vaults = existing.vaults.filter((v) => v && typeof v.room === 'string' && !!v.vault)
    // Fields added after v2 shipped — backfill for configs written before
    // M4 (tokens) and before N2 (relay URLs). The blob's version does not
    // move: every addition here is optional and defaulted on read.
    existing.tokensByRoom = normalizeTokens(existing.tokensByRoom)
    existing.relayByRoom ??= {}
    return existing
  }
  // First run on v2 (or corrupted v2 blob): rebuild from v1 keys, persist,
  // and never look at v1 again. Corruption falls back the same way — the
  // vault registry only holds pointers, never content (files are canonical).
  const migrated = migrateV1()
  writeJson(K_CONFIG, migrated)
  return migrated
}

/**
 * Read `tokensByRoom` in either shape. N1 gave each entry a `kind`; a config
 * written before it holds bare strings, which are folder tokens by definition
 * (the device kind did not exist yet). Migrating on read rather than bumping
 * the blob version keeps every other addition here additive — the same way
 * `tokensByRoom` itself arrived in M4.
 */
function normalizeTokens(raw: unknown): Record<string, RoomToken> {
  const out: Record<string, RoomToken> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [room, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      if (value) out[room] = { token: value, kind: 'folder' }
    } else if (value && typeof value === 'object' && typeof (value as RoomToken).token === 'string') {
      const { token, kind } = value as RoomToken
      if (token) out[room] = { token, ...(kind === 'device' ? { kind } : { kind: 'folder' }) }
    }
  }
  return out
}

function save(cfg: AppConfigV2): void {
  writeJson(K_CONFIG, cfg)
}

// ---- vault registry ----

export function listVaults(): VaultEntry[] {
  return [...loadConfig().vaults].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
}

export function getVault(room: string): VaultEntry | null {
  return loadConfig().vaults.find((v) => v.room === room) ?? null
}

/** Add or replace a vault entry (keyed by room). */
export function upsertVault(entry: VaultEntry): void {
  const cfg = loadConfig()
  cfg.vaults = [entry, ...cfg.vaults.filter((v) => v.room !== entry.room)]
  save(cfg)
}

/** Forget a vault's registry entry (files untouched; see also purgeRooms). */
export function removeVault(room: string): void {
  const cfg = loadConfig()
  cfg.vaults = cfg.vaults.filter((v) => v.room !== room)
  if (cfg.lastRoom === room) cfg.lastRoom = null
  save(cfg)
}

/**
 * Drop every config residue of a set of rooms: bearer tokens and remembered
 * share links. Called after forgetVaultState with the root + mount rooms it
 * discovered, so a forgotten vault leaves nothing that could resurrect its
 * old share identity.
 */
export function purgeRooms(rooms: string[]): void {
  const cfg = loadConfig()
  for (const room of rooms) {
    delete cfg.tokensByRoom[room]
    delete cfg.relayByRoom[room]
  }
  cfg.shares = cfg.shares.filter((s) => !rooms.includes(s.room))
  save(cfg)
}

/** Mark a vault as the current one after a successful boot. */
export function touchVault(room: string, at: number): void {
  const cfg = loadConfig()
  const entry = cfg.vaults.find((v) => v.room === room)
  if (!entry) return
  entry.lastOpenedAt = at
  // A first join is only pending once — after a successful boot the durable
  // stores exist and reopen is decided from them (spike S8 Q3).
  entry.firstJoin = false
  cfg.lastRoom = room
  save(cfg)
}

/** The vault to auto-reopen on launch (once; failures land on the manager). */
export function lastVault(): VaultEntry | null {
  const cfg = loadConfig()
  return cfg.lastRoom ? (cfg.vaults.find((v) => v.room === cfg.lastRoom) ?? null) : null
}

// ---- settings ----

/** The relay new shares are minted on: the user's choice, else this build's default. */
export function defaultRelay(): string {
  return loadConfig().defaultRelay || DEFAULT_RELAY
}

/** Store a relay the user chose (never an echo of the default); blank = follow the build again. */
/**
 * Whether this install knows where shares go: a relay saved in Settings ›
 * Sync, or one the build was given. The local-dev fallback does not count
 * (first-run-shaping D3: the Shared view's empty state says so).
 */
export function relayKnown(): boolean {
  return loadConfig().defaultRelay !== '' || DEFAULT_RELAY_CONFIGURED
}

export function setDefaultRelay(url: string): void {
  const cfg = loadConfig()
  cfg.defaultRelay = url.trim()
  save(cfg)
}

export function storageNoticeDismissed(): boolean {
  return loadConfig().storageNoticeDismissed === true
}

export function setStorageNoticeDismissed(dismissed: boolean): void {
  const cfg = loadConfig()
  cfg.storageNoticeDismissed = dismissed
  save(cfg)
}

export function devtoolsEnabled(): boolean {
  return loadConfig().devtools === true
}

// ---- theme (V2a) ----

export function themePref(): ThemePref {
  return loadConfig().theme ?? 'system'
}

export function setThemePref(pref: ThemePref): void {
  const cfg = loadConfig()
  cfg.theme = pref
  save(cfg)
  try {
    store()?.setItem(K_THEME, pref)
  } catch {
    // Mirror is best-effort; a miss costs one frame of the default theme.
  }
}

// ---- layout (chrome U2) ----

export function layoutPrefs(): LayoutPrefs {
  return normalizeLayout(loadConfig().layout)
}

/** `config.layout`, every part read tolerantly and `patch` laid over it. */
function writeLayout(
  cfg: AppConfigV2,
  patch: Partial<LayoutPrefs> & { pins?: LayoutPins; overrides?: LayoutFile }
): void {
  const now = cfg.layout
  cfg.layout = {
    ...normalizeLayout(now),
    ...patch,
    pins: normalizePins(patch.pins ?? now?.pins),
    overrides: normalizeLayoutOverrides(patch.overrides ?? now?.overrides),
  }
}

export function setLayoutPrefs(patch: Partial<LayoutPrefs>): void {
  const cfg = loadConfig()
  writeLayout(cfg, patch)
  save(cfg)
}

/** The sides this device pins as columns (Round 2, P7); tolerant like the rest of `layout`. */
export function layoutPins(): LayoutPins {
  return normalizePins(loadConfig().layout?.pins)
}

export function setLayoutPins(pins: LayoutPins): void {
  const cfg = loadConfig()
  writeLayout(cfg, { pins })
  save(cfg)
}

/**
 * This device's layout overrides (round 3, Q6): Settings › Layout's edits,
 * a layout-file delta over the active file. Tolerant: anything that is not
 * a valid layout file reads as none.
 */
export function layoutOverrides(): LayoutFile {
  return normalizeLayoutOverrides(loadConfig().layout?.overrides)
}

export function setLayoutOverrides(overrides: LayoutFile): void {
  const cfg = loadConfig()
  writeLayout(cfg, { overrides })
  save(cfg)
}

// ---- reading (read-shaping B3) ----

/** Tolerant read: missing, partial or garbage → the defaults, like `layout`. */
function normalizeRead(raw: unknown): ReadPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReadPrefs, unknown>>
  return {
    defaultMode: VIEW_MODES.includes(r.defaultMode as ViewMode)
      ? (r.defaultMode as ViewMode)
      : READ_DEFAULTS.defaultMode,
  }
}

export function readPrefs(): ReadPrefs {
  return normalizeRead(loadConfig().read)
}

export function setReadPrefs(patch: Partial<ReadPrefs>): void {
  const cfg = loadConfig()
  cfg.read = { ...normalizeRead(cfg.read), ...patch }
  save(cfg)
}

// ---- hotkeys (tab-groups R1.3) ----

/**
 * The legacy per-device binding overrides (before keymaps were files),
 * normalized. Read only by the keymap migration (`keymap.svelte.ts`), which
 * applies them until a vault is open and then writes them into a keymap
 * file — nothing writes them any more.
 */
export function hotkeys(): BindingOverrides {
  return normalizeOverrides(loadConfig().hotkeys)
}

/**
 * Forget the legacy per-device override map — after it has been written into
 * a keymap file (the F10 migration), so it is never read again.
 */
export function clearHotkeys(): void {
  const cfg = loadConfig()
  delete cfg.hotkeys
  save(cfg)
}

// ---- the drawer's read state (quiet-shell F13) ----

/** When this vault's notification drawer was last opened on this device; null if never. */
export function drawerSeenAt(room: string): number | null {
  const at = loadConfig().drawerSeen?.[room]
  return typeof at === 'number' && Number.isFinite(at) ? at : null
}

export function setDrawerSeenAt(room: string, at: number): void {
  const cfg = loadConfig()
  const seen = cfg.drawerSeen && typeof cfg.drawerSeen === 'object' ? cfg.drawerSeen : {}
  cfg.drawerSeen = { ...seen, [room]: at }
  save(cfg)
}

// ---- keymap (quiet-shell F10) ----

/** The active keymap choice; anything unreadable reads as `default`. */
export function keymapChoice(): KeymapChoice {
  return parseKeymapChoice(loadConfig().keymap?.active) ?? 'default'
}

export function setKeymapChoice(choice: KeymapChoice): void {
  if (!parseKeymapChoice(choice)) return
  const cfg = loadConfig()
  cfg.keymap = { ...cfg.keymap, active: choice }
  save(cfg)
}

export function setDevtools(on: boolean): void {
  const cfg = loadConfig()
  cfg.devtools = on
  save(cfg)
}

export function operatorSecret(): string {
  return loadConfig().operatorSecret
}

export function setOperatorSecret(secret: string): void {
  const cfg = loadConfig()
  cfg.operatorSecret = secret.trim()
  save(cfg)
}

/** Bearer token for a room this device created/joined a share of ('' = none). */
export function roomToken(room: string): string {
  return loadConfig().tokensByRoom[room]?.token ?? ''
}

/**
 * What KIND of token this device holds for a room ('' = none). A 'device'
 * token is the vault's own credential and the relay accepts it in rooms
 * carved out of that vault; a 'folder' token is exact-match, always.
 */
export function roomTokenKind(room: string): ShareKind | '' {
  const held = loadConfig().tokensByRoom[room]
  if (!held) return ''
  return held.kind ?? 'folder'
}

/** Relay the room's token belongs to ('' = unknown; see relayByRoom). */
export function roomRelay(room: string): string {
  return loadConfig().relayByRoom[room] ?? ''
}

/**
 * Remember a room's token, and the relay it is a credential for when the
 * caller knows it. Passing a blank relay leaves a remembered one alone.
 */
export function setRoomToken(room: string, token: string, relay?: string, kind?: ShareKind): void {
  const cfg = loadConfig()
  if (token) {
    cfg.tokensByRoom[room] = { token, kind: kind ?? cfg.tokensByRoom[room]?.kind ?? 'folder' }
  } else {
    delete cfg.tokensByRoom[room]
  }
  if (relay?.trim()) cfg.relayByRoom[room] = relay.trim()
  save(cfg)
}

/**
 * Every {room, relay, token} triple this device holds — the payload of a
 * device link's `grants` (device-link-shaping A4-B). A room whose relay was
 * never recorded falls back to the vault entry that carries it, then to the
 * default relay: shares are minted against the relay in Settings, and a
 * wrong guess costs one paste, not a lost token.
 */
export function grantsForBundle(): ShareGrant[] {
  const cfg = loadConfig()
  const fallback = cfg.defaultRelay || DEFAULT_RELAY
  const out: ShareGrant[] = []
  for (const [room, held] of Object.entries(cfg.tokensByRoom)) {
    const token = held?.token
    if (!token) continue
    const relay =
      cfg.relayByRoom[room] ??
      cfg.vaults.find((v) => v.room === room)?.relay?.url ??
      fallback
    out.push({ room, relay, token })
  }
  return out
}

/**
 * Merge the grants carried by a device link into this device's tokens. An
 * existing token is never overwritten: the local one may be newer than the
 * bundle (re-minted since the link was copied), and losing it would strand
 * a mount that is connected right now. Returns the rooms actually stored.
 *
 * Tokens only — mounts.json remains the authority on which mounts exist and
 * where they live; a grant for a room this device has no mount for simply
 * waits until one arrives (peer-side adopt, A3).
 */
export function mergeGrants(grants: readonly ShareGrant[]): string[] {
  const cfg = loadConfig()
  const stored: string[] = []
  for (const g of grants) {
    if (!g?.room || !g.token) continue
    if (cfg.tokensByRoom[g.room]) continue
    // Grants are always folder credentials: only the link's own top-level
    // token is the device key (spike S10 Q7).
    cfg.tokensByRoom[g.room] = { token: g.token, kind: 'folder' }
    if (g.relay) cfg.relayByRoom[g.room] = g.relay
    stored.push(g.room)
  }
  if (stored.length > 0) save(cfg)
  return stored
}

// ---- shares ----

export function loadShares(): StoredShare[] {
  return loadConfig().shares
}

/** Add or replace a share (deduped by room). */
export function addShare(share: StoredShare): void {
  const cfg = loadConfig()
  cfg.shares = [share, ...cfg.shares.filter((s) => s.room !== share.room)]
  save(cfg)
}

export function removeShare(room: string): void {
  const cfg = loadConfig()
  cfg.shares = cfg.shares.filter((s) => s.room !== room)
  save(cfg)
}
