/**
 * Persistent storage for browser vaults. OPFS is "best-effort": the browser
 * may evict it (Safari also after a stretch without use) unless the site holds
 * the persistent-storage grant — and a note outside a shared folder exists
 * nowhere else. The desktop app keeps real files and never runs this.
 *
 * How browsers answer `persist()` shapes the copy and the retry: Chrome/Edge
 * grant or refuse silently by heuristics (installed, bookmarked, engagement),
 * so a refusal is never the user's doing; Firefox prompts and wants a user
 * gesture, so the retry runs straight from a click; Safari 17+ supports it.
 *
 * Pure — each function takes the `StorageManager` slice it needs — so it
 * tests on node. The reactive state is `storage.svelte.ts`.
 */

export type PersistState =
  /** Not checked yet (and, under Tauri, never). */
  | 'unknown'
  /** The browser has promised to keep this site's storage. */
  | 'persisted'
  /** The browser may evict this site's storage; asking again is possible. */
  | 'best-effort'
  /** No persistence API: nothing to ask, and nothing guaranteed. */
  | 'unsupported'

/** The slice of `navigator.storage` this module uses. */
export interface PersistApi {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

export function browserStorage(): PersistApi | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : navigator.storage
  } catch {
    return undefined
  }
}

/** What the browser has already decided — asks nothing. Never rejects. */
export async function readPersistence(api: PersistApi | undefined): Promise<PersistState> {
  if (typeof api?.persisted !== 'function' || typeof api.persist !== 'function') return 'unsupported'
  try {
    return (await api.persisted()) ? 'persisted' : 'best-effort'
  } catch {
    return 'best-effort'
  }
}

/**
 * Ask the browser to keep this site's storage. Deliberately not `async`:
 * `persist()` is called synchronously, so a click handler that calls this
 * directly still carries its user activation — which Firefox's prompt wants.
 * Never rejects.
 */
export function requestPersistence(api: PersistApi | undefined): Promise<PersistState> {
  if (typeof api?.persist !== 'function') return Promise.resolve('unsupported')
  let asked: Promise<boolean>
  try {
    asked = api.persist()
  } catch {
    return Promise.resolve('best-effort')
  }
  return Promise.resolve(asked).then(
    (kept): PersistState => (kept ? 'persisted' : 'best-effort'),
    (): PersistState => 'best-effort'
  )
}

/** Launch: read the browser's decision, and ask only when it has not agreed. */
export async function checkThenRequest(api: PersistApi | undefined): Promise<PersistState> {
  const state = await readPersistence(api)
  return state === 'best-effort' ? requestPersistence(api) : state
}

/**
 * One check-then-ask per page, shared by every caller. The app's launch and
 * the OPFS store dir's creation both want it; asking twice would mean two
 * Firefox prompts for one decision.
 */
export function persistOnce(api: () => PersistApi | undefined): () => Promise<PersistState> {
  let once: Promise<PersistState> | null = null
  return () => (once ??= checkThenRequest(api()))
}

export const ensurePersistence = persistOnce(browserStorage)

export interface StorageWarningInput {
  tauri: boolean
  /** The user has, or is about to create, a vault whose bytes live in this browser. */
  browserVault: boolean
  state: PersistState
  /** Dismissed on this device (config `storageNoticeDismissed`). */
  dismissed: boolean
}

/** The browser has answered, and not with a promise to keep the storage. */
export function notGuaranteed(state: PersistState): boolean {
  return state === 'best-effort' || state === 'unsupported'
}

/**
 * Whether to tell the user their browser storage is not guaranteed. Only
 * where a browser vault is at stake, only once the browser has answered
 * (never on `unknown` — the note must not flash while the check runs), and
 * never again once dismissed on this device.
 */
export function shouldWarnAboutStorage(input: StorageWarningInput): boolean {
  if (input.tauri || !input.browserVault || input.dismissed) return false
  return notGuaranteed(input.state)
}

export interface StorageUsage {
  usage: number
  quota: number
}

/** The browser's usage/quota estimate, or null when it has none. Never rejects. */
export async function estimateUsage(api: PersistApi | undefined): Promise<StorageUsage | null> {
  if (typeof api?.estimate !== 'function') return null
  try {
    const { usage, quota } = await api.estimate()
    return typeof usage === 'number' && typeof quota === 'number' ? { usage, quota } : null
  } catch {
    return null
  }
}

const UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

/**
 * Bytes as the reader's locale writes them (SI, 1000-based — the units Intl
 * names). Starts at kilobytes: "512 byte" reads worse than "0.5 kB".
 */
export function formatBytes(bytes: number, locale?: string): string {
  let value = Math.max(0, bytes) / 1000
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}
