import { SimClock } from '@ohhi/testkit'
import { describe, expect, it, vi } from 'vitest'
import { startUpdateChecks, UPDATE_INTERVAL_MS, type PendingUpdate, type UpdaterHost } from './updater.js'

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
