/**
 * Device-link N3 harness — the three token routes against the REAL relay.
 *
 * `fixture.ts` (bootVault/bootDuo) proves the adopt machine over a simulated
 * room: doc instances wired by name, `DeadSocket` where the providers would
 * be. That is the right shape for the L1 races, and it is the wrong shape for
 * N3, whose whole subject is a claim about the SERVER — that a `device`-kind
 * token is accepted in a room carved out of its own room, that a `folder`
 * token is not, and that both facts reach the client as `MountSession` state
 * rather than as a reconnect loop. None of that is a claim a simulator can
 * settle, so this harness boots the same machines (`carveFolder`, `joinMount`,
 * `reconcileMountEntries`) over real sockets against `apps/relay` running as a
 * child process — the way `providers.test.ts` and `pull-progress.test.ts` do.
 *
 * What is real here: the relay (a child process on an ephemeral port with its
 * own throwaway DATA_DIR — the repo's `apps/relay/data` is never touched), the
 * WebSockets, the Hocuspocus handshake, the admin API that mints and revokes,
 * and the `RealClock` every session runs on. What is simulated: the vault
 * backend (`MemVaultAdapter`) and the durable stores (`MemStoreDir`), because
 * the filesystem is not what N3 is about and a memory vault keeps the suite
 * inside its budget.
 *
 * The two host-shaped pieces the web shell owns are mirrored here rather than
 * imported (`apps/web` is not a dependency of this package, and must not
 * become one): `TokenStore` is `config.ts`'s `tokensByRoom`/`relayByRoom` with
 * kinds, `grantsForBundle` and `mergeGrants`; the link codec is
 * `share-link.ts`'s wire format; `relayFor` is `workspace.svelte.ts`'s
 * `relayForRoom`, i.e. spike S10 Q2's lookup order. Where this harness differs
 * from the shim, it says so at the point of difference.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { createYjsEngine, type SyncEngine } from '@ohhi/sync'
import { RealClock } from '@ohhi/testkit'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  isRecoverable,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  mountRootsFrom,
  scopedAdapter,
  scopedStoreDir,
  type MountDesc,
  type MountProvenance,
  type StoreDir,
} from '@ohhi/vault'
import { startRelay, type RelayHandle } from '../bench/relay-child.js'
import {
  bootFlagsFor,
  mountInvariants,
  reconcileMountEntries,
  type AdoptContext,
  type AdoptedMountOptions,
  type AdoptNotice,
} from '../src/adopt.js'
import { activateMount } from '../src/activate.js'
import { resolveRoomRelay } from '../src/resolve-relay.js'
import { carveFolder } from '../src/carve.js'
import { joinMount } from '../src/join.js'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import { recoverMounts } from '../src/vault-boot.js'
import {
  FOLDER_RECORD_KEY,
  type PullProgress,
  type RelayConfig,
  type SyncRecordFields,
} from '../src/types.js'

export const enc = new TextEncoder()
export const dec = new TextDecoder()

/** The operator secret every relay in this suite is started with. */
export const OPERATOR_SECRET = 'device-link-n3-operator-secret'

// --------------------------------------------------------------- the relay

export interface TestRelay {
  /** `ws://127.0.0.1:<port>` — what a mount connects to. */
  url: string
  /** `http://127.0.0.1:<port>` — the admin API (admin.ts). */
  adminUrl: string
  /** The relay's throwaway DATA_DIR (`relay.db` lives in it). */
  dataDir: string
  stop(): Promise<void>
}

/**
 * Spawn `apps/relay` with the admin API enabled. `bench/relay-child.ts` owns
 * the spawn (it is imported, never copied — the same reason `providers.test.ts`
 * imports it), and it inherits `process.env`, so the operator secret is set
 * here rather than by growing that module a parameter it has no other caller
 * for.
 */
export async function startTestRelay(label: string): Promise<TestRelay> {
  const dataDir = mkdtempSync(join(tmpdir(), `editor-${label}-relay-`))
  process.env.OPERATOR_SECRET = OPERATOR_SECRET
  // No SEED_SHARE: every token in this suite is minted through the admin API,
  // because `kind` and `parent` are exactly what is under test.
  const handle: RelayHandle = await startRelay({ dataDir, seedShare: '' })
  return {
    url: handle.url,
    adminUrl: handle.url.replace(/^ws/, 'http'),
    dataDir,
    stop: async () => {
      await handle.stop()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

const RELAY_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/relay')

/**
 * Write (or, with `null`, delete) one document's stored state in a running
 * relay's database, behind its back — the way to make the relay fail to set
 * a document up (`state` that is not a Yjs update) and then stop failing.
 * Runs in a child `node` from `apps/relay`, whose `better-sqlite3` this
 * package does not depend on (and must not). The relay holds the database in
 * WAL mode, so a second writer is safe; the change is seen on the next LOAD
 * of the document, i.e. while no client holds it open.
 */
export function putRelayDocState(relay: TestRelay, name: string, state: Uint8Array | null): void {
  const script = `
    const Database = require('better-sqlite3')
    const db = new Database(process.argv[1])
    const [name, hex] = [process.argv[2], process.argv[3]]
    if (hex === '-') db.prepare('DELETE FROM docs WHERE name = ?').run(name)
    else db.prepare('INSERT OR REPLACE INTO docs (name, state, updated_at) VALUES (?, ?, ?)')
      .run(name, Buffer.from(hex, 'hex'), new Date().toISOString())
    db.close()
  `
  const hex = state === null ? '-' : Buffer.from(state).toString('hex')
  const res = spawnSync('node', ['-e', script, join(relay.dataDir, 'relay.db'), name, hex], {
    cwd: RELAY_DIR,
    encoding: 'utf8',
  })
  if (res.status !== 0) throw new Error(`putRelayDocState failed: ${res.stderr}`)
}

export interface MintedShare {
  token: string
  folderGuid: string
  readOnly: boolean
  label: string | null
  kind: TokenKind
  parent?: string
}

/** `POST /shares` — the mint body spike S10 Q3 fixes (relay-admin.ts's twin). */
export async function mintShare(
  relay: TestRelay,
  body: {
    folderGuid: string
    label?: string
    readOnly?: boolean
    kind?: TokenKind
    parent?: string
  }
): Promise<MintedShare> {
  const res = await fetch(`${relay.adminUrl}/shares`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPERATOR_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await res.json()) as MintedShare & { error?: string }
  if (!res.ok) throw new Error(`mint failed (${res.status}): ${payload.error}`)
  return payload
}

/** `DELETE /shares/:token` — revocation, with its recorded live-socket limit. */
export async function revokeShare(relay: TestRelay, token: string): Promise<void> {
  const res = await fetch(`${relay.adminUrl}/shares/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${OPERATOR_SECRET}` },
  })
  if (!res.ok) throw new Error(`revoke failed (${res.status})`)
}

// ------------------------------------------------------- tokens + the link

export type TokenKind = 'folder' | 'device'

/** One room's credential, as a device link bundles it (A4-B). */
export interface ShareGrant {
  room: string
  relay: string
  token: string
}

/**
 * `config.ts`'s `tokensByRoom` + `relayByRoom`, in memory: what this device
 * was given, for which room, of which kind, on which relay. Descs and maps
 * never carry a token (shaping D4) — this is the only place one lives.
 */
export class TokenStore {
  private tokens = new Map<string, { token: string; kind: TokenKind }>()
  private relays = new Map<string, string>()

  constructor(private readonly defaultRelayUrl: string) {}

  set(room: string, token: string, relay?: string, kind: TokenKind = 'folder'): void {
    if (token) this.tokens.set(room, { token, kind })
    else this.tokens.delete(room)
    if (relay) this.relays.set(room, relay)
  }

  token(room: string): string {
    return this.tokens.get(room)?.token ?? ''
  }

  kind(room: string): TokenKind | '' {
    return this.tokens.get(room)?.kind ?? ''
  }

  relayOf(room: string): string {
    return this.relays.get(room) ?? ''
  }

  has(room: string): boolean {
    return this.tokens.has(room)
  }

  /** `config.grantsForBundle()`: every {room, relay, token} this device holds. */
  grantsForBundle(): ShareGrant[] {
    return [...this.tokens.entries()].map(([room, held]) => ({
      room,
      relay: this.relays.get(room) ?? this.defaultRelayUrl,
      token: held.token,
    }))
  }

  /**
   * `config.mergeGrants()`: never overwrite a token this device already holds
   * (the local one may be newer than the bundle), and grants are always
   * FOLDER credentials — only a link's own top-level token is the device key
   * (spike S10 Q7). Returns the rooms actually stored.
   */
  mergeGrants(grants: readonly ShareGrant[]): string[] {
    const stored: string[] = []
    for (const g of grants) {
      if (!g?.room || !g.token || this.tokens.has(g.room)) continue
      this.tokens.set(g.room, { token: g.token, kind: 'folder' })
      if (g.relay) this.relays.set(g.room, g.relay)
      stored.push(g.room)
    }
    return stored
  }
}

export interface DecodedLink {
  relay: string
  room: string
  token: string
  kind: TokenKind
  grants: ShareGrant[]
}

const LINK_PREFIX = 'editor1:'

/** `share-link.ts`'s wire format: `editor1:` + base64url(JSON), v stays 1. */
export function encodeShareLink(t: {
  relay: string
  room: string
  token: string
  kind?: TokenKind
  grants?: ShareGrant[]
}): string {
  const kind = t.kind ?? 'folder'
  const grants = (t.grants ?? []).filter((g) => g.room !== t.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new Error('only a device link may carry grants')
  }
  const json = JSON.stringify({
    v: 1,
    relay: t.relay,
    room: t.room,
    token: t.token,
    ...(kind === 'device' ? { kind } : {}),
    ...(grants.length > 0 ? { grants } : {}),
  })
  return LINK_PREFIX + Buffer.from(json, 'utf8').toString('base64url')
}

/** *Link a device* (A1/A4-B): the root room's device token plus the grants. */
export function encodeDeviceLink(t: {
  relay: string
  room: string
  token: string
  grants?: ShareGrant[]
}): string {
  return encodeShareLink({ ...t, kind: 'device' })
}

export function decodeShareLink(link: string): DecodedLink {
  const trimmed = link.trim()
  const body = trimmed.startsWith(LINK_PREFIX) ? trimmed.slice(LINK_PREFIX.length) : trimmed
  const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
  if (typeof o.relay !== 'string' || typeof o.room !== 'string' || typeof o.token !== 'string') {
    throw new Error('share link is missing relay/room/token')
  }
  const kind: TokenKind = o.kind === 'device' ? 'device' : 'folder'
  const grants = ((o.grants ?? []) as ShareGrant[]).filter((g) => g.room !== o.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new Error('only a device link may carry grants')
  }
  return { relay: o.relay, room: o.room, token: o.token, kind, grants }
}

// -------------------------------------------------------------- the device

export interface BuildRecord {
  room: string
  path: string
  firstJoin: boolean
  /** The credential `relayFor` resolved, or null for a provider-less mount. */
  token: string | null
  relay: string | null
}

export interface Device {
  id: string
  engine: SyncEngine
  /** A getter: an absorb shuts the root down and rebuilds it. */
  readonly root: MountSession
  mounts: Map<string, MountSession>
  mountsFile: MountsFile
  vaultDir: StoreDir
  adapter: MemVaultAdapter
  ignore: Set<string>
  tokens: TokenStore
  rootRoom: string
  relayUrl: string
  /** Every sync record the sessions mutate; `//folder:<room>` per mount. */
  records: Map<string, SyncRecordFields>
  notices: AdoptNotice[]
  builds: BuildRecord[]
  /** Two-phase progress reported by a pull someone pasted their way into. */
  pulls: PullProgress[]
  errors: string[]
  descs: () => readonly MountDesc[]
  registry: () => { mountPath: string; session: MountSession }[]
  reconcile: () => Promise<void>
  refreshDescs: () => Promise<void>
  relayFor: (m: {
    room: string
    path: string
    relay?: string
    provenance: MountProvenance
  }) => RelayConfig | null
  buildMount: (o: AdoptedMountOptions) => Promise<MountSession>
  attach: (path: string, session: MountSession) => void
  detach: (path: string) => MountSession | null
  shutdown: () => Promise<void>
}

export interface DeviceOptions {
  id: string
  adapter: MemVaultAdapter
  vaultDir: StoreDir
  rootRoom: string
  /** The relay THIS vault's root room lives on. */
  relayUrl: string
  tokens: TokenStore
  /** Pull the whole vault into an empty folder (a freshly linked device, R4). */
  firstJoin?: boolean
}

/**
 * Boot a vault the way the shim does: recoverMounts, the root over
 * `ignoringAdapter`, every settled mount over `scopedAdapter`, per-room store
 * namespaces, guid-keyed records, the derived ignore set, and the adopt
 * machine on the root's mount-entry hook.
 */
export async function bootDevice(opts: DeviceOptions): Promise<Device> {
  const engine = createYjsEngine()
  const clock = new RealClock()
  const mountsFile = new MountsFile(opts.vaultDir.io('mounts.json'))
  await recoverMounts(opts.vaultDir, mountsFile, engine)

  let descs = await mountsFile.load()
  const ignore = new Set<string>()
  const records = new Map<string, SyncRecordFields>()
  const notices: AdoptNotice[] = []
  const pulls: PullProgress[] = []
  const builds: BuildRecord[] = []
  const errors: string[] = []
  const mounts = new Map<string, MountSession>()
  let root: MountSession | null = null

  const recordFor = (key: string): SyncRecordFields => {
    let rec = records.get(key)
    if (!rec) {
      rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
      records.set(key, rec)
    }
    return rec
  }

  const refreshIgnore = (): void => {
    const next = mountRootsFrom(descs, root?.mapEntries() ?? [])
    ignore.clear()
    for (const p of next) ignore.add(p)
  }
  const reloadDescs = async (): Promise<void> => {
    descs = await mountsFile.load()
    refreshIgnore()
  }

  /**
   * The credential rule — `resolveRoomRelay` from libs/workspace, the SAME
   * function the web shim binds to its config.
   *
   * This used to be a paraphrase of it, and the paraphrase drifted: it
   * compared relay URLs with raw `===`, so `ws://relay.test` and
   * `ws://relay.test/` were two relays here and one relay there. A harness
   * whose whole job is catching the shim drifting must not be a second
   * implementation of the rule it checks. All that is local now is the
   * binding: where this device keeps its tokens.
   */
  const relayFor = (m: {
    room: string
    relay?: string
    provenance: MountProvenance
  }): RelayConfig | null =>
    resolveRoomRelay({
      url: m.relay || opts.tokens.relayOf(m.room) || opts.relayUrl,
      provenance: m.provenance,
      exactToken: opts.tokens.token(m.room),
      rootToken: opts.tokens.token(opts.rootRoom),
      rootTokenKind: opts.tokens.kind(opts.rootRoom),
      rootRelayUrl: opts.relayUrl,
    })

  const makeSession = (
    room: string,
    mountPath: string,
    extra?: Partial<MountSessionConfig>
  ): Promise<MountSession> => {
    const dir = scopedStoreDir(opts.vaultDir, `${room}/`)
    const docStore = new BlobDocStore(engine, dir, clock)
    return MountSession.create({
      engine,
      adapter: mountPath === '' ? ignoringAdapter(opts.adapter, ignore) : scopedAdapter(opts.adapter, mountPath),
      user: { name: opts.id, color: '#000000' },
      room,
      clock,
      lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
      journal: new FileJournal(dir, { now: () => clock.now() }),
      docStore,
      mountsFile,
      mountPath,
      // Folder records are per mount; every other key is a globally unique
      // guid (the shim's rule, so a mount's connection state is inspectable).
      recordFor: (key) => recordFor(key === FOLDER_RECORD_KEY ? `//folder:${room}` : key),
      makeShareLink: (relay, room_) => encodeShareLink({ relay: relay.url, room: room_, token: relay.token }),
      ...extra,
      events: {
        onError: (err) => errors.push(err instanceof Error ? err.message : String(err)),
        ...(mountPath === ''
          ? {
              onMapChanged: () => refreshIgnore(),
              // The boot emission can land before `root` is assigned (the
              // hook is queued from inside `MountSession.create`). Dropping it
              // is safe because `bootDevice` runs the boot pass explicitly
              // once the root exists — the adopt machine's second entry point.
              onMountEntries: () => (root ? reconcile() : undefined),
            }
          : {}),
        ...extra?.events,
      },
    })
  }

  const buildMount = async (o: AdoptedMountOptions): Promise<MountSession> => {
    builds.push({
      room: o.room,
      path: o.path,
      firstJoin: o.firstJoin === true,
      token: o.relay?.token ?? null,
      relay: o.relay?.url ?? null,
    })
    return makeSession(o.room, o.path, {
      provenance: o.provenance,
      ...(o.relay ? { relay: o.relay } : {}),
      ...(o.firstJoin ? { firstJoin: true } : {}),
      ...(o.neverHeld ? { neverHeld: true } : {}),
      ...(o.onPullProgress ? { events: { onPullProgress: o.onPullProgress } } : {}),
    })
  }

  const ctx: AdoptContext = {
    vaultDir: opts.vaultDir,
    mountsFile,
    engine,
    root: () => root!,
    rootRoom: opts.rootRoom,
    mounts: () => mounts,
    relayFor,
    buildSession: buildMount,
    attachMount: (path, session) => {
      mounts.set(path, session)
    },
    detachMount: (path) => {
      const session = mounts.get(path) ?? null
      mounts.delete(path)
      return session
    },
    withRootDown: async (fn) => {
      await root!.shutdown()
      await fn()
      root = await makeSession(opts.rootRoom, '', rootRelayConfig())
    },
    refreshIgnore: reloadDescs,
    notify: (n) => notices.push(n),
  }

  /** One pass at a time: the live hook and an explicit pass share this chain. */
  let work: Promise<void> = Promise.resolve()
  const reconcile = (): Promise<void> => {
    work = work
      .then(() => reloadDescs())
      .then(() => reconcileMountEntries(ctx))
      .then(() => reloadDescs())
      .catch((err) => {
        errors.push(err instanceof Error ? err.message : String(err))
      })
    return work
  }

  const rootRelayConfig = (): Partial<MountSessionConfig> => {
    const token = opts.tokens.token(opts.rootRoom)
    return token ? { relay: { url: opts.relayUrl, token } } : {}
  }

  refreshIgnore()
  root = await makeSession(opts.rootRoom, '', {
    ...rootRelayConfig(),
    ...(opts.firstJoin ? { firstJoin: true } : {}),
  })

  for (const desc of descs) {
    if (desc.path === '' || isRecoverable(desc.status)) continue
    const relay = desc.relay
      ? relayFor({ room: desc.room, relay: desc.relay.url, provenance: desc.provenance })
      : null
    // A mount with no key is a fully functional LOCAL mount that knows where
    // its room lives; the status must not be lowered or forgotten (S10 Q2).
    if (desc.relay && !relay && desc.status !== 'needs-token') {
      await mountsFile.setStatus(desc.room, 'needs-token')
    }
    mounts.set(
      desc.path,
      await buildMount({
        room: desc.room,
        path: desc.path,
        provenance: desc.provenance,
        ...(relay ? { relay } : {}),
        // Derived together, exactly as the shim does (N3): PULL with a
        // credential, wait empty without one.
        ...bootFlagsFor(desc, relay),
      })
    )
  }
  await reloadDescs()
  // The BOOT pass (adopt.ts: "the boot one, after recoverMounts and after the
  // root has restored its folder blob"): what gives a device that was closed
  // during a peer's carve — or that just pulled a root map full of mount
  // entries — its trigger on open.
  await reconcile()

  return {
    id: opts.id,
    engine,
    get root(): MountSession {
      return root!
    },
    mounts,
    mountsFile,
    vaultDir: opts.vaultDir,
    adapter: opts.adapter,
    ignore,
    tokens: opts.tokens,
    rootRoom: opts.rootRoom,
    relayUrl: opts.relayUrl,
    records,
    notices,
    builds,
    pulls,
    errors,
    descs: () => descs,
    registry: () => [
      { mountPath: '', session: root! },
      ...[...mounts.entries()].map(([mountPath, session]) => ({ mountPath, session })),
    ],
    reconcile,
    refreshDescs: reloadDescs,
    relayFor,
    buildMount,
    attach: (path, session) => {
      mounts.set(path, session)
    },
    detach: (path) => {
      const session = mounts.get(path) ?? null
      mounts.delete(path)
      return session
    },
    shutdown: async () => {
      for (const m of mounts.values()) await m.shutdown()
      mounts.clear()
      await root?.shutdown()
    },
  }
}

/** Reboot a device from its durable stores — a restart, not a wipe. */
export async function reboot(dev: Device): Promise<Device> {
  await dev.shutdown()
  return bootDevice({
    id: dev.id,
    adapter: dev.adapter,
    vaultDir: dev.vaultDir,
    rootRoom: dev.rootRoom,
    relayUrl: dev.relayUrl,
    tokens: dev.tokens,
  })
}

// ------------------------------------------------- the machines, host-side

/** `doCarve` minus the minting: the state machine, then the live session. */
export async function carveOn(
  dev: Device,
  opts: { path: string; room: string; token: string; relayUrl?: string }
): Promise<MountSession> {
  const relayUrl = opts.relayUrl ?? dev.relayUrl
  dev.tokens.set(opts.room, opts.token, relayUrl, 'folder')
  await carveFolder({
    root: dev.root,
    vaultDir: dev.vaultDir,
    mountsFile: dev.mountsFile,
    mountPath: opts.path,
    room: opts.room,
    relayUrl,
    addIgnore: (p) => dev.ignore.add(p),
  })
  await dev.refreshDescs()
  const session = await dev.buildMount({
    room: opts.room,
    path: opts.path,
    provenance: 'carved',
    relay: { url: relayUrl, token: opts.token },
  })
  dev.attach(opts.path, session)
  await dev.refreshDescs()
  return session
}

/** `doJoinMount`: join a foreign share as a subtree, announced to the peers. */
export async function joinOn(dev: Device, opts: { dest: string; link: string }): Promise<MountSession> {
  const target = decodeShareLink(opts.link)
  const session = await joinMount({
    vaultDir: dev.vaultDir,
    mountsFile: dev.mountsFile,
    root: dev.root,
    baseAdapter: dev.adapter,
    existingMountPaths: [...dev.mounts.keys()],
    mountPath: opts.dest,
    room: target.room,
    relayUrl: target.relay,
    addIgnore: (p) => dev.ignore.add(p),
    removeIgnore: (p) => dev.ignore.delete(p),
    buildSession: () =>
      dev.buildMount({
        room: target.room,
        path: opts.dest,
        provenance: 'joined',
        relay: { url: target.relay, token: target.token },
        firstJoin: true,
      }),
  })
  dev.tokens.set(target.room, target.token, target.relay, 'folder')
  if (target.grants.length > 0) dev.tokens.mergeGrants(target.grants)
  dev.attach(opts.dest, session)
  await dev.refreshDescs()
  return session
}

/**
 * `doAddMountLink` (A4-C): paste the link for a mount this device holds but
 * has no key for.
 *
 * The rule itself is `activateMount` in libs/workspace — the SAME machine the
 * web shim calls, which is the point: this harness exists to catch the shim
 * drifting, and a copy of the rule here would have hidden exactly the defect
 * that moved it out (`activate.ts`'s header). What is mirrored is only the
 * shell's half: decode the link, store the token and its grants, hand over
 * the registry.
 */
export async function addMountLink(dev: Device, path: string, link: string): Promise<void> {
  const info = dev.descs().find((d) => d.path === path)
  if (!info) throw new Error(`no mount at '${path}'`)
  const target = decodeShareLink(link)
  // The shim's first refusal (R5), mirrored: a DEVICE token is a credential
  // for a whole vault that the relay also honours in rooms carved out of it,
  // and filing one against a single folder's room would hand vault-wide
  // access to `resolveRoomRelay`'s exact-match rule — and to the next device
  // link's `grants` bundle. Grants are not merged here for the same reason: a
  // folder link carries none, so merging could only ever act on the link this
  // refusal rejects.
  if (target.kind !== 'folder') throw new Error(`that is a device link, not a folder link`)
  if (target.room !== info.room) throw new Error(`that link is for another folder`)
  const session = dev.mounts.get(path)
  if (!session) throw new Error(`no live mount at '${path}'`)

  dev.tokens.set(target.room, target.token, target.relay, target.kind)

  try {
    await activateMount({
      vaultDir: dev.vaultDir,
      mountsFile: dev.mountsFile,
      desc: info,
      session,
      relay: { url: target.relay, token: target.token },
      buildSession: (o) => dev.buildMount(o),
      detachMount: (p) => {
        dev.detach(p)
      },
      attachMount: (p, next) => dev.attach(p, next),
      onPullProgress: (progress) => dev.pulls.push(progress),
    })
  } finally {
    await dev.refreshDescs()
  }
}

// ------------------------------------------------------------- assertions

/**
 * A6's invariant, executable (`mountInvariants`): every guid in exactly one
 * mount namespace, every path in exactly one map, nothing under a mount
 * boundary, mounts.json ⟷ registry ⟷ ignore set naming the same roots, and
 * every surviving desc settled.
 */
export function checkInvariants(dev: Device): void {
  const problems = mountInvariants({
    descs: dev.descs(),
    ignore: dev.ignore,
    mounts: dev.registry(),
  })
  expect(problems).toEqual([])
  for (const desc of dev.descs()) expect(isRecoverable(desc.status)).toBe(false)
}

/** A real relay is involved, so waits are bounded polls, never sleeps. */
export async function until(
  label: string,
  ok: () => boolean | Promise<boolean>,
  timeoutMs = 20_000
): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await ok()) return
    if (Date.now() - started > timeoutMs) throw new Error(`${label}: timed out after ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Durable relay ack for a whole mount: the folder doc and every text doc. */
export function mountSynced(dev: Device, mountPath: string): boolean {
  const session = mountPath === '' ? dev.root : dev.mounts.get(mountPath)
  if (!session) return false
  if (!dev.records.get(`//folder:${session.room}`)?.synced) return false
  for (const row of session.files()) {
    if (row.kind !== 'text') continue
    const rec = dev.records.get(row.guid)
    if (!rec?.synced || rec.pendingLocal) return false
  }
  return true
}

/** Mount-relative text rows of a device's mount at `path` ('' = the root). */
export function rowsOf(dev: Device, path: string): string[] {
  const session = path === '' ? dev.root : dev.mounts.get(path)
  if (!session) return []
  return session
    .files()
    .filter((r) => r.kind === 'text')
    .map((r) => r.path)
    .sort()
}

/** What a device's vault backend holds (path → text). */
export async function diskSnapshot(dev: Device): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await dev.adapter.list()) {
    out[stat.path] = dec.decode((await dev.adapter.read(stat.path))!)
  }
  return out
}

export async function seedAdapter(files: Record<string, string>): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(files)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  return adapter
}

export function memDir(): StoreDir {
  return new MemStoreDir()
}

// ------------------------------------------------------------ the auth probe

export interface AuthProbe {
  session: MountSession
  errors: string[]
  record: SyncRecordFields
  /** Wall-clock ms from `MountSession.create` to the first reported failure. */
  reportedAfterMs: number
  shutdown(): Promise<void>
}

/**
 * One mount, one token, one room, nothing else: an EMPTY vault attached to
 * `room` with `token`, so exactly one document (the folder doc) is offered to
 * `onAuthenticate` and exactly one auth outcome can be reported.
 *
 * Deliberately not a `firstJoin` boot: a rejected first join throws out of
 * `MountSession.create`, which leaves the session (and its socket) with no
 * owner to shut down. This shape keeps the session, so the test can assert
 * what the record says and that the failure does not repeat.
 */
export async function probeAuth(opts: {
  relayUrl: string
  room: string
  token: string
}): Promise<AuthProbe> {
  const engine = createYjsEngine()
  const clock = new RealClock()
  const storeRoot: StoreDir = new MemStoreDir()
  const dir = scopedStoreDir(storeRoot, `${opts.room}/`)
  const docStore = new BlobDocStore(engine, dir, clock)
  const errors: string[] = []
  const records = new Map<string, SyncRecordFields>()
  const started = Date.now()
  const session = await MountSession.create({
    engine,
    adapter: new MemVaultAdapter(),
    user: { name: 'probe', color: '#000000' },
    room: opts.room,
    relay: { url: opts.relayUrl, token: opts.token },
    clock,
    lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
    journal: new FileJournal(dir, { now: () => clock.now() }),
    docStore,
    mountsFile: new MountsFile(storeRoot.io('mounts.json')),
    mountPath: '',
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) {
        rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
        records.set(key, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => encodeShareLink({ relay: relay.url, room, token: relay.token }),
    events: { onError: (err) => errors.push(err instanceof Error ? err.message : String(err)) },
  })
  return {
    session,
    errors,
    get record(): SyncRecordFields {
      return records.get(FOLDER_RECORD_KEY)!
    },
    get reportedAfterMs(): number {
      return Date.now() - started
    },
    shutdown: () => session.shutdown(),
  }
}
