/**
 * Persisted onboarding state (onboarding-shaping.md A3). Everything the shell
 * needs to skip the landing screen on relaunch (R2) and to remember shares you
 * created or joined. Backed by localStorage; all access is guarded so a missing
 * or throwing storage (private mode, SSR) degrades to "nothing remembered"
 * rather than crashing the boot.
 *
 * The `SessionDesc` is the bootable description of a workspace: how to build its
 * vault backend, its folder GUID (room), and an optional relay to sync through.
 */
import { isTauri } from './platform.js'

/** How to (re)build the VaultAdapter for a session. */
export type VaultSourceDesc =
  | { kind: 'memory' }
  | { kind: 'tauri'; path: string }
  | { kind: 'opfs'; id: string }

export interface SessionDesc {
  vault: VaultSourceDesc
  /** Folder GUID: internal doc-name prefix, and the relay room when shared. */
  room: string
  /** Present → connect to the relay (background for local, awaited for a first join). */
  relay?: { url: string; token: string }
  /**
   * A vault with no local files yet that must pull its content from the relay
   * before it can render (a first join). Reopens leave this false and enroll
   * from the local backend instead.
   */
  firstJoin?: boolean
}

export interface StoredShare {
  link: string
  /** Folder GUID, used to dedupe. */
  room: string
  label: string
}

const K_USER = 'editor:user'
const K_LAST = 'editor:lastSession'
const K_SHARES = 'editor:shares'

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

function remove(key: string): void {
  try {
    store()?.removeItem(key)
  } catch {
    /* ignore */
  }
}

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

export function loadLastSession(): SessionDesc | null {
  const s = readJson<SessionDesc>(K_LAST)
  if (!s || typeof s.room !== 'string' || !s.vault) return null
  return s
}

/** Persist the last session so relaunch reopens it. Pass null to clear. */
export function saveLastSession(session: SessionDesc | null): void {
  if (session === null) {
    remove(K_LAST)
    return
  }
  // A first-join is only special once — on reopen we enroll from the local
  // backend, so never persist firstJoin as true.
  writeJson(K_LAST, { ...session, firstJoin: false })
}

export function loadShares(): StoredShare[] {
  const list = readJson<StoredShare[]>(K_SHARES)
  return Array.isArray(list) ? list.filter((s) => s && typeof s.link === 'string') : []
}

/** Add or replace a share (deduped by room). */
export function addShare(share: StoredShare): void {
  const list = loadShares().filter((s) => s.room !== share.room)
  list.unshift(share)
  writeJson(K_SHARES, list)
}

export function removeShare(room: string): void {
  writeJson(
    K_SHARES,
    loadShares().filter((s) => s.room !== room)
  )
}

/** Default vault-source kind for a browser join on this platform. */
export function browserVaultKind(): 'tauri' | 'opfs' {
  return isTauri() ? 'tauri' : 'opfs'
}
