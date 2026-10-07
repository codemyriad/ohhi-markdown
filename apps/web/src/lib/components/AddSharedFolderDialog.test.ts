// @vitest-environment jsdom
/**
 * *Add a shared folder* (sharing E4): one dialog for receiving a share, the
 * destination a CHOICE — inside the open vault at a folder, or as its own
 * vault — rather than whichever screen you were on.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { encodeDeviceLink, encodeShareLink } from '../share-link.js'
import AddSharedFolderDialog from './AddSharedFolderDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.share.add

const TOKEN = 'a'.repeat(64)
const folderLink = encodeShareLink({ relay: 'wss://relay.example', room: 'team-room', token: TOKEN })
const deviceLink = encodeDeviceLink({ relay: 'wss://relay.example', room: 'vault-room', token: TOKEN })

function open(over: Partial<ComponentProps<typeof AddSharedFolderDialog>> = {}) {
  const props = {
    vaultName: 'Myriad' as string | null,
    dirs: ['notes'],
    onJoinIntoVault: vi.fn(async (_link: string, _dest: string) => {}) as
      | ((link: string, dest: string) => Promise<void>)
      | null,
    onJoinAsVault: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(AddSharedFolderDialog, props)
  return props
}

const linkField = (): HTMLElement => screen.getByLabelText(t.link(), { exact: false })
const destField = (): HTMLElement => screen.getByRole('combobox', { name: t.dest() })
const intoVault = (name = 'Myriad'): HTMLElement => screen.getByRole('radio', { name: new RegExp(t.into_vault({ vault: name })) })
const ownVault = (): HTMLElement => screen.getByRole('radio', { name: new RegExp(t.own_vault()) })

describe('AddSharedFolderDialog', () => {
  it('is a named dialog: the link, the choice of where it goes (inside this vault by default), the folder', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: t.title() })
    expect(dialog).toHaveAccessibleDescription(t.description())
    expect(linkField()).toBeVisible()
    expect(screen.getByRole('group', { name: t.where() })).toBeVisible()
    expect(intoVault()).toBeChecked()
    expect(ownVault()).not.toBeChecked()
    expect(destField()).toBeVisible()
    expect(screen.getByTestId('add-share-trust')).toHaveTextContent(t.trust())
  })

  it('names the relay once the link decodes', async () => {
    const user = userEvent.setup()
    open()
    await user.type(linkField(), folderLink)
    expect(linkField()).toHaveAccessibleDescription(t.from_host({ host: 'relay.example' }))
  })

  it('refuses text that is not a share link, at the field', async () => {
    const user = userEvent.setup()
    const props = open()

    await user.type(linkField(), 'the team folder please')
    await user.type(destField(), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(linkField()).toHaveAttribute('aria-invalid', 'true'))
    expect(linkField()).toHaveAccessibleDescription(expect.stringContaining(t.link_invalid()))
    expect(props.onJoinIntoVault).not.toHaveBeenCalled()
    expect(props.onJoinAsVault).not.toHaveBeenCalled()
  })

  it('inside this vault: asks for the folder', async () => {
    const user = userEvent.setup()
    const props = open()

    await user.type(linkField(), folderLink)
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(destField()).toHaveAttribute('aria-invalid', 'true'))
    expect(destField()).toHaveAccessibleDescription(expect.stringContaining(t.dest_required()))
    expect(props.onJoinIntoVault).not.toHaveBeenCalled()
  })

  /**
   * R5: a device link is a full-access key to a whole vault. Joining one as a
   * FOLDER of this vault is refused where the paste happens, with the reason.
   */
  it('refuses a DEVICE link inside this vault and says where it belongs', async () => {
    const user = userEvent.setup()
    const props = open()

    await user.type(linkField(), deviceLink)
    await user.type(destField(), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(linkField()).toHaveAttribute('aria-invalid', 'true'))
    expect(linkField()).toHaveAccessibleDescription(
      expect.stringContaining(LL.web.mounts.dialog.device_link_refused())
    )
    expect(props.onJoinIntoVault).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('hands a folder link and its destination to the workspace, then closes', async () => {
    const user = userEvent.setup()
    const props = open({ initialDest: 'notes/' })

    await user.type(linkField(), folderLink)
    await user.type(destField(), 'team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(props.onJoinIntoVault).toHaveBeenCalledWith(folderLink, 'notes/team'))
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(props.onJoinAsVault).not.toHaveBeenCalled()
  })

  it('as its own vault: no folder to pick, the manager joins it', async () => {
    const user = userEvent.setup()
    const props = open()

    await user.type(linkField(), folderLink)
    await user.click(ownVault())
    expect(screen.queryByRole('combobox', { name: t.dest() })).toBeNull()
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(folderLink))
    expect(props.onJoinIntoVault).not.toHaveBeenCalled()
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('from the manager with no vault open: only "as its own vault", and it says why', async () => {
    const user = userEvent.setup()
    const props = open({ vaultName: null, onJoinIntoVault: null, initialLink: deviceLink })

    const into = screen.getByRole('radio', { name: new RegExp(t.into_a_vault()) })
    expect(into).toBeDisabled()
    expect(screen.getByText(t.into_vault_unavailable())).toBeVisible()
    expect(ownVault()).toBeChecked()
    expect(linkField()).toHaveValue(deviceLink)

    // A device link as its own vault is the manager's to route (to Link this device).
    await user.click(screen.getByRole('button', { name: t.join() }))
    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(deviceLink))
  })

  it('keeps the paste and shows the reason when the workspace refuses', async () => {
    const user = userEvent.setup()
    const reason = LL.web.workspace.already_joined()
    const props = open({
      onJoinIntoVault: vi.fn(async () => {
        throw new Error(reason)
      }),
    })

    await user.type(linkField(), folderLink)
    await user.type(destField(), 'shared/team')
    await user.click(screen.getByRole('button', { name: t.join() }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(props.onClose).not.toHaveBeenCalled()
    expect(linkField()).toHaveValue(folderLink)
  })

  it('as its own vault from inside a workspace: a failed join keeps the dialog open and says why', async () => {
    const user = userEvent.setup()
    const reason = LL.web.device_link.already_linked({ name: 'Notes' })
    const props = open({
      onJoinAsVault: vi.fn(async () => {
        throw new Error(reason)
      }),
    })

    await user.type(linkField(), folderLink)
    await user.click(ownVault())
    await user.click(screen.getByRole('button', { name: t.join() }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reason)
    expect(props.onClose).not.toHaveBeenCalled()
    expect(linkField()).toHaveValue(folderLink)
  })
})
