/**
 * Boot helpers: translate the two entry points — the memory URL contract (dev /
 * Playwright) and a persisted/onboarded SessionDesc — into a WorkspaceConfig.
 *
 * There is no boot "mode" anymore (spike S8 Q3): the mount decides from its
 * durable stores whether this is a reopen. `firstJoin` only says how to
 * BOOTSTRAP when no durable state exists — true for a real first join, and as
 * a fallback for any relay-attached session whose stores are gone (enrolling
 * fresh GUIDs into an existing room would double its content). The memory
 * seeder is the one enroll-with-relay case, and only via the URL path.
 */
import type { MemoryModeConfig } from './params.js'
import type { SessionDesc } from './config.js'
import type { WorkspaceConfig } from './workspace.svelte.js'
import { buildAdapter, buildStoreDir } from './vault-adapter.js'

export function newFolderGuid(): string {
  return crypto.randomUUID()
}

/** WorkspaceConfig for the memory dev/e2e URL contract (behavior unchanged). */
export async function configForMemory(cfg: MemoryModeConfig): Promise<WorkspaceConfig> {
  const adapter = await buildAdapter({ kind: 'memory' })
  const storeDir = await buildStoreDir({ kind: 'memory' }, cfg.room)
  const relay = { url: cfg.relay, token: cfg.token }
  return cfg.role === 'seed'
    ? { adapter, storeDir, user: cfg.user, room: cfg.room, relay, seedDemo: true }
    : { adapter, storeDir, user: cfg.user, room: cfg.room, firstJoin: true, relay }
}

/** WorkspaceConfig for a persisted/onboarded session. */
export async function configForSession(desc: SessionDesc, user: string): Promise<WorkspaceConfig> {
  const adapter = await buildAdapter(desc.vault)
  const storeDir = await buildStoreDir(desc.vault, desc.room)
  return {
    adapter,
    storeDir,
    user,
    room: desc.room,
    firstJoin: desc.firstJoin === true || Boolean(desc.relay),
    relay: desc.relay,
    ...(desc.readOnly === true ? { readOnly: true } : {}),
  }
}
