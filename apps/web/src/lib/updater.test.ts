import { SimClock } from '@ohhi/testkit'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toaster } from './ui/toaster.js'
import {
  changesOpener,
  offerRestart,
  startUpdateChecks,
  UPDATE_INTERVAL_MS,
  type PendingUpdate,
  type UpdaterHost,
  type UpdateStatus,
} from './updater.js'

/** Let the tick's awaited promises settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

function harness(check: UpdaterHost['check']) {
  const clock = new SimClock()
  const host = {
    clock,
    check: vi.fn(check),
    ready: vi.fn<UpdaterHost['ready']>(),
    relaunch: vi.fn(async () => {}),
    log: vi.fn<UpdaterHost['log']>(),
    status: vi.fn<(s: UpdateStatus) => void>(),
  }
  return { clock, host }
}

function pending(version: string): PendingUpdate & { order: string[] } {
  const order: string[] = []
  return {
    version,
    order,
    download: async () => void order.push('download'),
    install: async () => void order.push('install'),
  }
}

describe('startUpdateChecks', () => {
  it('checks on launch, then every interval while the build is current', async () => {
    const { clock, host } = harness(async () => null)
    startUpdateChecks(host)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(1)
    clock.advance(UPDATE_INTERVAL_MS - 1)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(1)
    clock.advance(1)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.ready).not.toHaveBeenCalled()
  })

  it('downloads, installs, then offers a restart — and stops checking', async () => {
    const update = pending('0.1.42')
    const { clock, host } = harness(async () => update)
    startUpdateChecks(host)
    await settle()
    expect(update.order).toEqual(['download', 'install'])
    expect(host.ready).toHaveBeenCalledWith('0.1.42', expect.any(Function))
    host.ready.mock.calls[0]![1]()
    expect(host.relaunch).toHaveBeenCalledTimes(1)
    clock.advance(UPDATE_INTERVAL_MS * 3)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(1)
  })

  it('a failing check (no feed, offline) is logged once per reason and retried, never offered', async () => {
    const { clock, host } = harness(async () => {
      throw new Error('EmptyEndpoints')
    })
    startUpdateChecks(host)
    await settle()
    clock.advance(UPDATE_INTERVAL_MS)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(2)
    expect(host.log).toHaveBeenCalledTimes(1)
    expect(host.log.mock.calls[0]![0]).toContain('EmptyEndpoints')
    expect(host.ready).not.toHaveBeenCalled()
  })

  it('a failed download is retried at the next interval', async () => {
    let calls = 0
    const { clock, host } = harness(async () => ({
      version: '0.1.43',
      download: async () => {
        if (calls++ === 0) throw new Error('network')
      },
      install: async () => {},
    }))
    startUpdateChecks(host)
    await settle()
    expect(host.ready).not.toHaveBeenCalled()
    clock.advance(UPDATE_INTERVAL_MS)
    await settle()
    expect(host.ready).toHaveBeenCalledWith('0.1.43', expect.any(Function))
  })

  it('stop cancels the next check', async () => {
    const { clock, host } = harness(async () => null)
    const stop = startUpdateChecks(host)
    await settle()
    stop()
    clock.advance(UPDATE_INTERVAL_MS * 2)
    await settle()
    expect(host.check).toHaveBeenCalledTimes(1)
  })
})

describe('the last check’s outcome (the Help menu’s version line)', () => {
  it('"current" only after a completed check that found nothing, on the injected clock', async () => {
    const { clock, host } = harness(async () => null)
    clock.advance(5_000)
    startUpdateChecks(host)
    await settle()
    expect(host.status).toHaveBeenLastCalledWith({ kind: 'current', checkedAt: 5_000 })
  })

  it('a failed check is "failed", keeping the last good check’s time', async () => {
    let fail = false
    const { clock, host } = harness(async () => {
      if (fail) throw new Error('offline')
      return null
    })
    startUpdateChecks(host)
    await settle()
    fail = true
    clock.advance(UPDATE_INTERVAL_MS)
    await settle()
    expect(host.status).toHaveBeenLastCalledWith({ kind: 'failed', failedAt: UPDATE_INTERVAL_MS, lastCheckedAt: 0 })
  })

  it('a first check that fails has no last good time', async () => {
    const { host } = harness(async () => {
      throw new Error('EmptyEndpoints')
    })
    startUpdateChecks(host)
    await settle()
    expect(host.status).toHaveBeenLastCalledWith({ kind: 'failed', failedAt: 0, lastCheckedAt: null })
  })

  it('a newer build is "found", then "ready" once installed — never "current"', async () => {
    const { host } = harness(async () => pending('0.2.0'))
    startUpdateChecks(host)
    await settle()
    const kinds = host.status.mock.calls.map((c) => c[0].kind)
    expect(kinds).toEqual(['found', 'ready'])
  })
})

describe('offerRestart', () => {
  beforeEach(() => {
    for (const t of get(toaster.states.toasts)) toaster.helpers.removeToast(t.id)
  })

  it('offers Restart and What changed, which opens the changes page', () => {
    const restart = vi.fn()
    const showChanges = vi.fn()
    offerRestart('0.2.0', restart, showChanges)
    const [t] = get(toaster.states.toasts)
    expect(t!.data.title).toBe('Update installed')
    expect(t!.data.action!.label).toBe('Restart')
    expect(t!.data.secondary!.label).toBe('What changed')
    t!.data.secondary!.run()
    expect(showChanges).toHaveBeenCalledTimes(1)
    expect(restart).not.toHaveBeenCalled()
    t!.data.action!.run()
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('a generic build (no TEAM_HOST) offers Restart alone: the bundled page describes the running build', () => {
    // The test build sets no VITE_TEAM_HOST, so this is the default path.
    offerRestart('0.2.0', vi.fn())
    const [t] = get(toaster.states.toasts)
    expect(t!.data.action!.label).toBe('Restart')
    expect(t!.data.secondary).toBeUndefined()
  })

  it('What changed is offered only when a team host serves the new release’s page', () => {
    expect(changesOpener(null)).toBeNull()
    expect(changesOpener(undefined)).toBeNull()
    expect(changesOpener('')).toBeNull()
    expect(changesOpener('ohhi.example.ts.net')).toBeTypeOf('function')
  })
})
