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

export const DEFAULT_RELAY = 'ws://localhost:8787'

interface AppConfigV2 {
  version: 2
  vaults: VaultEntry[]
  /** Room of the vault to auto-reopen on launch; null → show the manager. */
  lastRoom: string | null
  defaultRelay: string
  /** Relay admin credential for in-app token minting (M4). '' = unset. */
  operatorSecret: string
  shares: StoredShare[]
  /**
   * Bearer token per room for shares this device created or joined (M4).
   * Tokens NEVER live in mounts.json/folder maps (parent D4: descs are
   * advisory, never an auth source) — only here, in app config.
   */
  tokensByRoom: Record<string, string>
}

const K_USER = 'editor:user'
const K_CONFIG = 'editor:config'
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

function readJson<T>(key: string): T | null {
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

function writeJson(key: string, value: unknown): void {
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
    defaultRelay: DEFAULT_RELAY,
    operatorSecret: '',
    shares: [],
    tokensByRoom: {},
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
    // Field added after v2 shipped — backfill for configs written before M4.
    existing.tokensByRoom ??= {}
    return existing
  }
  // First run on v2 (or corrupted v2 blob): rebuild from v1 keys, persist,
  // and never look at v1 again. Corruption falls back the same way — the
  // vault registry only holds pointers, never content (files are canonical).
  const migrated = migrateV1()
  writeJson(K_CONFIG, migrated)
  return migrated
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

/** Forget a vault (config only — never touches its files). */
export function removeVault(room: string): void {
  const cfg = loadConfig()
  cfg.vaults = cfg.vaults.filter((v) => v.room !== room)
  if (cfg.lastRoom === room) cfg.lastRoom = null
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

/** Attach/replace the relay recorded for a vault (after enableSharing). */
export function setVaultRelay(room: string, relay: { url: string; token: string }): void {
  const cfg = loadConfig()
  const entry = cfg.vaults.find((v) => v.room === room)
  if (!entry) return
  entry.relay = relay
  save(cfg)
}

// ---- settings ----

export function defaultRelay(): string {
  return loadConfig().defaultRelay || DEFAULT_RELAY
}

export function setDefaultRelay(url: string): void {
  const cfg = loadConfig()
  cfg.defaultRelay = url.trim() || DEFAULT_RELAY
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
  return loadConfig().tokensByRoom[room] ?? ''
}

export function setRoomToken(room: string, token: string): void {
  const cfg = loadConfig()
  cfg.tokensByRoom[room] = token
  save(cfg)
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
