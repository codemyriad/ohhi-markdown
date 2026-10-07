// @vitest-environment jsdom
/**
 * The share sheet (sharing E4): links as named rows, the new-link row, the
 * honesty paragraph in the body, *Stop sharing* at the foot, and the first
 * run that meets the relay inline — validated as Settings › Sync validates it
 * and shown only while no operator secret is configured.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { encodeShareLink } from '../share-link.js'
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
const sync = LL.web.settings.sync

const RELAY = 'wss://relay.example'
const ROOM = 'room-notes'
const FOLDER_LINK = encodeShareLink({ relay: RELAY, room: ROOM, token: 'a'.repeat(64) })

const carved: MountInfo = {
  path: 'notes',
  room: ROOM,
  provenance: 'carved',
  link: FOLDER_LINK,
  status: 'active',
  foreign: false,
  relay: RELAY,
}

beforeEach(() => {
  admin.listShares.mockResolvedValue([
    { token: 'tok-sam', folderGuid: ROOM, readOnly: true, label: 'Sam', createdAt: '2026-09-20T10:00:00Z' },
    { token: 'tok-team', folderGuid: ROOM, readOnly: false, label: 'Team', createdAt: '2026-09-12T10:00:00Z' },
  ])
  admin.mintShare.mockResolvedValue({ token: 'tok-new', folderGuid: ROOM, readOnly: false, label: 'Cynthia' })
  admin.revokeShare.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function open(over: Partial<ComponentProps<typeof ShareSheet>> = {}) {
  const props = {
    path: 'notes',
    mount: null as MountInfo | null,
    relayUrl: RELAY,
    secret: 'op-secret',
    onShare: vi.fn(async () => FOLDER_LINK),
    onRemember: vi.fn(),
    onStopSharing: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(ShareSheet, props)
  return props
}

describe('ShareSheet — not shared yet', () => {
  it('is a named dialog that says what sharing does, with the honesty paragraph in the body', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: t.title({ path: 'notes' }) })
    expect(dialog).toHaveAccessibleDescription(t.intro_new())
    expect(screen.getByTestId('share-honesty')).toHaveTextContent(t.honesty())
    // A relay is configured: no first-run block, and nothing to stop yet.
    expect(screen.queryByTestId('share-where')).toBeNull()
    expect(screen.queryByRole('button', { name: t.stop() })).toBeNull()
  })

  it('shares with the configured relay and copies the link — Settings untouched', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const props = open()

    await user.click(screen.getByRole('button', { name: t.share() }))

    await waitFor(() => expect(props.onShare).toHaveBeenCalledOnce())
    expect(props.onRemember).not.toHaveBeenCalled()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FOLDER_LINK))
    expect(await screen.findByRole('status')).toHaveTextContent(t.shared_copied())
  })

  it('shows why when the carve fails, and stays open', async () => {
    const user = userEvent.setup()
    const reason = LL.web.relay.bad_secret()
    const props = open({ onShare: vi.fn(async () => Promise.reject(new Error(reason))) })

    await user.click(screen.getByRole('button', { name: t.share() }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

describe('ShareSheet — first run (no operator secret)', () => {
  const relayField = (): HTMLElement => screen.getByLabelText(t.relay(), { exact: false })
  const secretField = (): HTMLElement => screen.getByLabelText(t.secret(), { exact: false })

  it('asks where it syncs, inline, with the relay prefilled', async () => {
    open({ secret: '' })
    const where = await screen.findByTestId('share-where')
    expect(within(where).getByRole('heading', { name: t.where_title() })).toBeVisible()
    expect(relayField()).toHaveValue(RELAY)
    expect(secretField()).toHaveValue('')
    expect(secretField()).toHaveAccessibleDescription(expect.stringContaining(t.where_hint()))
  })

  it('refuses a relay that is not ws(s):// and a missing secret, at the fields, before any carve', async () => {
    const user = userEvent.setup()
    const props = open({ secret: '' })

    await user.clear(relayField())
    await user.type(relayField(), 'http://relay.example')
    await user.click(screen.getByRole('button', { name: t.share() }))

    await waitFor(() => expect(relayField()).toHaveAttribute('aria-invalid', 'true'))
    expect(relayField()).toHaveAccessibleDescription(expect.stringContaining(sync.relay_invalid()))
    expect(secretField()).toHaveAccessibleDescription(expect.stringContaining(t.secret_required()))
    expect(props.onRemember).not.toHaveBeenCalled()
    expect(props.onShare).not.toHaveBeenCalled()
  })

  it('remembers the relay and secret in Settings › Sync, then shares', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    const props = open({
      secret: '',
      onRemember: vi.fn(() => void calls.push('remember')),
      onShare: vi.fn(async () => {
        calls.push('share')
        return FOLDER_LINK
      }),
    })

    await user.clear(relayField())
    await user.type(relayField(), 'wss://team.example')
    await user.type(secretField(), 'op-secret')
    await user.click(screen.getByRole('button', { name: t.share() }))

    await waitFor(() => expect(props.onShare).toHaveBeenCalledOnce())
    expect(props.onRemember).toHaveBeenCalledWith('wss://team.example', 'op-secret')
    // Remembered FIRST: the carve reads the secret from Settings.
    expect(calls).toEqual(['remember', 'share'])
    await waitFor(() => expect(screen.queryByTestId('share-where')).toBeNull())
  })
})

describe('ShareSheet — shared', () => {
  it('lists the links as named rows: label, read-only, created, Copy link, Remove', async () => {
    open({ mount: carved })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(t.intro_shared({ path: 'notes', host: 'relay.example' }))
    expect(await screen.findByRole('heading', { name: t.links({ count: 2 }) })).toBeVisible()
    expect(admin.listShares).toHaveBeenCalledWith(RELAY, 'op-secret', ROOM)

    const sam = screen.getByTestId('token-row:Sam')
    expect(sam).toHaveTextContent('Sam')
    expect(sam).toHaveTextContent(t.read_only())
    expect(sam).toHaveTextContent(t.created({ date: '' }).trim())
    expect(screen.getByTestId('token-row:Team')).not.toHaveTextContent(t.read_only())
    expect(within(sam).getByRole('button', { name: t.copy_link_for({ name: 'Sam' }) })).toBeVisible()
    expect(within(sam).getByRole('button', { name: t.remove_for({ name: 'Sam' }) })).toBeVisible()
    expect(screen.queryByTestId('share-where')).toBeNull()
  })

  it("copies a row's own link", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.copy_link_for({ name: 'Team' }) }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(encodeShareLink({ relay: RELAY, room: ROOM, token: 'tok-team' }))
    )
  })

  it('removes a link and reloads the list', async () => {
    const user = userEvent.setup()
    open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.remove_for({ name: 'Sam' }) }))

    await waitFor(() => expect(admin.revokeShare).toHaveBeenCalledWith(RELAY, 'op-secret', 'tok-sam'))
    await waitFor(() => expect(admin.listShares).toHaveBeenCalledTimes(2))
  })

  it('creates a named link — a name is required — read-only when ticked', async () => {
    const user = userEvent.setup()
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
    const user = userEvent.setup()
    const props = open({ mount: carved })

    await user.click(await screen.findByRole('button', { name: t.stop() }))

    expect(props.onStopSharing).toHaveBeenCalledOnce()
  })

  it('a folder shared WITH you: its link, no list, no first-run block, nothing to stop', async () => {
    open({ mount: { ...carved, provenance: 'joined', foreign: true }, secret: '' })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(t.intro_joined({ path: 'notes', host: 'relay.example' }))
    expect(screen.getByTestId('folder-share-link')).toHaveValue(FOLDER_LINK)
    expect(screen.queryByTestId('share-where')).toBeNull()
    expect(screen.queryByRole('button', { name: t.stop() })).toBeNull()
    expect(admin.listShares).not.toHaveBeenCalled()
  })
})
