// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { encodeDeviceLink } from '../share-link.js'
import type { RelayShare } from '../relay-admin.js'
import DeviceLinkDialog from './DeviceLinkDialog.svelte'

// The relay is the only thing this dialog reads; the admin client is the seam.
const listShares = vi.fn<() => Promise<RelayShare[]>>()
const revokeShare = vi.fn<() => Promise<void>>()
vi.mock('../relay-admin.js', () => ({
  listShares: (...args: unknown[]) => listShares(...(args as [])),
  revokeShare: (...args: unknown[]) => revokeShare(...(args as [])),
}))

const LL = getLL()
const t = LL.web.device_link

const ROOM = 'vault-room'
const LINK = encodeDeviceLink({ relay: 'wss://relay.example', room: ROOM, token: 'b'.repeat(64) })

const share = (over: Partial<RelayShare> = {}): RelayShare => ({
  token: 'c'.repeat(64),
  folderGuid: ROOM,
  readOnly: false,
  label: 'laptop',
  kind: 'device',
  ...over,
})

beforeEach(() => {
  listShares.mockResolvedValue([])
  revokeShare.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function open(opts: { secret?: string; onCreate?: (label: string) => Promise<string> } = {}) {
  const onCreate = opts.onCreate ?? vi.fn(async () => LINK)
  const onClose = vi.fn()
  render(DeviceLinkDialog, {
    vaultName: 'Chris’s vault',
    room: ROOM,
    relayUrl: 'wss://relay.example',
    secret: opts.secret ?? 'op-secret',
    onCreate,
    onClose,
  })
  return { onCreate, onClose }
}

describe('DeviceLinkDialog', () => {
  it('refuses to mint without the operator secret, and says which one', async () => {
    open({ secret: '' })

    await screen.findByRole('dialog', { name: t.title() })
    expect(screen.getByTestId('device-link-needs-secret')).toHaveTextContent(t.needs_secret())
    expect(screen.queryByRole('button', { name: t.create() })).toBeNull()
    // Nothing is read from the relay either — there is no credential to read with.
    expect(listShares).not.toHaveBeenCalled()
  })

  it('creates a link and shows the R5 sentence beside the copy button', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => LINK)
    open({ onCreate })

    await user.type(screen.getByLabelText(t.label(), { exact: false }), 'laptop')
    await user.click(screen.getByRole('button', { name: t.create() }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('laptop'))
    const value = await screen.findByLabelText(t.link())
    expect(value).toHaveValue(LINK)
    // R5: a full-access key, said at the point of copying.
    expect(screen.getByTestId('device-link-warning')).toHaveTextContent(t.full_access_warning())
    expect(screen.getByRole('button', { name: t.copy() })).toBeInTheDocument()
  })

  it('copies the link to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {})
    // AFTER setup(): user-event installs a clipboard stub of its own, and
    // jsdom's navigator.clipboard is a getter-only property either way.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    open()

    await user.click(screen.getByRole('button', { name: t.create() }))
    await screen.findByLabelText(t.link())
    await user.click(screen.getByRole('button', { name: t.copy() }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK))
  })

  it('keeps the dialog open and shows why when the relay refuses the mint', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn(async () => {
      throw new Error(LL.web.relay.bad_secret())
    })
    const { onClose } = open({ onCreate })

    await user.click(screen.getByRole('button', { name: t.create() }))

    expect(await screen.findByTestId('device-link-error')).toHaveTextContent(LL.web.relay.bad_secret())
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(t.link())).toBeNull()
  })

  it('lists only DEVICE links for this vault, and revokes one', async () => {
    const user = userEvent.setup()
    listShares.mockResolvedValue([
      share({ token: 'd'.repeat(64), label: 'laptop' }),
      // A folder token for another room is not this dialog's business.
      share({ token: 'e'.repeat(64), label: 'team', kind: 'folder', folderGuid: 'team-room' }),
    ])
    open()

    const list = await screen.findByTestId('device-link-list')
    expect(list).toHaveTextContent('laptop')
    expect(list).not.toHaveTextContent('team')

    await user.click(screen.getByRole('button', { name: t.revoke_device({ label: 'laptop' }) }))
    await waitFor(() => expect(revokeShare).toHaveBeenCalledWith('wss://relay.example', 'op-secret', 'd'.repeat(64)))
    // The list is re-read, never patched locally: the relay is the authority.
    await waitFor(() => expect(listShares).toHaveBeenCalledTimes(2))
  })

  it('names an unlabelled device rather than showing its token', async () => {
    listShares.mockResolvedValue([share({ label: null })])
    open()
    expect(await screen.findByTestId('device-link-list')).toHaveTextContent(t.unnamed())
  })
})
