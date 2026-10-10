// @vitest-environment jsdom
/**
 * The join page (first-run C2): what a browser shows at `/join#editor1:…`.
 * Honesty (R5) is the part pinned hardest: the sender is "the name they
 * typed", "reachable" is a health check, and a device link is never offered
 * as a folder share.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import type { ProbeResult } from '../relay-probe.js'
import type { Probe } from '../relay-check.js'
import { encodeDeviceLink, encodeShareUrl } from '../share-link.js'
import JoinPage from './JoinPage.svelte'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LL = getLL()
const t = LL.web.join_page

const TOKEN = 'a'.repeat(64)
const ORIGIN = 'https://ohhi.example.ts.net'
const TEAM_RELAY = 'wss://ohhi.example.ts.net/relay'
const url = (over: { relay?: string; label?: string; from?: string } = {}): string =>
  encodeShareUrl({ relay: over.relay ?? TEAM_RELAY, room: 'team-room', token: TOKEN, label: over.label, from: over.from }, ORIGIN)

/** A probe whose answer the test gives, when it chooses. */
function deferredProbe(): { probe: Probe; answer: (r: ProbeResult) => void; calls: string[]; signals: AbortSignal[] } {
  let answer: (r: ProbeResult) => void = () => {}
  const calls: string[] = []
  const signals: AbortSignal[] = []
  const probe: Probe = (relay, signal) => {
    calls.push(relay)
    signals.push(signal)
    return new Promise((resolve) => (answer = resolve))
  }
  return { probe, answer: (r) => answer(r), calls, signals }
}

function open(over: Partial<ComponentProps<typeof JoinPage>> = {}) {
  const props = {
    link: url({ label: 'team/notes', from: 'Sam' }),
    onAddHere: vi.fn(),
    onLinkHere: vi.fn(),
    teamHost: 'ohhi.example.ts.net' as string | null,
    networkNote: 'Shares work only while you are on the company tailnet.',
    probe: deferredProbe().probe,
    downloadHref: '/guide/start.html',
    ...over,
  }
  render(JoinPage, props)
  return props
}

describe('JoinPage', () => {
  it('names the sender as the name they typed, never a verified account', () => {
    open()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.heading_from({ from: 'Sam', label: 'team/notes' }))
    expect(screen.getByTestId('join-sender-note')).toHaveTextContent(t.from_note({ from: 'Sam' }))
    expect(screen.getByTestId('join-brand')).toHaveTextContent(t.brand())
    expect(screen.getByText(t.what_you_get_body())).toBeVisible()
  })

  it('without a sender or a label: "Someone shared a folder", and says the link does not say who', () => {
    open({ link: url() })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.heading_anon({ label: t.a_folder() }))
    expect(screen.getByTestId('join-sender-note')).toHaveTextContent(t.anon_note())
  })

  it('says whose relay it syncs through: the team’s (with the network sentence) or the sharer’s', () => {
    open()
    const team = screen.getByTestId('join-syncs-through')
    expect(team).toHaveTextContent(t.syncs_team({ host: 'ohhi.example.ts.net' }))
    expect(team).toHaveTextContent('Shares work only while you are on the company tailnet.')
    expect(team).toHaveTextContent(t.offline())
    cleanup()

    open({ link: url({ relay: 'wss://relay.elsewhere.org' }) })
    const other = screen.getByTestId('join-syncs-through')
    expect(other).toHaveTextContent(t.syncs_other({ host: 'relay.elsewhere.org' }))
    expect(other).not.toHaveTextContent('company tailnet')
  })

  it('probes the link’s relay on load: pending, then "reachable · checked just now"', async () => {
    const p = deferredProbe()
    open({ probe: p.probe })
    expect(p.calls).toEqual([TEAM_RELAY])
    expect(screen.getByRole('status')).toHaveTextContent(t.relay_checking())
    p.answer({ ok: true })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.relay_ok()))
  })

  it('unreachable on the team’s relay: the network sentence, then reload', async () => {
    const p = deferredProbe()
    open({ probe: p.probe })
    p.answer({ ok: false, reason: 'unreachable' })
    const line = screen.getByRole('status')
    await waitFor(() => expect(line).toHaveTextContent(t.relay_down()))
    expect(line).toHaveTextContent('Shares work only while you are on the company tailnet.')
    expect(line).toHaveTextContent(t.reload())
    expect(line).not.toHaveTextContent(t.relay_ok())
  })

  it('unreachable on someone else’s relay: ask whoever shared it', async () => {
    const p = deferredProbe()
    open({ probe: p.probe, link: url({ relay: 'wss://relay.elsewhere.org' }) })
    p.answer({ ok: false, reason: 'timeout' })
    const line = screen.getByRole('status')
    await waitFor(() => expect(line).toHaveTextContent(t.relay_down_other()))
    expect(line).not.toHaveTextContent('company tailnet')
  })

  it('cancels the probe when the page goes away', () => {
    const p = deferredProbe()
    open({ probe: p.probe })
    expect(p.signals[0]?.aborted).toBe(false)
    cleanup()
    expect(p.signals[0]?.aborted).toBe(true)
  })

  it('In the desktop app: copies the link and says where to paste it (Fork 3-B)', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const props = open()

    await user.click(screen.getByRole('button', { name: t.copy() }))
    expect(writeText).toHaveBeenCalledWith(props.link)
    expect(await screen.findByTestId('join-copied')).toHaveTextContent(t.copied())
  })

  it('a refused copy shows the link to copy by hand', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async (_: string) => {
      throw new Error('denied')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const props = open()

    await user.click(screen.getByRole('button', { name: t.copy() }))
    expect(await screen.findByTestId('join-copy-failed')).toHaveTextContent(t.copy_failed())
    expect(screen.getByLabelText(t.link_label())).toHaveValue(props.link)
  })

  it('In this browser: "Add here" hands the link to the manager’s Add dialog', async () => {
    const user = userEvent.setup()
    const props = open()
    await user.click(screen.getByRole('button', { name: t.add_here() }))
    expect(props.onAddHere).toHaveBeenCalledWith(props.link)
    expect(props.onLinkHere).not.toHaveBeenCalled()
  })

  it('a device link is explained as one and routed to Link this device, never offered as a folder', async () => {
    const user = userEvent.setup()
    const link = `${ORIGIN}/join#${encodeDeviceLink({ relay: TEAM_RELAY, room: 'vault-room', token: TOKEN, label: 'Notes', from: 'Sam' })}`
    const props = open({ link })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.device_heading())
    expect(screen.getByTestId('join-device-body')).toHaveTextContent(t.device_body({ label: 'Notes' }))
    expect(screen.queryByRole('button', { name: t.add_here() })).toBeNull()
    expect(screen.queryByText(t.what_you_get_body())).toBeNull()

    await user.click(screen.getByRole('button', { name: t.link_here() }))
    expect(props.onLinkHere).toHaveBeenCalledWith(link)
    expect(props.onAddHere).not.toHaveBeenCalled()
  })

  it('a damaged link shows the codec’s reason and the paste-it-in-the-app fallback', () => {
    const p = deferredProbe()
    open({ link: `${ORIGIN}/join#editor1:not-base64-json`, probe: p.probe })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.error_heading())
    expect(screen.getByRole('alert')).toHaveTextContent(LL.web.share.link_error.malformed())
    expect(screen.getByText(t.error_fallback())).toBeVisible()
    expect(screen.queryByRole('button', { name: t.add_here() })).toBeNull()
    expect(p.calls).toEqual([])
  })

  it('an address with no link at all is the same error state', () => {
    open({ link: `${ORIGIN}/join` })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(t.error_heading())
  })

  it('a link missing its relay, room or key says so', () => {
    const body = btoa(JSON.stringify({ v: 1, room: 'r' })).replace(/=+$/, '')
    open({ link: `${ORIGIN}/join#editor1:${body}` })
    expect(screen.getByRole('alert')).toHaveTextContent(LL.web.share.link_error.missing_fields())
  })

  it('the foot links to the download and the guide', () => {
    open()
    expect(screen.getByRole('link', { name: t.download() })).toHaveAttribute('href', '/guide/start.html')
    expect(screen.getByRole('link', { name: t.guide() })).toHaveAttribute('href', '/guide/start.html')
  })
})
