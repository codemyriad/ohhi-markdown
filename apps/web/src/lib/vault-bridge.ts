/**
 * The other half of one-tab-per-vault (`vault-lock.ts`, join-share-brief
 * P3): a share link opened in a NEW tab while the vault it should land in is
 * open in another. Refusing the second tab would send the person back to
 * close tabs; instead the join is handed to the tab that holds the vault,
 * over a `BroadcastChannel` named for the vault, and that tab mounts the
 * folder — the one place the vault is live. The sender waits briefly for an
 * acknowledgement; none (no tab holds the vault, or the holder is a hung
 * tab) means the sender opens the vault itself, and the lock decides.
 *
 * Messages are data, never instructions: the holder only ever runs the one
 * join the message describes, through the same path as its own Add dialog.
 */
import type { Clock } from '@ohhi/vault'

/** What a tab asks the vault's holder to do. */
export interface JoinHandOff {
  link: string
  dest: string
  /** "Your name" as the sender saved it; the holder saves nothing. */
  name: string
}

type Message = { kind: 'join'; join: JoinHandOff; id: string } | { kind: 'join-ack'; id: string }

/** The slice of `BroadcastChannel` this uses; a test hands in a fake pair. */
export interface VaultChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  close(): void
}

export const vaultChannelName = (id: string): string => `ohhi:vault:${id}`

const openChannel = (id: string): VaultChannel | null =>
  typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(vaultChannelName(id)) as unknown as VaultChannel)

function isJoin(data: unknown): data is Extract<Message, { kind: 'join' }> {
  if (typeof data !== 'object' || data === null) return false
  const m = data as Record<string, unknown>
  if (m['kind'] !== 'join' || typeof m['id'] !== 'string') return false
  const j = m['join']
  if (typeof j !== 'object' || j === null) return false
  const join = j as Record<string, unknown>
  return typeof join['link'] === 'string' && typeof join['dest'] === 'string' && typeof join['name'] === 'string'
}

/**
 * The holder's side: while a vault is open in this tab, answer hand-offs for
 * it. Returns the function that stops listening (the vault closed, or the
 * tab opened another).
 */
export function openVaultBridge(
  id: string,
  onJoin: (join: JoinHandOff) => void,
  channel: VaultChannel | null = openChannel(id)
): () => void {
  if (!channel) return () => {}
  const listener = (ev: { data: unknown }): void => {
    if (!isJoin(ev.data)) return
    // Acknowledge FIRST: the sender's wait is short, the mount is not.
    channel.postMessage({ kind: 'join-ack', id: ev.data.id } satisfies Message)
    onJoin(ev.data.join)
  }
  channel.addEventListener('message', listener)
  return () => {
    channel.removeEventListener('message', listener)
    channel.close()
  }
}

/** How long a sender waits for the holder's acknowledgement. */
export const HAND_OFF_WAIT_MS = 400

/**
 * The sender's side: offer the join to whichever tab holds the vault.
 * Resolves true once a holder acknowledged (it will do the join), false when
 * none did within the wait — then the caller opens the vault itself.
 */
export function handOffJoin(
  id: string,
  join: JoinHandOff,
  clock: Clock,
  channel: VaultChannel | null = openChannel(id),
  waitMs = HAND_OFF_WAIT_MS
): Promise<boolean> {
  if (!channel) return Promise.resolve(false)
  const requestId = `${clock.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      cancel()
      channel.removeEventListener('message', listener)
      channel.close()
      resolve(ok)
    }
    const listener = (ev: { data: unknown }): void => {
      const m = ev.data as Partial<Message> | null
      if (m && m.kind === 'join-ack' && m.id === requestId) finish(true)
    }
    channel.addEventListener('message', listener)
    const cancel = clock.schedule(() => finish(false), waitMs)
    channel.postMessage({ kind: 'join', join, id: requestId } satisfies Message)
  })
}
