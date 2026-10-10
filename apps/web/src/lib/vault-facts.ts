/**
 * What a vault row in the manager says about the vault (first-run B1): how
 * many folders it shares out and how many it holds from others, and when it
 * was last opened.
 *
 * The counts come from the vault's own mount table (`mounts.json` in its
 * store namespace) — the same file `forgetVaultState` and the boot read —
 * so a row says exactly what the table says: never a person, never
 * "online". `carved` and `adopted`-from-your-own-relay count as shared BY
 * you, `joined` and a foreign `adopted` as shared WITH you; the Shared
 * view's `sharedSnapshot` draws the same line.
 *
 * For the vault open behind the manager the live `workspace.ui.mounts` is
 * used instead (`factsFromUi`); for the rest, one small JSON read each
 * (`readVaultFacts`). An unreadable table is `null`: the row says "—",
 * never zero.
 */
import { roomRelayUrl } from '@ohhi/workspace'
import { MountsFile, type MountDesc } from '@ohhi/vault'
import { defaultRelay, roomRelay, type VaultEntry } from './config.js'
import { isForeignMount } from './share-status.js'
import { buildStoreDir } from './vault-adapter.js'

export interface VaultFacts {
  /** Folders carved out of this vault and shared by you. */
  sharedByYou: number
  /** Folders someone else shared that live in this vault. */
  sharedWithYou: number
}

/** Count a mount table (`mounts.json`). `rootRelay` decides an adopted mount's side. */
export function factsFromMounts(mounts: readonly MountDesc[], rootRelay: string): VaultFacts {
  const facts: VaultFacts = { sharedByYou: 0, sharedWithYou: 0 }
  for (const m of mounts) {
    if (m.path === '' || m.provenance === 'local') continue
    const foreign = isForeignMount({ provenance: m.provenance, relay: m.relay?.url || roomRelay(m.room) }, rootRelay)
    if (foreign) facts.sharedWithYou++
    else facts.sharedByYou++
  }
  return facts
}

/** The open vault's facts, from the workspace's live projection of the same table. */
export function factsFromUi(mounts: readonly { path: string; provenance: MountDesc['provenance']; foreign: boolean }[]): VaultFacts {
  const facts: VaultFacts = { sharedByYou: 0, sharedWithYou: 0 }
  for (const m of mounts) {
    if (m.path === '' || m.provenance === 'local') continue
    if (m.foreign) facts.sharedWithYou++
    else facts.sharedByYou++
  }
  return facts
}

/** Read a vault's mount table through the same store-dir builders the boot uses. */
export async function readMountTable(entry: VaultEntry): Promise<MountDesc[]> {
  if (entry.vault.kind === 'memory') return [] // per-boot stores: nothing durable to read
  const dir = await buildStoreDir(entry.vault, entry.room)
  return await new MountsFile(dir.io('mounts.json')).load()
}

/** A vault's facts, or null when its table could not be read. */
export async function readVaultFacts(
  entry: VaultEntry,
  read: (entry: VaultEntry) => Promise<MountDesc[]> = readMountTable
): Promise<VaultFacts | null> {
  try {
    const rootRelay = roomRelayUrl(entry.relay?.url, roomRelay(entry.room), defaultRelay())
    return factsFromMounts(await read(entry), rootRelay)
  } catch {
    return null
  }
}

/** When a vault was last opened, in calendar days as this device counts them. */
export type OpenedWhen = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; date: string }

/** Pure: `at` against `now`, local calendar days; older dates formatted for `locale`. */
export function openedWhen(at: number, now: number, locale?: string): OpenedWhen {
  const day = (ms: number): number => {
    const d = new Date(ms)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const today = day(now)
  const then = day(at)
  if (then >= today) return { kind: 'today' }
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (then >= yesterday.getTime()) return { kind: 'yesterday' }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  const date = new Date(at).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return { kind: 'date', date }
}
