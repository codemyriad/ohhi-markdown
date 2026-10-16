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
import JoinPage, { DOWNLOAD_HREF } from './JoinPage.svelte'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
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

  it('probes the link’s relay on load: pending, then "the relay answered"', async () => {
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

  it('unreachable with no network sentence: still two sentences that read, down then reload', async () => {
    const p = deferredProbe()
    open({ probe: p.probe, networkNote: '' })
    p.answer({ ok: false, reason: 'unreachable' })
    const line = screen.getByRole('status')
    await waitFor(() => expect(line).toHaveTextContent(`${t.relay_down()} ${t.reload()}`))
  })

  it('a relay that answered unhealthy is not "can’t reach": no tailnet advice, tell whoever runs it', async () => {
    const p = deferredProbe()
    open({ probe: p.probe })
    p.answer({ ok: false, reason: 'unhealthy' })
    const line = screen.getByRole('status')
    await waitFor(() => expect(line).toHaveTextContent(t.relay_unhealthy()))
    expect(line).toHaveAttribute('data-check', 'unhealthy')
    expect(line).not.toHaveTextContent(t.relay_down())
    expect(line).not.toHaveTextContent('company tailnet')
    expect(line).not.toHaveTextContent(t.reload())
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

  it('In this browser, with no vault here: "Add here" hands the link to the manager’s Add dialog, and says it makes a shared vault', async () => {
    const user = userEvent.setup()
    const props = open()
    expect(screen.getByTestId('join-own-only')).toHaveTextContent(t.own_vault_hint())
    expect(screen.queryByTestId('join-where-vault')).toBeNull()
    await user.click(screen.getByRole('button', { name: t.add_here() }))
    expect(props.onAddHere).toHaveBeenCalledWith(props.link)
    expect(props.onLinkHere).not.toHaveBeenCalled()
  })

  // ---- the browser has a vault (C2 amended 2026-10-16, plans/join-share-brief.md) ----
  const VAULTS = [
    { name: 'Work', vault: { kind: 'opfs' as const, id: 'v1' }, room: 'room-work', lastOpenedAt: 2 },
    { name: 'Play', vault: { kind: 'opfs' as const, id: 'v2' }, room: 'room-play', lastOpenedAt: 1 },
  ]

  it('one vault in the browser: "Inside <vault>" is preselected, the folder defaults to the link’s label, Add runs the join into it', async () => {
    const user = userEvent.setup()
    const props = open({ vaults: [VAULTS[0]!], lastRoom: null, onAddInto: vi.fn(), initialName: 'Robin' })
    const inside = screen.getByTestId('join-where-vault')
    expect(inside).toBeChecked()
    expect(screen.getByTestId('join-where-own')).not.toBeChecked()
    expect(screen.getByText(t.inside_vault({ vault: 'Work' }))).toBeVisible()
    expect(screen.queryByTestId('join-vault-picker')).toBeNull() // one vault: nothing to pick
    expect(screen.getByTestId('join-dest')).toHaveValue('notes') // `team/notes` → `notes`
    expect(screen.getByTestId('join-name')).toHaveValue('Robin')

    await user.clear(screen.getByTestId('join-dest'))
    await user.type(screen.getByTestId('join-dest'), 'HackMD notes')
    await user.click(screen.getByRole('button', { name: t.add_into({ vault: 'Work' }) }))
    await waitFor(() => expect(props.onAddInto).toHaveBeenCalledWith(props.link, VAULTS[0], 'HackMD notes', 'Robin'))
    expect(props.onAddHere).not.toHaveBeenCalled()
    expect(localStorage.getItem('editor:user')).toBe('Robin')
  })

  it('several vaults: a picker, the last opened preselected; own-vault is one click away and says it is a shared vault', async () => {
    const user = userEvent.setup()
    const props = open({ vaults: VAULTS, lastRoom: 'room-play', onAddInto: vi.fn() })
    const picker = screen.getByTestId('join-vault-picker')
    expect(picker).toHaveValue('room-play')
    expect(screen.getByRole('button', { name: t.add_into({ vault: 'Play' }) })).toBeVisible()
    await user.selectOptions(picker, 'room-work')
    expect(screen.getByRole('button', { name: t.add_into({ vault: 'Work' }) })).toBeVisible()

    await user.click(screen.getByTestId('join-where-own'))
    expect(screen.getByText(t.own_vault())).toBeVisible()
    expect(screen.getByText(t.own_vault_hint())).toBeVisible()
    // What the vault will be called (the link's label, `team/notes` → `notes`) and where it lives.
    expect(screen.getByTestId('join-own-name')).toHaveValue('notes')
    expect(screen.getByTestId('join-own-name')).toHaveAttribute('readonly')
    expect(screen.getByTestId('join-own-platform')).toHaveTextContent(t.vault_name_hint())
    expect(screen.queryByTestId('join-dest')).toBeNull()
    // The name is asked here too, and travels with the link to the manager's dialog.
    await user.clear(screen.getByTestId('join-name'))
    await user.type(screen.getByTestId('join-name'), 'Robin')
    await user.click(screen.getByRole('button', { name: t.add_here() }))
    expect(props.onAddHere).toHaveBeenCalledWith(props.link)
    expect(props.onAddInto).not.toHaveBeenCalled()
    expect(localStorage.getItem('editor:user')).toBe('Robin')
  })

  it('inside a vault: an empty or illegal folder is refused at the field, with a plain sentence', async () => {
    const user = userEvent.setup()
    const props = open({ vaults: [VAULTS[0]!], onAddInto: vi.fn() })
    await user.clear(screen.getByTestId('join-dest'))
    await user.click(screen.getByRole('button', { name: t.add_into({ vault: 'Work' }) }))
    expect(await screen.findByText(LL.web.share.add.dest_required())).toBeVisible()
    await user.type(screen.getByTestId('join-dest'), 'bad:name')
    await user.click(screen.getByRole('button', { name: t.add_into({ vault: 'Work' }) }))
    expect(await screen.findByText(LL.web.tree_op.invalid_name({ name: 'bad:name' }))).toBeVisible()
    expect(props.onAddInto).not.toHaveBeenCalled()
  })

  it('vaults but no way to run the join (no onAddInto): only own-vault is offered', () => {
    open({ vaults: VAULTS })
    expect(screen.queryByTestId('join-where-vault')).toBeNull()
    expect(screen.getByTestId('join-own-only')).toBeVisible()
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

  it('the foot links to the download — the guide’s install section on this origin, never a private repo — and the guide', () => {
    open()
    expect(DOWNLOAD_HREF).toBe('/guide/start.html#install')
    expect(screen.getByRole('link', { name: t.download() })).toHaveAttribute('href', '/guide/start.html#install')
    expect(screen.getByRole('link', { name: t.guide() })).toHaveAttribute('href', '/guide/start.html')
  })
})
