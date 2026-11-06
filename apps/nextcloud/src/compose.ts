/**
 * The ExApp's service: ONE listening port — the relay's — serving `/ws`
 * upgrades through Hocuspocus and every other request through the router
 * (`onRequest`); plus one custodian per enrolled vault, the token sweep, the
 * live permission re-check and the free-disk watermark (nextcloud-build
 * decisions 3–8, 13, 17). main.ts wires it; the relay binds
 * APP_HOST:APP_PORT and there is no second http.Server.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { createRelay, type Relay } from '@ohhi/relay'
import {
  OHHI_HOST_MARKER,
  parseHostMarker,
  VaultUnavailableError,
  WebDavVaultAdapter,
  type Clock,
  type VaultAdapter,
  type WalkStats,
} from '@ohhi/vault'
import { NodeStoreDir } from '@ohhi/vault/node'
import { appApiHeaders, ocsClient, originPolicy } from './appapi.js'
import { Custodian, errName, type CustodianMode } from './custodian.js'
import { OhhiDb } from './db.js'
import { every } from './every.js'
import type { VaultHandlerDeps } from './handlers-vaults.js'
import { HoldError } from './holds.js'
import { createPermissions, NcDav } from './permissions.js'
import {
  createAuthenticate,
  peersInRoom,
  startAccessRecheck,
  type HocuspocusLike,
  type Recheck,
} from './relay-auth.js'
import { revokeTokens, startShareSweep } from './grants.js'
import type { Env, VaultRow, VaultStatus } from './types.js'
import { VaultService, type CustodianHost } from './vaults.js'

export const DISK_WATERMARK_BYTES = 200 * 1024 * 1024
/** Per-room relay caps (decision 17). */
export const ROOM_CAPS = { docsPerRoom: 5_000, bytesPerRoom: 64 * 1024 * 1024 } as const
/** First retry of custodians that did not start; doubles per attempt up to the max. */
export const CUSTODIAN_RETRY_MS = 30_000
export const CUSTODIAN_RETRY_MAX_MS = 5 * 60_000
/** The row reason for a vault whose folder is gone from its owner's Files (retried, never given up on). */
export const FOLDER_GONE = 'folder-gone'

export interface ServiceOptions {
  env: Env
  clock: Clock
  fetch?: typeof fetch
  log?: (line: string) => void
  /**
   * The vault folder as its owner; defaults to a WebDavVaultAdapter over
   * NEXTCLOUD_URL. `walk` carries the custodian's walk hooks (the folder-gone
   * count and the debug cost line) — a WebDAV adapter passes them on as its
   * `onWalk` / `onWalkError`.
   */
  makeAdapter?: (row: VaultRow, isActive: () => boolean, walk: WalkHooks) => VaultAdapter
  /** Log each walk's cost (`OHHI_LOG_LEVEL=debug`). */
  debug?: boolean
  /** The custodians' WebSocket implementation (Node 22's global by default). */
  webSocketPolyfill?: unknown
  /** Bytes free on the persist volume; injectable for tests. */
  freeBytes?: () => Promise<number>
  diskWatermarkBytes?: number
  /** Relay listen port; defaults to APP_PORT. 0 = ephemeral (tests). */
  port?: number
  /** Relay bind address; defaults to APP_HOST. */
  host?: string
  /**
   * Whether Nextcloud answers this app as `uid` (a booting custodian's owner).
   * AppAPI refuses an ExApp's calls until it is enabled, and a refused
   * lookup must not read as "the folder is gone". Defaults to an OCS
   * `cloud/user` call as `uid` answering 200.
   */
  ncReady?: (uid: string) => Promise<boolean>
  heartbeatMs?: number
}

/** What a vault's watch walk reports to its custodian. */
export interface WalkHooks {
  onWalk: (stats: WalkStats) => void
  onWalkError: (err: unknown) => void
}

export interface Service {
  relay: Relay
  db: OhhiDb
  vaults: VaultService
  custodians: ReadonlyMap<string, Custodian>
  /** What `registerVaults(router, …)` needs. */
  vaultDeps: VaultHandlerDeps
  instance: string
  /**
   * Listen (the one port), mint the custodians' device token, start the loops
   * and — unless `{ custodians: false }` — every vault row's custodian.
   */
  start(
    handleHttp?: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    o?: { custodians?: boolean }
  ): Promise<void>
  /**
   * Start every vault row's custodian that is not already running (boot mode).
   * Idempotent and serialised; a row whose owner Nextcloud does not answer
   * for yet (the app not enabled) is left for the next call.
   */
  startCustodians(): Promise<void>
  /** Stop every custodian (the app was disabled); `startCustodians` brings them back. */
  stopCustodians(): Promise<void>
  stop(): Promise<void>
  /** One watermark pass now (tests; the loop runs it every minute). */
  checkDisk(): Promise<void>
}

export function createService(opts: ServiceOptions): Service {
  const { env, clock } = opts
  const log = opts.log ?? ((line: string) => console.log(`[ohhi] ${line}`))
  mkdirSync(env.persistentStorage, { recursive: true })
  const db = new OhhiDb(join(env.persistentStorage, 'ohhi.db'))
  const instance = db.instanceId()
  // The marker lease's holder: the installation AND this process (nextcloud-build R1
  // #12). Two containers on one volume — an update's overlap, a restored
  // snapshot — share the instance id; with it alone each would read the
  // other's heartbeat as its own, and neither would ever see `lease-lost`.
  const holder = `${instance}.${randomBytes(6).toString('hex')}`
  const dav = new NcDav({ env, clock, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
  const permissions = createPermissions({ dav, clock })

  let httpHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null
  const custodians = new Map<string, Custodian>()
  const paused = new Set<string>()
  let deviceToken = ''
  // `vaults` is built below; the relay's hooks only run after start().
  let vaults: VaultService

  const bindHost = opts.host ?? env.appHost
  // Each running custodian's adapter, so a browser joining the room can cut
  // the idle walk short (WebDavVaultAdapter.hint: the 2 s interval from now on).
  const adapters = new Map<string, VaultAdapter>()
  const relay = createRelay({
    dbPath: join(env.persistentStorage, 'relay.db'),
    host: bindHost,
    port: opts.port ?? env.appPort,
    authenticate: createAuthenticate({
      relayDb: { getShare: (t) => relay.db.getShare(t) },
      appSecret: env.appSecret,
      origins: originPolicy(env),
      clock,
      vaultIdForRoom: (room) => db.vaultByRoom(room)?.id ?? null,
      accessFor: (uid, vaultId) => vaults.accessById(uid, vaultId),
      onBrowserJoin: (vaultId) => (adapters.get(vaultId) as { hint?: () => void } | undefined)?.hint?.(),
    }),
    onRequest: async (req, res) => {
      if (!httpHandler) return false
      await httpHandler(req, res)
      return true
    },
    // Decision 17: one tenant cannot fill the shared relay.db for the others.
    caps: ROOM_CAPS,
    onCapExceeded: (room, cap) => log(`room ${room}: ${cap} cap reached`),
    // A reader cannot write an awareness state either — the custodian's
    // Files status is one (decision 8).
    dropReadOnlyAwareness: true,
  })
  const hocuspocus = relay.hocuspocus as unknown as HocuspocusLike
  const peersOf = (room: string): number => peersInRoom(hocuspocus, room)

  const makeAdapter =
    opts.makeAdapter ??
    ((row: VaultRow, isActive: () => boolean, walk: WalkHooks): VaultAdapter =>
      new WebDavVaultAdapter({
        baseUrl: dav.davUrl(row.ownerUid, row.ownerPath),
        headers: () => appApiHeaders(env, row.ownerUid),
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        clock,
        isActive,
        owner: row.ownerUid,
        onWalk: walk.onWalk,
        onWalkError: walk.onWalkError,
      }))

  /** The walk hooks for one vault: the custodian counts a missing folder; the rest is logged. */
  function walkHooks(row: VaultRow): WalkHooks {
    return {
      onWalk: (stats) => {
        custodians.get(row.id)?.noteWalk(null)
        if (opts.debug) log(`vault ${row.id}: walk ${stats.full ? 'full' : 'incremental'}, ${stats.requests} PROPFIND`)
      },
      onWalkError: (err) => {
        // The folder gone is counted (3 walks → `folder-gone`, one line), never a line per walk.
        const c = custodians.get(row.id)
        if (c?.noteWalk(err)) {
          if (c.state === 'needs-operator') armRetry() // re-probe the folder on the retry ladder
          return
        }
        if (err instanceof VaultUnavailableError) return
        log(`vault ${row.id}: watch walk failed (${errName(err)})`)
      },
    }
  }

  // The custodians dial the relay over loopback on the one port (a wildcard bind answers there too).
  const loopback = bindHost === '' || bindHost === '0.0.0.0' || bindHost === '::' ? '127.0.0.1' : bindHost
  const ocs = ocsClient(env, clock, opts.fetch ? { fetch: opts.fetch } : {})
  const ncReady =
    opts.ncReady ??
    (async (uid: string): Promise<boolean> => (await ocs.get('/ocs/v2.php/cloud/user', { uid })).status === 200)

  async function launch(input: VaultRow, mode: CustodianMode): Promise<boolean> {
    let row = input
    if (mode === 'boot') {
      const ready = await ncReady(row.ownerUid).catch(() => false)
      if (!ready) {
        log(`vault ${row.id}: Nextcloud does not answer for the owner yet (app not enabled?); waiting`)
        return false
      }
      // The owner may have moved or renamed the folder while we were down:
      // the file id is the identity, the path follows it.
      const hit = await dav.findById(row.ownerUid, row.fileId).catch((err: unknown) => {
        log(`vault ${row.id}: cannot reach Nextcloud (${errName(err)})`)
        return undefined
      })
      if (hit === undefined) return false
      if (hit === null || !hit.isDir) {
        // Said once: a `folder-gone` row is re-probed on every retry, quietly.
        if (row.reason !== FOLDER_GONE) log(`vault ${row.id}: needs-operator (folder-gone: not in its owner's Files)`)
        db.setStatus(row.id, 'needs-operator', FOLDER_GONE)
        return false
      }
      if (row.reason === FOLDER_GONE) {
        // Back (restored from the trash, moved back, shared again): resume.
        log(`vault ${row.id}: the folder is back; resuming`)
        db.setStatus(row.id, 'active')
        row = db.getVault(row.id) ?? row
      }
      if (hit.path !== row.ownerPath) {
        db.setOwnerPath(row.id, hit.path)
        row = db.getVault(row.id) ?? row
      }
    }
    const dir = join(env.persistentStorage, 'vaults', row.id)
    mkdirSync(dir, { recursive: true })
    const adapter = makeAdapter(row, () => peersOf(row.room) > 0, walkHooks(row))
    adapters.set(row.id, adapter)
    const c = new Custodian({
      row,
      mode,
      clock,
      instance: holder,
      storeDir: new NodeStoreDir(dir),
      adapter,
      relay: { url: `ws://${loopback.includes(':') ? `[${loopback}]` : loopback}:${relay.port}`, token: deviceToken },
      webSocketPolyfill: opts.webSocketPolyfill ?? globalThis.WebSocket,
      setStatus: (s, reason) => {
        // A removed vault's custodian settling as it stops writes nothing back.
        if (db.getVault(row.id)) db.setStatus(row.id, s, reason ?? null)
      },
      log,
      ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    })
    custodians.set(row.id, c)
    const ok = await c.start()
    if (!ok && mode === 'enrol') custodians.delete(row.id)
    if (ok) {
      void c.ready.then(() => {
        log(`vault ${row.id}: custodian ${c.state} (${mode})`)
        if (c.state !== 'running') armRetry()
      })
    }
    return ok
  }

  let custodianRun: Promise<void> = Promise.resolve()
  const serially = (task: () => Promise<void>): Promise<void> => {
    const next = custodianRun.then(task, task)
    custodianRun = next.catch(() => {})
    return next
  }

  // The retry (nextcloud-build R1 #2): `startCustodians` runs once at boot and on
  // `enabled=1`, and AppAPI does not re-send the latter after a restart. A
  // pass that leaves any row neither running nor `needs-operator` — Nextcloud
  // not answering yet, a transient boot error, a `lease-lost` row whose other
  // holder may have died — is tried again on the clock, 30 s doubling to 5 min.
  let wanted = false
  let retryCancel: (() => void) | null = null
  let retryAttempt = 0
  const retryDelay = (): number => Math.min(CUSTODIAN_RETRY_MS * 2 ** retryAttempt, CUSTODIAN_RETRY_MAX_MS)
  // A `folder-gone` row is the one `needs-operator` that is retried: the
  // folder may come back (restored, moved back), and the retry re-probes it.
  const stuck = (row: VaultRow): boolean => row.status === 'needs-operator' && row.reason !== FOLDER_GONE
  const waiting = (): boolean =>
    db.allVaults().some((row) => {
      if (stuck(row) || paused.has(row.id)) return false
      // `starting` settles later and re-arms from `launch` if it fails.
      const state = custodians.get(row.id)?.state
      return state !== 'running' && state !== 'starting'
    })
  function armRetry(): void {
    if (retryCancel) return // one retry armed at a time
    if (!wanted || stopped || !waiting()) {
      retryAttempt = 0
      return
    }
    const delay = retryDelay()
    retryAttempt++
    retryCancel = clock.schedule(() => {
      retryCancel = null
      void startCustodians().catch((err: unknown) => log(`custodians retry failed (${errName(err)})`))
    }, delay)
  }

  function startCustodians(): Promise<void> {
    wanted = true
    return serially(startPass).finally(armRetry)
  }

  /** One pass over the rows: launch every custodian that is not running (serialised by the caller). */
  async function startPass(): Promise<void> {
    if (stopped) return
    const low = await freeBytes()
      .then((free) => free < watermark)
      .catch(() => false)
    for (const row of db.allVaults()) {
      if (stopped) return
      const live = custodians.get(row.id)
      if (live && (live.state === 'running' || live.state === 'starting')) continue
      if (low && !stuck(row)) {
        // Below the watermark: nothing starts; the disk loop resumes them.
        paused.add(row.id)
        db.setStatus(row.id, 'paused')
        continue
      }
      if (stuck(row) || paused.has(row.id)) continue
      if (live) {
        await live.stop().catch(() => {})
        custodians.delete(row.id)
      }
      await launch(row, 'boot').catch((err) => log(`vault ${row.id}: start failed (${errName(err)})`))
    }
  }

  function stopCustodians(): Promise<void> {
    wanted = false
    retryCancel?.()
    retryCancel = null
    retryAttempt = 0
    return serially(async () => {
      for (const [id, c] of [...custodians]) {
        await c.stop().catch(() => {})
        custodians.delete(id)
      }
    })
  }

  const host: CustodianHost = {
    enrol: (row) => launch(row, 'enrol'),
    status(row): VaultStatus | null {
      const c = custodians.get(row.id)
      if (!c) return null
      return { ...c.status(peersOf(row.room)), vault: db.getVault(row.id) ?? row }
    },
    async applyHold(row, holdId, action) {
      const c = custodians.get(row.id)
      if (!c) throw new HoldError(409, 'the custodian is not running')
      await c.applyHold(holdId, action)
    },
    remove: removeVault,
  }

  /**
   * Unenrol (DELETE /api/vaults/:id): through the custodian queue, so no
   * start races it. The custodian stops first — its lease released — then
   * the marker goes from Files when it still names this vault (best effort:
   * a folder already gone has none to delete), then the row, the store and
   * the room on the relay (its sockets closed, its tokens with it).
   */
  async function removeVault(row: VaultRow): Promise<void> {
    await serially(async () => {
      paused.delete(row.id)
      const c = custodians.get(row.id)
      custodians.delete(row.id)
      adapters.delete(row.id)
      if (c) await c.stop().catch(() => {})
    })
    try {
      const hit = await dav.findById(row.ownerUid, row.fileId)
      const path = hit?.isDir ? hit.path : null
      if (path !== null) {
        const markerPath = path === '' ? OHHI_HOST_MARKER : `${path}/${OHHI_HOST_MARKER}`
        const bytes = await dav.readFile(row.ownerUid, markerPath)
        const marker = bytes ? parseHostMarker(bytes) : null
        if (marker && marker.vault === row.id) await dav.deleteFile(row.ownerUid, markerPath)
      }
    } catch (err) {
      log(`vault ${row.id}: the marker was not removed (${errName(err)})`)
    }
    db.deleteVault(row.id)
    const docs = relay.removeRoom(row.room)
    rmSync(join(env.persistentStorage, 'vaults', row.id), { recursive: true, force: true })
    log(`vault ${row.id}: removed (${docs} docs)`)
  }
  vaults = new VaultService({ db, dav, permissions, clock, custodians: host })

  const vaultDeps: VaultHandlerDeps = {
    env,
    vaults,
    grants: { vaults, db, relayDb: relay.db, clock },
    log,
  }

  const freeBytes =
    opts.freeBytes ??
    (async (): Promise<number> => {
      const s = await statfs(env.persistentStorage)
      return Number(s.bavail) * Number(s.bsize)
    })
  const watermark = opts.diskWatermarkBytes ?? DISK_WATERMARK_BYTES

  async function checkDisk(): Promise<void> {
    const free = await freeBytes()
    if (free < watermark) {
      for (const [id, c] of custodians) {
        if (c.state !== 'running' && c.state !== 'starting') continue
        paused.add(id)
        await c.stop('paused')
        log(`vault ${id}: paused (low disk on the persist volume)`)
      }
      return
    }
    // Hysteresis: resume a quarter above the line, so a volume hovering at it does not flap.
    if (paused.size === 0 || free < watermark * 1.25) return
    // Through the same queue as every other start (nextcloud-build R1 #11), and only
    // where nothing runs yet: an `enabled=1` racing this must not give one
    // store directory two custodians.
    await serially(async () => {
      if (stopped) return
      for (const id of [...paused]) {
        paused.delete(id)
        const row = db.getVault(id)
        if (!row) continue
        const live = custodians.get(id)
        if (live && (live.state === 'running' || live.state === 'starting')) continue
        db.setStatus(id, 'active')
        await launch(row, 'boot').catch((err) => log(`vault ${id}: resume failed (${errName(err)})`))
      }
    })
  }

  let stopSweep: (() => void) | null = null
  let recheck: Recheck | null = null
  let stopDisk: (() => void) | null = null
  let stopped = false

  return {
    relay,
    db,
    vaults,
    custodians,
    vaultDeps,
    instance,
    checkDisk,
    startCustodians,
    stopCustodians,
    async start(handleHttp, o) {
      httpHandler = handleHttp ?? null
      await relay.listen()
      // The custodians' one device token: never leaves the process, replaced on every start.
      for (const s of relay.db.listShares()) if (s.kind === 'device' && s.ncUid === null) relay.db.removeShare(s.token)
      deviceToken = randomBytes(32).toString('hex')
      // `folderGuid` is not a room here: the device token is checked against
      // `vaultIdForRoom`, never this column, which only names the instance.
      relay.db.addShare({ token: deviceToken, folderGuid: instance, kind: 'device', ncUid: null, vaultId: null, expiresAt: null })
      relay.db.removeExpiredShares(clock.now())
      stopSweep = startShareSweep(relay.db, clock)
      recheck = startAccessRecheck({
        hocuspocus,
        clock,
        accessFor: (uid, vaultId) => vaults.accessById(uid, vaultId, { fresh: true }),
        // Tokens only: the recent list (`vault_access`) is the user's, and a
        // re-check is no reason to forget it (nextcloud-build R1 #7).
        revokeTokens: (uid, vaultId) => void revokeTokens(relay.db, uid, vaultId),
        onError: (err) => log(`access re-check failed (${errName(err)})`),
      })
      stopDisk = every(clock, 60_000, checkDisk, (err) => log(`disk check failed (${errName(err)})`))
      if (o?.custodians !== false) await startCustodians()
    },
    async stop() {
      await serially(async () => {
        stopped = true
      })
      retryCancel?.()
      stopDisk?.()
      stopSweep?.()
      recheck?.stop()
      for (const c of custodians.values()) await c.stop().catch(() => {})
      await relay.destroy()
      db.close()
    },
  }
}
