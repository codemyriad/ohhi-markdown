// @vitest-environment jsdom
/**
 * The relay card (first-run D1, R3, R5, R10): connected — the snapshot's
 * words, receipt never "durable"; probed — "reachable" is a health check;
 * none — one relay per group and the guide; pinned — no other relay offered.
 * The dot is a sync dot keyed on `data-status`.
 */
import { getLL } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { guideHref } from '../guide.js'
import RelayCard from './RelayCard.svelte'

afterEach(cleanup)

const LL = getLL()
const t = LL.web.relay_card
const r = LL.web.shared.relay
const NOW = 1_000_000
const MIN = 60_000
const RELAY = 'wss://ohhi.example.ts.net/relay'

/** Short waits (the probe's debounce) run on the next microtask; long ones (the tick) never. */
const clock: Clock = {
  now: () => NOW,
  schedule: (fn, ms) => {
    let live = true
    if (ms <= 500) queueMicrotask(() => live && fn())
    return () => {
      live = false
    }
  },
}

function draw(over: Partial<ComponentProps<typeof RelayCard>> = {}) {
  const props = { relayUrl: RELAY, known: true, clock, probe: vi.fn(async () => ({ ok: true as const })), ...over }
  render(RelayCard, props)
  return { props, card: screen.getByTestId('relay-card') }
}

const dot = (card: HTMLElement): string | null => card.querySelector('.ed-sync-dot')!.parentElement!.getAttribute('data-status')

describe('RelayCard — connected (the snapshot)', () => {
  const conn = { host: 'ohhi.example.ts.net', state: 'connected' as const, rooms: 2, people: 1, inSyncSince: NOW - 2 * MIN }

  it('says connected, rooms and since when it is in sync with the relay — never "durable"', () => {
    const { card, props } = draw({ connection: conn })
    expect(card).toHaveAttribute('data-state', 'connected')
    expect(card).toHaveTextContent('ohhi.example.ts.net')
    expect(card).toHaveTextContent(r.state.connected())
    expect(card).toHaveTextContent(r.rooms({ count: 2 }))
    expect(card).toHaveTextContent(r.in_sync({ when: '2 min ago' }))
    expect(card).not.toHaveTextContent(r.people({ count: 1 }))
    expect(card.textContent).not.toMatch(/durable/i)
    expect(dot(card)).toBe('green')
    expect(props.probe).not.toHaveBeenCalled()
  })

  it('people only where asked', () => {
    const { card } = draw({ connection: conn, showPeople: true })
    expect(card).toHaveTextContent(r.people({ count: 1 }))
  })

  it('reconnecting: the last time it was in sync, and that edits are safe', () => {
    const { card } = draw({ connection: { ...conn, state: 'reconnecting', inSyncSince: undefined, lastInSyncAt: NOW - 5 * MIN } })
    expect(card).toHaveTextContent(r.state.reconnecting())
    expect(card).toHaveTextContent(r.last_in_sync({ when: '5 min ago' }))
    expect(card).toHaveTextContent(r.safe())
    expect(dot(card)).toBe('offline')
  })

  it('offline, and refused with the relay’s reason', () => {
    const { card } = draw({ connection: { ...conn, state: 'offline', inSyncSince: undefined } })
    expect(card).toHaveTextContent(r.state.offline())
    cleanup()
    const refused = draw({ connection: { ...conn, state: 'refused', reason: 'no such share', inSyncSince: undefined } }).card
    expect(refused).toHaveTextContent(r.refused_reason({ reason: 'no such share' }))
    expect(dot(refused)).toBe('red')
  })
})

describe('RelayCard — probed (not connected yet)', () => {
  it('reachable means the health check answered', async () => {
    const { card, props } = draw()
    expect(card).toHaveTextContent(t.checking())
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'reachable'))
    expect(props.probe).toHaveBeenCalledWith(RELAY)
    expect(card).toHaveTextContent(t.reachable({ when: LL.web.relative_time.now() }))
    expect(dot(card)).toBe('green')
  })

  it('can’t reach it from here, and a relay that answers unhealthy', async () => {
    const { card } = draw({ probe: vi.fn(async () => ({ ok: false as const, reason: 'timeout' as const })) })
    await waitFor(() => expect(card).toHaveTextContent(t.unreachable()))
    expect(dot(card)).toBe('offline')
    cleanup()
    const sick = draw({ probe: vi.fn(async () => ({ ok: false as const, reason: 'unhealthy' as const })) }).card
    await waitFor(() => expect(sick).toHaveTextContent(t.unhealthy()))
  })

  it('Test probes again; Change… hands over', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { props } = draw({ showTest: true, onChange })
    await waitFor(() => expect(props.probe).toHaveBeenCalledOnce())
    await user.click(screen.getByRole('button', { name: t.test() }))
    await waitFor(() => expect(props.probe).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: t.change() }))
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('the share sheet’s wording: Use another…', () => {
    draw({ onChange: vi.fn(), changeLabel: 'use_another' })
    expect(screen.getByRole('button', { name: t.use_another() })).toBeVisible()
  })

  it('the team’s relay, with the build’s network sentence', () => {
    const { card } = draw({ teamHost: 'ohhi.example.ts.net', networkNote: 'Shares work only on the tailnet.' })
    expect(card).toHaveTextContent(t.team())
    expect(card).toHaveTextContent('Shares work only on the tailnet.')
    cleanup()
    const other = draw({ relayUrl: 'wss://other.example/relay', teamHost: 'ohhi.example.ts.net', networkNote: 'x' }).card
    expect(other).not.toHaveTextContent(t.team())
  })
})

describe('RelayCard — none and pinned', () => {
  it('none: one relay per group, and the guide', () => {
    const { card, props } = draw({ known: false })
    expect(card).toHaveAttribute('data-state', 'none')
    expect(card).toHaveTextContent(t.none_host())
    expect(card).toHaveTextContent(t.none_body())
    expect(screen.getByRole('link', { name: t.guide() })).toHaveAttribute('href', guideHref('relay'))
    expect(props.probe).not.toHaveBeenCalled()
  })

  it('pinned: says the build syncs through its host only, and offers no other relay', async () => {
    const { card } = draw({ pinnedHost: 'ohhi.example.ts.net', onChange: vi.fn(), showTest: true })
    expect(card).toHaveTextContent(t.pinned({ host: 'ohhi.example.ts.net' }))
    expect(screen.queryByRole('button', { name: t.change() })).toBeNull()
    expect(screen.queryByRole('button', { name: t.use_another() })).toBeNull()
    // Testing the one relay it has is still honest.
    expect(screen.getByRole('button', { name: t.test() })).toBeVisible()
  })
})
