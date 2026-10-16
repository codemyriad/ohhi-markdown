// @vitest-environment jsdom
/**
 * The share sheet (sharing E4, first-run D1/D2/C4): links as named rows with
 * *Copy link* and *Copy message*, the new-link row, the honesty paragraph,
 * *Stop sharing* at the foot — and the first run: the relay as a card,
 * the secret verified before *Share* can be pressed, the first link named,
 * "Your name, shown to them" saved, and the link handed over in the URL form
 * carrying the folder and the name.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { decodeShareLink, encodeShareLink } from '../share-link.js'
import { shareMessage } from '../share-message.js'
import type { MountInfo } from '../workspace.svelte.js'
import ShareSheet from './ShareSheet.svelte'

const admin = vi.hoisted(() => ({
  listShares: vi.fn(),
  mintShare: vi.fn(),
  revokeShare: vi.fn(),
}))
vi.mock('../relay-admin.js', () => admin)

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.share.sheet
const card = LL.web.relay_card

const RELAY = 'wss://ohhi.example.ts.net/relay'
const ORIGIN = 'https://ohhi.example.ts.net'
const ROOM = 'room-notes'
const FOLDER_LINK = encodeShareLink({ relay: RELAY, room: ROOM, token: 'a'.repeat(64) })

/**
 * The injected clock: short waits (debounces) run on the next microtask, long
 * ones (the "Copied" reset, the relative-time tick) never — so a test is
 * never at the mercy of real time.
 */
const clock: Clock = {
  now: () => 1_000_000,
  schedule: (fn, ms) => {
    let live = true
    if (ms <= 500) queueMicrotask(() => live && fn())
    return () => {
      live = false
    }
  },
}

const carved: MountInfo = {
  path: 'notes',
  room: ROOM,
  provenance: 'carved',
  link: FOLDER_LINK,
  status: 'active',
  foreign: false,
  relay: RELAY,
}

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  admin.listShares.mockResolvedValue([
    { token: 'tok-sam', folderGuid: ROOM, readOnly: true, label: 'Sam', createdAt: '2026-09-20T10:00:00Z' },
    { token: 'tok-team', folderGuid: ROOM, readOnly: false, label: 'Team', createdAt: '2026-09-12T10:00:00Z' },
  ])
  admin.mintShare.mockResolvedValue({ token: 'tok-new', folderGuid: ROOM, readOnly: false, label: 'Cynthia' })
  admin.revokeShare.mockResolvedValue(undefined)
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

/** user-event installs its own clipboard on setup: put ours back after it. */
function setupUser() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function open(over: Partial<ComponentProps<typeof ShareSheet>> = {}) {
  const props = {
    path: 'notes',
    mount: null as MountInfo | null,
    relayUrl: RELAY,
    relayKnown: true,
    secret: 'op-secret',
    userName: 'Chris',
    onSaveName: vi.fn(),
    onShare: vi.fn(async () => FOLDER_LINK),
    onRemember: vi.fn(),
    onStopSharing: vi.fn(),
    onClose: vi.fn(),
    clock,
    probe: vi.fn(async () => ({ ok: true as const })),
    verify: vi.fn(async () => 'ok' as const),
    pinnedHost: '',
    teamRelay: RELAY,
    networkNote: 'Shares work only while you are on the company tailnet.',
    secretHint: '',
    desktop: false,
    locationOrigin: ORIGIN,
    ...over,
  }
  render(ShareSheet, props)
  return props
}

const shareButton = (): HTMLElement => screen.getByRole('button', { name: t.share() })

describe('ShareSheet — not shared yet (a secret saved)', () => {
  it('is a named dialog that says what sharing does; no relay block, the first link and the name asked', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: t.title({ path: 'notes' }) })
    expect(dialog).toHaveAccessibleDescription(t.intro_new())
    expect(screen.getByTestId('share-honesty')).toHaveTextContent(t.honesty())
    expect(screen.queryByTestId('share-where')).toBeNull()
    expect(screen.getByLabelText(t.first_link())).toHaveValue('')
    // Fork 5-A: prefilled from the saved name.
    expect(screen.getByLabelText(t.your_name())).toHaveValue('Chris')
    expect(screen.queryByRole('button', { name: t.stop() })).toBeNull()
  })

  it('shares with no name typed: a named first link is minted beside the carve — the owner’s credential is never copied', async () => {
    const user = setupUser()
    const props = open()

    await user.click(shareButton())

    await waitFor(() => expect(props.onShare).toHaveBeenCalledOnce())
    expect(props.onRemember).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(admin.mintShare).toHaveBeenCalledWith(RELAY, 'op-secret', {
        folderGuid: ROOM,
        label: t.first_link_default(),
        readOnly: false,
      })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const link = writeText.mock.calls[0]![0] as string
    expect(link.startsWith(`${ORIGIN}/join#editor1:`)).toBe(true)
    const decoded = decodeShareLink(link)
    expect(decoded).toMatchObject({ relay: RELAY, room: ROOM, token: 'tok-new', label: 'notes', from: 'Chris' })
    // The carve's token is the owner's own credential: never handed over.
    expect(decoded.token).not.toBe(decodeShareLink(FOLDER_LINK).token)
    expect(screen.getByTestId('share-done-link')).not.toHaveValue(expect.stringContaining(FOLDER_LINK))
    expect(await screen.findByTestId('share-done')).toHaveTextContent(t.shared_copied())
    // The done block names the link by its default name.
    expect(screen.getByText(t.just_made({ name: t.first_link_default() }))).toBeVisible()
    expect(props.onSaveName).not.toHaveBeenCalled()
  })

  it('names the first link: minted for that person (read-only when ticked), beside the owner’s credential', async () => {
    const user = setupUser()
    const props = open()

    await user.type(screen.getByLabelText(t.first_link()), 'Sam')
    await user.click(screen.getByLabelText(t.read_only_label()))
    await user.clear(screen.getByLabelText(t.your_name()))
    await user.type(screen.getByLabelText(t.your_name()), 'Chris D')
    await user.click(shareButton())

    await waitFor(() =>
      expect(admin.mintShare).toHaveBeenCalledWith(RELAY, 'op-secret', { folderGuid: ROOM, label: 'Sam', readOnly: true })
    )
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const link = writeText.mock.calls[0]![0] as string
    expect(decodeShareLink(link)).toMatchObject({ token: 'tok-new', label: 'notes', from: 'Chris D' })
    expect(decodeShareLink(link).token).not.toBe(decodeShareLink(FOLDER_LINK).token)
    // The name typed is the saved name now.
    expect(props.onSaveName).toHaveBeenCalledWith('Chris D')
    expect(await screen.findByText(t.just_made({ name: 'Sam' }))).toBeVisible()
  })

  it('after Share: Copy message wraps the link in the sentence, with the network note and the guide', async () => {
    const user = setupUser()
    const props = open()
    await user.click(shareButton())
    const done = await screen.findByTestId('share-done-block')
    const link = (within(done).getByTestId('share-done-link') as HTMLInputElement).value

    await user.click(within(done).getByRole('button', { name: t.copy_message() }))

    const expected = shareMessage({ folder: 'notes', link, networkNote: props.networkNote, origin: ORIGIN })
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expected))
    expect(expected).toContain(props.networkNote)
    expect(expected).toContain(`${ORIGIN}/guide/start.html`)
  })

  it('shows why when the carve fails, and stays open', async () => {
    const user = setupUser()
    const reason = LL.web.relay.bad_secret()
    const props = open({ onShare: vi.fn(async () => Promise.reject(new Error(reason))) })

    await user.click(shareButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

describe('ShareSheet — first run (no operator secret)', () => {
  const secretField = (): HTMLElement => screen.getByLabelText(card.secret.title(), { exact: false })

  it('meets the relay as a card — probed, the team’s, with Use another… — and the secret with its “where”', async () => {
    const props = open({ secret: '' })
    const where = await screen.findByTestId('share-where')
    expect(within(where).getByRole('heading', { name: t.syncs_through() })).toBeVisible()
    const relay = within(where).getByTestId('relay-card')
    await waitFor(() => expect(relay).toHaveAttribute('data-state', 'reachable'))
    expect(props.probe).toHaveBeenCalledWith(RELAY)
    expect(relay).toHaveTextContent('ohhi.example.ts.net')
    expect(relay).toHaveTextContent(card.team())
    expect(relay).toHaveTextContent(props.networkNote)
    expect(within(relay).getByRole('button', { name: card.use_another() })).toBeVisible()
    expect(secretField()).toHaveAccessibleDescription(expect.stringContaining(card.secret.description()))
    expect(within(where).getByText(card.secret.where())).toBeVisible()
    expect(within(where).getByTestId('share-secret-where-body')).toHaveTextContent(card.secret.where_generic())
  })

  it('keeps Share disabled, with the reason, until the secret says it works', async () => {
    const user = setupUser()
    const verify = vi.fn(async (_relay: string, secret: string) => (secret === 'right' ? ('ok' as const) : ('bad_secret' as const)))
    const props = open({ secret: '', verify })

    expect(shareButton()).toBeDisabled()
    expect(shareButton()).toHaveAccessibleDescription(t.share_waits())

    await user.type(secretField(), 'wrong')
    await waitFor(() => expect(screen.getByTestId('share-secret-check')).toHaveTextContent(card.secret.bad_secret()))
    expect(shareButton()).toBeDisabled()

    await user.clear(secretField())
    await user.type(secretField(), 'right')
    await waitFor(() => expect(screen.getByTestId('share-secret-check')).toHaveTextContent(card.secret.ok()))
    expect(verify).toHaveBeenLastCalledWith(RELAY, 'right')
    await waitFor(() => expect(shareButton()).toBeEnabled())
    expect(props.onShare).not.toHaveBeenCalled()
  })

  it('remembers the relay and the verified secret in Settings › Sync, then shares', async () => {
    const user = setupUser()
    const calls: string[] = []
    const props = open({
      secret: '',
      onRemember: vi.fn(() => void calls.push('remember')),
      onShare: vi.fn(async () => {
        calls.push('share')
        return FOLDER_LINK
      }),
    })

    await user.type(secretField(), 'op-secret')
    await waitFor(() => expect(shareButton()).toBeEnabled())
    await user.click(shareButton())

    await waitFor(() => expect(props.onShare).toHaveBeenCalledOnce())
    expect(props.onRemember).toHaveBeenCalledWith(RELAY, 'op-secret')
    // Remembered FIRST: the carve reads the secret from Settings.
    expect(calls).toEqual(['remember', 'share'])
    await waitFor(() => expect(screen.queryByTestId('share-where')).toBeNull())
  })

  it('Use another… opens the address field; the card and the check follow what is typed', async () => {
    const user = setupUser()
    const props = open({ secret: '' })

    await user.click(await screen.findByRole('button', { name: card.use_another() }))
    const field = screen.getByLabelText(t.relay(), { exact: false })
    await user.clear(field)
    await user.type(field, 'wss://other.example/relay')
    await waitFor(() => expect(props.probe).toHaveBeenLastCalledWith('wss://other.example/relay'))
    await user.type(secretField(), 'op-secret')
    await waitFor(() => expect(shareButton()).toBeEnabled())
    await user.click(shareButton())
    await waitFor(() => expect(props.onRemember).toHaveBeenCalledWith('wss://other.example/relay', 'op-secret'))
  })

  it('a build with no relay: the card says none and the address field is open', async () => {
    open({ secret: '', relayKnown: false, relayUrl: 'ws://localhost:8787' })
    const relay = await screen.findByTestId('relay-card')
    expect(relay).toHaveAttribute('data-state', 'none')
    expect(relay).toHaveTextContent(card.none_host())
    expect(screen.getByLabelText(t.relay(), { exact: false })).toHaveValue('')
  })

  it('a pinned build offers no other relay and says it syncs through its host only', async () => {
    open({ secret: '', pinnedHost: 'ohhi.example.ts.net' })
    const relay = await screen.findByTestId('relay-card')
    expect(relay).toHaveTextContent(card.pinned({ host: 'ohhi.example.ts.net' }))
    expect(screen.queryByRole('button', { name: card.use_another() })).toBeNull()
    expect(screen.queryByLabelText(t.relay(), { exact: false })).toBeNull()
  })

  it('the “where” comes from the build when it says', async () => {
    open({ secret: '', secretHint: 'the team password manager, under ohhi relay' })
    expect(await screen.findByTestId('share-secret-where-body')).toHaveTextContent(
      card.secret.where_team({ hint: 'the team password manager, under ohhi relay' })
    )
  })
})

describe('ShareSheet — shared', () => {
  it('lists the links as named rows: label, read-only, created, Copy link, Copy message, Remove', async () => {
    open({ mount: carved })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(t.intro_shared({ path: 'notes', host: 'ohhi.example.ts.net' }))
    expect(await screen.findByRole('heading', { name: t.links({ count: 2 }) })).toBeVisible()
    expect(admin.listShares).toHaveBeenCalledWith(RELAY, 'op-secret', ROOM)

    const sam = screen.getByTestId('token-row:Sam')
    expect(sam).toHaveTextContent('Sam')
    expect(sam).toHaveTextContent(t.read_only())
    expect(sam).toHaveTextContent(t.created({ date: '' }).trim())
    expect(screen.getByTestId('token-row:Team')).not.toHaveTextContent(t.read_only())
    expect(within(sam).getByRole('button', { name: t.copy_link_for({ name: 'Sam' }) })).toBeVisible()
    expect(within(sam).getByRole('button', { name: t.copy_message_for({ name: 'Sam' }) })).toBeVisible()
    expect(within(sam).getByRole('button', { name: t.remove_for({ name: 'Sam' }) })).toBeVisible()
    expect(screen.queryByTestId('share-where')).toBeNull()
    expect(screen.queryByTestId('share-first-link')).toBeNull()
  })

  it("copies a row's own link, in the URL form with the folder and the name", async () => {
    const user = setupUser()
    open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.copy_link_for({ name: 'Team' }) }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const link = writeText.mock.calls[0]![0] as string
    expect(link.startsWith(`${ORIGIN}/join#`)).toBe(true)
    expect(decodeShareLink(link)).toMatchObject({ room: ROOM, token: 'tok-team', label: 'notes', from: 'Chris' })
  })

  it("copies a row's message", async () => {
    const user = setupUser()
    open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.copy_message_for({ name: 'Team' }) }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0]![0]).toMatch(/^I shared notes with you in Oh Hi markdown\. Open this link: https:\/\//)
  })

  it('on the desktop the link points at the team host derived from the relay; elsewhere it is bare', async () => {
    const user = setupUser()
    open({ mount: carved, desktop: true, locationOrigin: 'tauri://localhost', pinnedHost: 'ohhi.example.ts.net' })
    await user.click(await screen.findByRole('button', { name: t.copy_link_for({ name: 'Team' }) }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect((writeText.mock.calls[0]![0] as string).startsWith(`${ORIGIN}/join#editor1:`)).toBe(true)
    cleanup()

    const local = { ...carved, relay: 'ws://localhost:8787' }
    open({ mount: local, desktop: true, locationOrigin: 'tauri://localhost' })
    await user.click(await screen.findByRole('button', { name: t.copy_link_for({ name: 'Team' }) }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect((writeText.mock.calls[1]![0] as string).startsWith('editor1:')).toBe(true)
    cleanup()

    // A generic desktop build sharing on someone's wss://<host>/relay: no
    // guessed join page — the bare link, and the message says to paste it in the app.
    open({ mount: carved, desktop: true, locationOrigin: 'tauri://localhost', pinnedHost: '' })
    await user.click(await screen.findByRole('button', { name: t.copy_link_for({ name: 'Team' }) }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3))
    const bare = writeText.mock.calls[2]![0] as string
    expect(bare.startsWith('editor1:')).toBe(true)
    await user.click(screen.getByRole('button', { name: t.copy_message_for({ name: 'Team' }) }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(4))
    expect(writeText.mock.calls[3]![0]).toContain(t.message_bare({ folder: 'notes', link: bare }))
  })

  it('removes a link and reloads the list', async () => {
    const user = setupUser()
    open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.remove_for({ name: 'Sam' }) }))

    await waitFor(() => expect(admin.revokeShare).toHaveBeenCalledWith(RELAY, 'op-secret', 'tok-sam'))
    await waitFor(() => expect(admin.listShares).toHaveBeenCalledTimes(2))
  })

  it('creates a named link — a name is required — read-only when ticked', async () => {
    const user = setupUser()
    open({ mount: carved })
    const name = await screen.findByLabelText(t.new_link(), { exact: false })

    await user.click(screen.getByRole('button', { name: t.create() }))
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(name).toHaveAccessibleDescription(expect.stringContaining(t.name_required()))
    expect(admin.mintShare).not.toHaveBeenCalled()

    await user.type(name, 'Cynthia')
    await user.click(screen.getByLabelText(t.read_only_label()))
    await user.click(screen.getByRole('button', { name: t.create() }))

    await waitFor(() =>
      expect(admin.mintShare).toHaveBeenCalledWith(RELAY, 'op-secret', {
        folderGuid: ROOM,
        label: 'Cynthia',
        readOnly: true,
      })
    )
    await waitFor(() => expect(name).toHaveValue(''))
  })

  it('Stop sharing… hands over to the existing confirm', async () => {
    const user = setupUser()
    const props = open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.stop() }))

    expect(props.onStopSharing).toHaveBeenCalledOnce()
  })

  it('a folder shared WITH you: its link, no list, no first-run block, nothing to stop', async () => {
    open({ mount: { ...carved, provenance: 'joined', foreign: true }, secret: '' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(t.intro_joined({ path: 'notes', host: 'ohhi.example.ts.net' }))
    expect(screen.getByTestId('folder-share-link')).toHaveValue(FOLDER_LINK)
    expect(screen.queryByTestId('share-where')).toBeNull()
    expect(screen.queryByRole('button', { name: t.stop() })).toBeNull()
    expect(admin.listShares).not.toHaveBeenCalled()
  })
})
