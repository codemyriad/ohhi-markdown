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
import { loadUser, saveUser } from '../config.js'
import type { Probe } from '../relay-check.js'
import type { ProbeResult } from '../relay-probe.js'
import { encodeDeviceLink, encodeShareLink, encodeShareUrl } from '../share-link.js'
import AddSharedFolderDialog from './AddSharedFolderDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  localStorage.clear()
})

// Expectations come from the dictionary, not pasted English (testing skill).
const LL = getLL()
const t = LL.web.share.add

const TOKEN = 'a'.repeat(64)
const folderLink = encodeShareLink({ relay: 'wss://relay.example', room: 'team-room', token: TOKEN })
const deviceLink = encodeDeviceLink({ relay: 'wss://relay.example', room: 'vault-room', token: TOKEN })

/** A probe whose answer the test gives, when it chooses (never the network). */
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

function open(over: Partial<ComponentProps<typeof AddSharedFolderDialog>> = {}) {
  const props = {
    vaultName: 'Myriad' as string | null,
    dirs: ['notes'],
    onJoinIntoVault: vi.fn(async (_link: string, _dest: string) => {}) as
      | ((link: string, dest: string) => Promise<void>)
      | null,
    onJoinAsVault: vi.fn(),
    onClose: vi.fn(),
    isTauri: false,
    probe: deferredProbe().probe,
    teamHost: null as string | null,
    networkNote: '',
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

  it('names the relay once the link decodes, and asks it whether it answers', async () => {
    const user = userEvent.setup()
    const p = deferredProbe()
    open({ probe: p.probe })
    await user.type(linkField(), folderLink)
    expect(screen.getByTestId('add-share-about')).toHaveTextContent(t.from_host({ host: 'relay.example' }))
    expect(linkField()).toHaveAccessibleDescription(expect.stringContaining(t.probe_checking()))
    expect(p.calls.at(-1)).toBe('wss://relay.example')
    p.answer({ ok: true })
    await waitFor(() => expect(screen.getByTestId('add-share-probe')).toHaveTextContent(t.probe_ok()))
  })

  it('accepts the URL spelling (…/join#editor1:…) and shows the label and the name they typed', async () => {
    const user = userEvent.setup()
    const props = open()
    const link = encodeShareUrl(
      { relay: 'wss://relay.example/relay', room: 'team-room', token: TOKEN, label: 'team/notes', from: 'Sam' },
      'https://relay.example'
    )
    await user.click(linkField())
    await user.paste(link)
    expect(screen.getByTestId('add-share-about')).toHaveTextContent(
      t.from_label_sender({ label: 'team/notes', from: 'Sam', host: 'relay.example' })
    )

    await user.click(ownVault())
    await user.click(screen.getByRole('button', { name: t.join() }))
    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(link, expect.any(String)))
  })

  it('a label without a sender, and a sender without a label, each say only what the link carries', async () => {
    const user = userEvent.setup()
    open()
    await user.click(linkField())
    await user.paste(encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: TOKEN, label: 'team' }))
    expect(screen.getByTestId('add-share-about')).toHaveTextContent(t.from_label({ label: 'team', host: 'relay.example' }))
    await user.clear(linkField())
    await user.paste(encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: TOKEN, from: 'Sam' }))
    expect(screen.getByTestId('add-share-about')).toHaveTextContent(t.from_sender({ from: 'Sam', host: 'relay.example' }))
  })

  it('a relay that does not answer: "can’t reach", with the network sentence only on the team’s host', async () => {
    const user = userEvent.setup()
    const p = deferredProbe()
    open({ probe: p.probe, teamHost: 'relay.example', networkNote: 'Shares work only on the tailnet.' })
    await user.click(linkField())
    await user.paste(folderLink)
    p.answer({ ok: false, reason: 'unreachable' })
    await waitFor(() =>
      expect(screen.getByTestId('add-share-probe')).toHaveTextContent(
        t.probe_down_note({ note: 'Shares work only on the tailnet.' })
      )
    )
    cleanup()

    const q = deferredProbe()
    open({ probe: q.probe, teamHost: 'ohhi.team', networkNote: 'Shares work only on the tailnet.' })
    await user.click(linkField())
    await user.paste(folderLink)
    q.answer({ ok: false, reason: 'timeout' })
    await waitFor(() => expect(screen.getByTestId('add-share-probe')).toHaveTextContent(t.probe_down()))
    expect(screen.getByTestId('add-share-probe')).not.toHaveTextContent('tailnet')
  })

  it('a relay that answered unhealthy is reached: its own line, no network sentence, announced as a status', async () => {
    const user = userEvent.setup()
    const p = deferredProbe()
    open({ probe: p.probe, teamHost: 'relay.example', networkNote: 'Shares work only on the tailnet.' })
    await user.click(linkField())
    await user.paste(folderLink)
    const line = screen.getByTestId('add-share-probe')
    expect(line).toHaveAttribute('role', 'status')
    p.answer({ ok: false, reason: 'unhealthy' })
    await waitFor(() => expect(line).toHaveTextContent(t.probe_unhealthy()))
    expect(line).toHaveAttribute('data-check', 'unhealthy')
    expect(line).not.toHaveTextContent('tailnet')
    expect(line).not.toHaveTextContent(t.probe_down())
  })

  it('closing the dialog cancels the probe in flight', async () => {
    const user = userEvent.setup()
    const p = deferredProbe()
    open({ probe: p.probe })
    await user.click(linkField())
    await user.paste(folderLink)
    expect(p.signals.at(-1)?.aborted).toBe(false)
    cleanup()
    expect(p.signals.at(-1)?.aborted).toBe(true)
  })

  it('a device link says what it is under the field', async () => {
    const user = userEvent.setup()
    open()
    await user.click(linkField())
    await user.paste(deviceLink)
    expect(screen.getByTestId('add-share-about')).toHaveTextContent(t.from_device({ host: 'relay.example' }))
  })

  it('"Your name" is prefilled from the saved name and saved, as typed, when the join starts (Fork 5-A)', async () => {
    const user = userEvent.setup()
    saveUser('Chris')
    const props = open({
      vaultName: null,
      onJoinIntoVault: null,
      // The manager's join saves the name it was handed; the dialog's must win.
      onJoinAsVault: vi.fn((_link: string, _name: string) => saveUser('Manager name')),
    })
    const name = screen.getByRole('textbox', { name: t.name() })
    expect(name).toHaveValue('Chris')
    await user.clear(name)
    await user.type(name, 'Sam')
    await user.click(linkField())
    await user.paste(folderLink)
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(folderLink, 'Sam'))
    expect(loadUser()).toBe('Sam')
  })

  it('inside the vault, the name is saved before the workspace joins', async () => {
    const user = userEvent.setup()
    let savedAtJoin: string | null = null
    open({
      initialName: 'Ana',
      onJoinIntoVault: vi.fn(async () => {
        savedAtJoin = loadUser()
      }),
    })
    await user.click(linkField())
    await user.paste(folderLink)
    await user.type(destField(), 'team')
    await user.click(screen.getByRole('button', { name: t.join() }))
    await waitFor(() => expect(savedAtJoin).toBe('Ana'))
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

    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(folderLink, expect.any(String)))
    expect(props.onJoinIntoVault).not.toHaveBeenCalled()
    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  })

  it('as its own vault says what happens next on this platform, and only once chosen (first-run F1)', async () => {
    const user = userEvent.setup()
    open({ isTauri: true })
    expect(screen.queryByTestId('add-share-own-platform')).toBeNull()
    await user.click(ownVault())
    expect(screen.getByTestId('add-share-own-platform')).toHaveTextContent(t.own_vault_desktop())
    await user.click(intoVault())
    expect(screen.queryByTestId('add-share-own-platform')).toBeNull()
    cleanup()

    open({ vaultName: null, onJoinIntoVault: null, isTauri: false })
    expect(screen.getByTestId('add-share-own-platform')).toHaveTextContent(t.own_vault_browser())
    expect(screen.queryByText(t.own_vault_desktop())).toBeNull()
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
    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalledWith(deviceLink, expect.any(String)))
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

  it('as its own vault: a hand-off that resolves false (the folder picker was cancelled) keeps the dialog and the paste', async () => {
    const user = userEvent.setup()
    const props = open({ vaultName: null, onJoinIntoVault: null, onJoinAsVault: vi.fn(async () => false) })

    await user.type(linkField(), folderLink)
    await user.click(screen.getByRole('button', { name: t.join() }))

    await waitFor(() => expect(props.onJoinAsVault).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: t.join() })).toBeEnabled())
    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(linkField()).toHaveValue(folderLink)
  })
})
