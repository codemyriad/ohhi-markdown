/**
 * Desktop self-update: check the release feed on launch and every 6 h,
 * download and install a newer build in the background, then offer one
 * "Restart" (docs/desktop-builds.md, Updates). The installed build is the one
 * the next launch runs, so ignoring the offer still updates.
 *
 * The rules live here over an explicit host so a test drives them with a
 * fake clock; `startDesktopUpdates` wires the Tauri plugins. A failed check
 * (offline, a local build with no feed configured, a bad signature) is
 * logged once per distinct reason and never shown: an update that cannot be
 * fetched is not something the writer can act on.
 */
import { getLL } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { toast } from './ui/toaster.js'

export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000

/** A newer build the feed offered (the plugin's `Update`, narrowed). */
export interface PendingUpdate {
  version: string
  download(): Promise<void>
  install(): Promise<void>
}

export interface UpdaterHost {
  clock: Clock
  /** Null when the running build is current. */
  check(): Promise<PendingUpdate | null>
  /** The installed update is ready; `restart` relaunches into it. */
  ready(version: string, restart: () => void): void
  relaunch(): Promise<void>
  log(message: string): void
}

/** Starts the check loop; the returned function stops it. */
export function startUpdateChecks(host: UpdaterHost, intervalMs = UPDATE_INTERVAL_MS): () => void {
  let stopped = false
  let cancel: (() => void) | null = null
  let installed = false
  const logged = new Set<string>()

  const tick = async (): Promise<void> => {
    cancel = null
    try {
      const update = await host.check()
      if (update && !stopped) {
        await update.download()
        await update.install()
        installed = true
        host.ready(update.version, () => void host.relaunch())
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      if (!logged.has(reason)) {
        logged.add(reason)
        host.log(`update check skipped: ${reason}`)
      }
    }
    // Once a build is installed there is nothing newer to fetch until the
    // app restarts into it.
    if (!stopped && !installed) cancel = host.clock.schedule(() => void tick(), intervalMs)
  }

  void tick()
  return () => {
    stopped = true
    cancel?.()
  }
}

/** The offer: a toast that stays until dismissed, with one Restart button. */
export function offerRestart(version: string, restart: () => void): void {
  const t = getLL().web.ui
  toast(
    {
      level: 'info',
      title: t.update_ready(),
      description: t.update_ready_body({ version }),
      action: { label: t.restart(), run: restart },
    },
    0
  )
}

/**
 * The desktop wiring. Call it only under Tauri: the plugins load through
 * dynamic imports, so the browser bundle never pulls them in.
 */
export async function startDesktopUpdates(clock: Clock): Promise<() => void> {
  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ])
  return startUpdateChecks({
    clock,
    check: async () => {
      const update = await check()
      if (!update) return null
      return {
        version: update.version,
        download: () => update.download(),
        install: () => update.install(),
      }
    },
    ready: offerRestart,
    relaunch,
    log: (message) => console.info(`[ohhi] ${message}`),
  })
}
