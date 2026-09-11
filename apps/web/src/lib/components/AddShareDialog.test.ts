// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@editor/i18n'
import { encodeDeviceLink, encodeShareLink } from '../share-link.js'
import AddShareDialog from './AddShareDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.share.add

const TOKEN = 'a'.repeat(64)
const folderLink = encodeShareLink({ relay: 'wss://relay.example', room: 'team-room', token: TOKEN })
const deviceLink = encodeDeviceLink({
  relay: 'wss://relay.example',
  room: 'vault-room',
  token: TOKEN,
})

function open(onJoin: (link: string, dest: string) => Promise<void>) {
  const onClose = vi.fn()
  render(AddShareDialog, { dirs: ['notes'], onJoin, onClose })
  return { onClose }
}

const linkField = (): HTMLElement => screen.getByLabelText(t.link(), { exact: false })

describe('AddShareDialog', () => {
  it('is a named dialog with a link field and a destination field', async () => {
    open(async () => {})

    const dialog = await screen.findByRole('dialog', { name: t.title() })
    expect(dialog).toHaveAccessibleDescription(t.description())
    expect(linkField()).toBeVisible()
    expect(screen.getByLabelText(t.dest(), { exact: false })).toBeVisible()
  })

  it('refuses text that is not a share link, at the field', async () => {
    const user = userEvent.setup()
    const onJoin = vi.fn(async () => {})
    open(onJoin)

    await user.type(linkField(), 'the team folder please')
    await user.type(screen.getByLabelText(t.dest(), { exact: false }), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(linkField()).toHaveAttribute('aria-invalid', 'true'))
    expect(linkField()).toHaveAccessibleDescription(expect.stringContaining(t.link_invalid()))
    expect(onJoin).not.toHaveBeenCalled()
  })

  /**
   * R5: a device link is a full-access key to a whole vault. Joining one as a
   * FOLDER of this vault is refused where the paste happens, with the reason
   * and the affordance that does want it.
   */
  it('refuses a DEVICE link and says where it belongs', async () => {
    const user = userEvent.setup()
    const onJoin = vi.fn(async () => {})
    const { onClose } = open(onJoin)

    await user.type(linkField(), deviceLink)
    await user.type(screen.getByLabelText(t.dest(), { exact: false }), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(linkField()).toHaveAttribute('aria-invalid', 'true'))
    expect(linkField()).toHaveAccessibleDescription(
      expect.stringContaining(LL.web.mounts.dialog.device_link_refused())
    )
    expect(onJoin).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('hands a folder link and its destination to the workspace, then closes', async () => {
    const user = userEvent.setup()
    const onJoin = vi.fn(async () => {})
    const { onClose } = open(onJoin)

    await user.type(linkField(), folderLink)
    await user.type(screen.getByLabelText(t.dest(), { exact: false }), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(onJoin).toHaveBeenCalledWith(folderLink, 'shared/team'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the paste and shows the reason when the workspace refuses', async () => {
    const user = userEvent.setup()
    const reason = LL.web.workspace.already_joined()
    const onJoin = vi.fn(async () => {
      throw new Error(reason)
    })
    const { onClose } = open(onJoin)

    await user.type(linkField(), folderLink)
    await user.type(screen.getByLabelText(t.dest(), { exact: false }), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(onClose).not.toHaveBeenCalled()
    expect(linkField()).toHaveValue(folderLink)
  })
})
