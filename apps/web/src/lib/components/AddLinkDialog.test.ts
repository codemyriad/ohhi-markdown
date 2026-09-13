// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { encodeDeviceLink, encodeShareLink } from '../share-link.js'
import AddLinkDialog from './AddLinkDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.mounts.dialog

const linkFor = (room: string): string =>
  encodeShareLink({ relay: 'wss://relay.example', room, token: 'a'.repeat(64) })

/** Render the dialog for the mount `team` (room `r-team`) with spy callbacks. */
function open(onAdd: (link: string) => Promise<void>) {
  const onClose = vi.fn()
  render(AddLinkDialog, { path: 'team', room: 'r-team', onAdd, onClose })
  return { onClose }
}

describe('AddLinkDialog', () => {
  it('is a named dialog with one labelled, described field', async () => {
    open(async () => {})

    const dialog = await screen.findByRole('dialog', { name: t.title({ path: 'team' }) })
    expect(dialog).toHaveAccessibleDescription(t.description())
    const field = screen.getByLabelText(t.link(), { exact: false })
    // The field's help text is wired through aria-describedby by `Field`.
    expect(field).toHaveAccessibleDescription(LL.web.mounts.link_needed_title())
  })

  it('refuses text that is not a share link, at the field, before the workspace hears about it', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => {})
    const { onClose } = open(onAdd)

    await user.type(screen.getByLabelText(t.link(), { exact: false }), 'have some notes')
    await user.click(screen.getByRole('button', { name: t.add() }))

    const field = screen.getByLabelText(t.link(), { exact: false })
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(expect.stringContaining(t.link_invalid()))
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses a link for a DIFFERENT folder, naming the one it is for', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => {})
    const { onClose } = open(onAdd)

    await user.type(screen.getByLabelText(t.link(), { exact: false }), linkFor('r-someone-else'))
    await user.click(screen.getByRole('button', { name: t.add() }))

    const field = screen.getByLabelText(t.link(), { exact: false })
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining(t.wrong_room({ path: 'team' }))
    )
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('refuses a DEVICE link at the field and names what it is for (R5)', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => {})
    const { onClose } = open(onAdd)

    // A key to a whole vault, pasted where a folder's link belongs. The
    // workspace refuses it too — this is the refusal a person sees.
    await user.type(
      screen.getByLabelText(t.link(), { exact: false }),
      encodeDeviceLink({ relay: 'wss://relay.example', room: 'r-team', token: 'c'.repeat(64) })
    )
    await user.click(screen.getByRole('button', { name: t.add() }))

    const field = screen.getByLabelText(t.link(), { exact: false })
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining(t.device_link_refused())
    )
    expect(onAdd).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hands a link for THIS folder to the workspace, then closes', async () => {
    const user = userEvent.setup()
    const link = linkFor('r-team')
    const onAdd = vi.fn(async () => {})
    const { onClose } = open(onAdd)

    await user.type(screen.getByLabelText(t.link(), { exact: false }), link)
    await user.click(screen.getByRole('button', { name: t.add() }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(link))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the paste and shows the reason when the workspace refuses', async () => {
    const user = userEvent.setup()
    const link = linkFor('r-team')
    const onAdd = vi.fn(async () => {
      throw new Error('relay rejected the token')
    })
    const { onClose } = open(onAdd)

    await user.type(screen.getByLabelText(t.link(), { exact: false }), link)
    await user.click(screen.getByRole('button', { name: t.add() }))

    expect(await screen.findByRole('alert')).toHaveTextContent('relay rejected the token')
    expect(onClose).not.toHaveBeenCalled()
    // The link the user pasted is still there to fix or retry.
    expect(screen.getByLabelText(t.link(), { exact: false })).toHaveValue(link)
  })

  it('cancels without touching the mount', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn(async () => {})
    const { onClose } = open(onAdd)

    await user.click(screen.getByRole('button', { name: LL.common.cancel() }))
    expect(onClose).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
