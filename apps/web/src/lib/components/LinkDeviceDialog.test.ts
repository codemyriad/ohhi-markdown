// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { encodeDeviceLink, encodeShareLink } from '../share-link.js'
import LinkDeviceDialog from './LinkDeviceDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.device_link

const TOKEN = 'a'.repeat(64)
const deviceLink = encodeDeviceLink({ relay: 'wss://relay.example', room: 'vault-room', token: TOKEN })
const folderLink = encodeShareLink({ relay: 'wss://relay.example', room: 'team-room', token: TOKEN })

function open(onLink: (link: string) => Promise<void>, isTauri = false) {
  const onClose = vi.fn()
  render(LinkDeviceDialog, { isTauri, onLink, onClose })
  return { onClose }
}

const field = (): HTMLElement => screen.getByLabelText(t.join_link(), { exact: false })

describe('LinkDeviceDialog', () => {
  it('is a named dialog that says where the vault will land and what will not arrive', async () => {
    open(async () => {}, true)

    const dialog = await screen.findByRole('dialog', { name: t.join_title() })
    expect(dialog).toHaveAccessibleDescription(t.join_description())
    // The desktop hint is the field's description; the browser gets its own.
    expect(field()).toHaveAccessibleDescription(t.join_hint_desktop())
    // Decision 6, stated rather than discovered.
    expect(screen.getByTestId('link-device-attachments')).toHaveTextContent(t.attachments())
  })

  it('refuses text that is not a link at all', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn(async () => {})
    const { onClose } = open(onLink)

    await user.type(field(), 'my other laptop')
    await user.click(screen.getByRole('button', { name: t.join_submit() }))

    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'))
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(t.join_link_invalid()))
    expect(onLink).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses a FOLDER link and points at the affordance that wants it (R5)', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn(async () => {})
    open(onLink)

    await user.type(field(), folderLink)
    await user.click(screen.getByRole('button', { name: t.join_submit() }))

    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'))
    expect(field()).toHaveAccessibleDescription(expect.stringContaining(t.join_not_device()))
    expect(onLink).not.toHaveBeenCalled()
  })

  it('hands a DEVICE link to the host, then closes', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn(async () => {})
    const { onClose } = open(onLink)

    await user.type(field(), deviceLink)
    await user.click(screen.getByRole('button', { name: t.join_submit() }))

    await waitFor(() => expect(onLink).toHaveBeenCalledWith(deviceLink))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the paste and shows the reason when the destination is refused', async () => {
    const user = userEvent.setup()
    const reason = t.not_empty({ path: '/home/chris/vault' })
    const onLink = vi.fn(async () => {
      throw new Error(reason)
    })
    const { onClose } = open(onLink, true)

    await user.type(field(), deviceLink)
    await user.click(screen.getByRole('button', { name: t.join_submit() }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(onClose).not.toHaveBeenCalled()
    expect(field()).toHaveValue(deviceLink)
  })

  it('cancels without linking anything', async () => {
    const user = userEvent.setup()
    const onLink = vi.fn(async () => {})
    const { onClose } = open(onLink)

    await user.click(screen.getByRole('button', { name: LL.common.cancel() }))
    expect(onClose).toHaveBeenCalled()
    expect(onLink).not.toHaveBeenCalled()
  })
})
