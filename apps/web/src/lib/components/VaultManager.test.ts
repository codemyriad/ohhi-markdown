// @vitest-environment jsdom
/**
 * The vault manager (first-run A1/B1): the welcome when no vault is
 * registered — doors worded as the thing you have, no name asked (Fork 5-A)
 * — and the list once there is one: rows that say what each vault is, one
 * Add menu, the row menu, the inline confirm and a failed row's two ways on.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import type { VaultEntry } from '../config.js'
import { guideHref, openGuide } from '../guide.js'
import { help } from '../help.svelte.js'
import type { Probe } from '../relay-check.js'
import { encodeShareLink } from '../share-link.js'
import VaultManager from './VaultManager.svelte'

// `openGuide` is the one way a guide opens; the desktop's link must go through it.
vi.mock('../guide.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../guide.js')>()),
  openGuide: vi.fn(async () => {}),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(openGuide).mockClear()
  help.menuOpen = false
  help.reportOpen = false
  localStorage.clear()
})

/** The Add dialog's relay check, answered without the network. */
const probe: Probe = vi.fn(async () => ({ ok: true }) as const)

const LL = getLL()
const t = LL.web.manager
const w = LL.web.manager.welcome
const l = LL.web.manager.list

const NOW = new Date(2026, 9, 10, 12).getTime()
const disk: VaultEntry = {
  name: 'Notes',
  room: 'room-disk',
  vault: { kind: 'tauri', path: '/home/chris/Notes' },
  lastOpenedAt: new Date(2026, 9, 10, 9).getTime(),
}
const browser: VaultEntry = { name: 'Scratch', room: 'room-web', vault: { kind: 'opfs', id: 'w' } }

function setup(over: Partial<ComponentProps<typeof VaultManager>> = {}) {
  const props = {
    isTauri: false,
    hasOpfs: true,
    defaultUser: 'Chris',
    vaults: [] as VaultEntry[],
    shares: [],
    prefillLink: '',
    failure: null,
    busy: false,
    canGoBack: false,
    currentRoom: null,
    onOpenVault: vi.fn(),
    onRemoveVault: vi.fn(),
    onRenameVault: vi.fn(),
    onAllowAccess: vi.fn(),
    onOpenFolder: vi.fn(),
    onCreateBrowserVault: vi.fn(),
    onJoin: vi.fn(),
    onLinkDevice: vi.fn(),
    onBack: vi.fn(),
    onSettings: vi.fn(),
    onLoadFacts: vi.fn(),
    storageNote: null,
    onKeepStorage: vi.fn(),
    onDismissStorage: vi.fn(),
    now: () => NOW,
    probe,
    ...over,
  } satisfies ComponentProps<typeof VaultManager>
  render(VaultManager, props)
  return { props, user: userEvent.setup() }
}

describe('the welcome (no vault registered)', () => {
  it('says hello in one sentence and offers the browser doors — and never asks for a name', () => {
    setup()
    // The greeting is the product's name: the wordmark as the h1, read whole, no full stop.
    const heading = screen.getByRole('heading', { level: 1, name: LL.common.app_name() })
    expect(heading).toBe(screen.getByTestId('welcome-heading'))
    expect(heading.querySelector('.ed-wordmark-hi')).toHaveTextContent(LL.common.wordmark.hi())
    expect(heading.querySelector('em.ed-wordmark-mark')).toHaveTextContent(LL.common.wordmark.mark())
    // The header's brand is the wordmark too, named as one word sequence.
    expect(within(screen.getByRole('banner')).getByRole('img', { name: LL.common.app_name() })).toBe(
      screen.getByTestId('manager-wordmark'),
    )
    expect(screen.getByText(w.lede())).toBeTruthy()
    const doors = within(screen.getByRole('list', { name: w.doors() }))
    expect(doors.getByTestId('start-browser-vault').textContent).toContain(w.browser())
    expect(doors.getByTestId('start-browser-vault').textContent).toContain(w.browser_hint())
    expect(doors.getByTestId('join-share').textContent).toContain(w.shared())
    expect(doors.getByTestId('open-link-device').textContent).toContain(w.device())
    expect(screen.queryByTestId('open-folder')).toBeNull()
    expect(screen.queryByTestId('manager-name')).toBeNull()
    expect(screen.queryByLabelText(t.your_name())).toBeNull()
    // The help and settings controls are named icon buttons.
    expect(screen.getByRole('button', { name: t.help() })).toBeTruthy()
    expect(screen.getByRole('button', { name: t.settings() })).toBeTruthy()
  })

  it('on the desktop the first door opens a folder, with the saved name passed through', async () => {
    const { props, user } = setup({ isTauri: true })
    const door = screen.getByTestId('open-folder')
    expect(door.textContent).toContain(w.folder_hint())
    await user.click(door)
    expect(props.onOpenFolder).toHaveBeenCalledWith('Chris')
    expect(screen.queryByTestId('start-browser-vault')).toBeNull()
  })

  it('on a phone (the Tauri app, mobile) the browser door says "this phone", and there is no folder door', async () => {
    // App passes isTauri={isDesktop()}: false on a phone.
    const { props, user } = setup({ isTauri: false, isMobile: true, defaultUser: '' })
    expect(screen.queryByTestId('open-folder')).toBeNull()
    const door = screen.getByTestId('start-browser-vault')
    expect(door.textContent).toContain(w.phone())
    expect(door.textContent).toContain(w.phone_hint())
    expect(door.textContent).not.toContain(w.browser())
    await user.click(door)
    await user.type(screen.getByTestId('new-vault-name'), 'Pocket')
    await user.click(screen.getByTestId('create-vault'))
    expect(props.onCreateBrowserVault).toHaveBeenCalledWith('', 'Pocket')
    // Joining and linking a device stay, as in a browser.
    expect(screen.getByTestId('join-share')).toBeTruthy()
    expect(screen.getByTestId('open-link-device')).toBeTruthy()
  })

  it('the browser door asks for the vault\'s name in the row, then creates it', async () => {
    const { props, user } = setup({ defaultUser: '' })
    expect(screen.queryByTestId('new-vault-name')).toBeNull()
    await user.click(screen.getByTestId('start-browser-vault'))
    expect(screen.getByTestId('start-browser-vault').getAttribute('aria-expanded')).toBe('true')
    const field = screen.getByTestId('new-vault-name')
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect((screen.getByTestId('create-vault') as HTMLButtonElement).disabled).toBe(true)
    await user.type(field, ' Team ')
    await user.click(screen.getByTestId('create-vault'))
    // No name saved: none is invented either.
    expect(props.onCreateBrowserVault).toHaveBeenCalledWith('', 'Team')
  })

  it('the other two doors run the same flows as before', async () => {
    const { props, user } = setup()
    await user.click(screen.getByTestId('open-link-device'))
    expect(props.onLinkDevice).toHaveBeenCalledWith('Chris')
    await user.click(screen.getByTestId('join-share'))
    expect(await screen.findByTestId('add-share-dialog')).toBeTruthy()
  })

  it('the storage note becomes a link inside the browser door', async () => {
    const { props, user } = setup({ storageNote: { canAsk: true, outcome: null } })
    const note = screen.getByTestId('storage-note')
    await user.click(within(note).getByTestId('storage-keep'))
    expect(props.onKeepStorage).toHaveBeenCalled()
    expect(screen.queryByText(LL.web.storage.title())).toBeNull()
  })

  it('a browser without OPFS says so instead of offering doors it cannot keep', () => {
    setup({ hasOpfs: false })
    expect(screen.getByRole('alert').textContent).toContain(t.no_opfs())
    expect(screen.queryByTestId('start-browser-vault')).toBeNull()
    expect(screen.queryByTestId('join-share')).toBeNull()
  })

  it('the foot opens the Import dialog and links the two-minute guide', async () => {
    const { user } = setup()
    const guide = screen.getByRole('link', { name: w.guide() })
    expect(guide.getAttribute('href')).toBe(guideHref('start'))
    expect(guide.getAttribute('target')).toBe('_blank')
    expect(guide.getAttribute('rel')).toBe('noreferrer')
    await user.click(screen.getByRole('button', { name: w.import_link() }))
    expect(screen.getByRole('dialog', { name: LL.web.import_app.title() })).toBeTruthy()
  })

  it('a ?share= link opens the Add dialog on it, whose relay check is the one handed in', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: 'a'.repeat(64) })
    setup({ prefillLink: link })
    expect(await screen.findByTestId('add-share-dialog')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('add-share-probe').getAttribute('data-check')).toBe('ok'))
    expect(probe).toHaveBeenCalledWith('wss://relay.example', expect.any(AbortSignal))
  })

  it('"as its own vault" joins under the name TYPED in the dialog, not the saved one', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: 'a'.repeat(64) })
    const { props, user } = setup({ prefillLink: link })
    const nameField = await screen.findByTestId('add-share-name')
    await user.clear(nameField)
    await user.type(nameField, 'Sam')
    await user.click(screen.getByTestId('add-share-join'))
    await waitFor(() => expect(props.onJoin).toHaveBeenCalledWith('Sam', link))
    await waitFor(() => expect(screen.queryByTestId('add-share-dialog')).toBeNull())
  })

  it('a cancelled folder picker keeps the dialog open with the paste; a failure says why', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: 'a'.repeat(64) })
    const onJoin = vi.fn(async () => ({ kind: 'cancelled' }) as const)
    const { user } = setup({ isTauri: true, prefillLink: link, onJoin })
    await user.click(await screen.findByTestId('add-share-join'))
    await waitFor(() => expect(onJoin).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByTestId('add-share-join') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByTestId('add-share-dialog')).toBeTruthy()
    expect((screen.getByTestId('add-share-link') as HTMLTextAreaElement).value).toBe(link)
    expect(screen.queryByTestId('add-share-error')).toBeNull()

    onJoin.mockImplementation(async () => ({ kind: 'failed', message: 'relay rejected the token' }) as never)
    await user.click(screen.getByTestId('add-share-join'))
    expect((await screen.findByTestId('add-share-error')).textContent).toContain('relay rejected the token')
    expect(screen.getByTestId('add-share-dialog')).toBeTruthy()
  })

  it('the help icon opens the Help menu, whose Report a problem is reachable from here', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: t.help() }))
    const menu = within(await screen.findByTestId('manager-help-list'))
    expect(menu.getByTestId('help:start')).toBeTruthy()
    await user.click(menu.getByTestId('help:report'))
    expect(help.reportOpen).toBe(true)
  })

  it('on the desktop the guide link opens through openGuide, not a new tab that goes nowhere', async () => {
    setup({ isTauri: true })
    // fireEvent returns false when the default (the anchor's new tab) was prevented.
    expect(await fireEvent.click(screen.getByTestId('manager-guide'))).toBe(false)
    expect(openGuide).toHaveBeenCalledExactlyOnceWith('start')
  })

  it('a boot failure with no vault to pin it on is shown above the doors', () => {
    setup({ failure: { room: null, message: 'relay rejected the token' } })
    expect(screen.getByTestId('manager-error').textContent).toContain('relay rejected the token')
  })
})

describe('the list (vaults registered)', () => {
  it('a row says what the vault is: kind, where, when opened, what its mount table shares', () => {
    const { props } = setup({
      vaults: [disk, browser],
      facts: { 'room-disk': { sharedByYou: 2, sharedWithYou: 1 }, 'room-web': null },
    })
    // The list is branded by the wordmark above its heading.
    expect(screen.getByRole('img', { name: LL.common.app_name() })).toBe(screen.getByTestId('manager-wordmark'))
    expect(screen.getByRole('heading', { level: 1, name: l.title() })).toBeTruthy()
    const row = screen.getByTestId('open-vault:room-disk')
    expect(row.textContent).toContain('/home/chris/Notes')
    expect(row.textContent).toContain(l.opened_today())
    const facts = screen.getByTestId('vault-facts:room-disk')
    expect(facts.textContent).toContain(l.shared_by_you({ count: 2 }))
    expect(facts.textContent).toContain(l.shared_with_you({ count: 1 }))
    expect(screen.getByTestId('open-vault:room-web').textContent).toContain(l.in_browser())
    // Unreadable is "—", never "nothing shared".
    expect(within(screen.getByTestId('vault-facts:room-web')).getByRole('img', { name: l.facts_unknown() })).toBeTruthy()
    expect(props.onLoadFacts).toHaveBeenCalled()
  })

  it('on a phone a browser vault\'s row says "on this phone", and Add offers a new vault there', async () => {
    const { user } = setup({ vaults: [browser], isMobile: true })
    expect(screen.getByTestId('open-vault:room-web').textContent).toContain(l.in_phone())
    await user.click(screen.getByTestId('manager-add'))
    expect((await screen.findByTestId('add-browser-vault')).textContent).toContain(l.add_phone())
    expect(screen.queryByTestId('open-folder')).toBeNull()
  })

  it('an empty table says nothing shared; the vault open behind is marked, with its live facts', () => {
    setup({
      vaults: [disk, browser],
      canGoBack: true,
      currentRoom: 'room-web',
      facts: { 'room-disk': { sharedByYou: 0, sharedWithYou: 0 } },
      openFacts: { sharedByYou: 0, sharedWithYou: 3 },
    })
    expect(screen.getByTestId('vault-facts:room-disk').textContent).toContain(l.nothing_shared())
    expect(screen.getByTestId('open-vault:room-web').getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('open-now:room-web').textContent).toBe(l.open_now())
    expect(screen.getByTestId('vault-facts:room-web').textContent).toContain(l.shared_with_you({ count: 3 }))
    expect(screen.getByTestId('manager-back').textContent).toContain(t.back())
  })

  it('one Add menu holds the doors and Import; the browser entry names the vault in a dialog', async () => {
    const { props, user } = setup({ vaults: [disk] })
    await user.click(screen.getByTestId('manager-add'))
    const menu = within(screen.getByTestId('manager-add-menu'))
    expect(menu.getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual([
      l.add_browser(),
      l.add_shared(),
      l.add_device(),
      l.add_import(),
    ])
    await user.click(menu.getByTestId('add-browser-vault'))
    await user.type(await screen.findByTestId('new-vault-name'), 'Team')
    await user.click(screen.getByTestId('create-vault'))
    expect(props.onCreateBrowserVault).toHaveBeenCalledWith('Chris', 'Team')
  })

  it('on the desktop the Add menu opens a folder', async () => {
    const { props, user } = setup({ isTauri: true, vaults: [disk] })
    await user.click(screen.getByTestId('manager-add'))
    await user.click(screen.getByTestId('open-folder'))
    expect(props.onOpenFolder).toHaveBeenCalledWith('Chris')
  })

  it('Import from another app… opens the Import dialog', async () => {
    const { user } = setup({ vaults: [disk] })
    await user.click(screen.getByTestId('manager-add'))
    await user.click(screen.getByTestId('open-import'))
    expect(screen.getByTestId('import-dialog')).toBeTruthy()
  })

  it('the row menu renames the entry in this list only', async () => {
    const { props, user } = setup({ vaults: [disk] })
    await user.click(screen.getByTestId('vault-more:room-disk'))
    await user.click(screen.getByTestId('rename-vault:room-disk'))
    const dialog = screen.getByRole('dialog', { name: l.rename_title({ name: 'Notes' }) })
    expect(dialog.textContent).toContain(l.rename_hint())
    const input = within(dialog).getByTestId('rename-vault-input')
    await user.clear(input)
    await user.type(input, 'Work')
    await user.click(within(dialog).getByTestId('rename-vault-save'))
    expect(props.onRenameVault).toHaveBeenCalledWith('room-disk', 'Work')
  })

  it('Remove is two steps, with what it costs said first', async () => {
    const { props, user } = setup({ vaults: [disk, browser] })
    await user.click(screen.getByTestId('vault-more:room-web'))
    await user.click(screen.getByTestId('remove-vault:room-web'))
    expect(screen.getByTestId('remove-note:room-web').textContent).toBe(t.remove_note_opfs())
    await user.click(screen.getByTestId('remove-cancel:room-web'))
    expect(screen.queryByTestId('remove-note:room-web')).toBeNull()

    await user.click(screen.getByTestId('vault-more:room-disk'))
    await user.click(screen.getByTestId('remove-vault:room-disk'))
    expect(screen.getByTestId('remove-note:room-disk').textContent).toBe(t.remove_note_disk())
    await user.click(screen.getByTestId('remove-confirm:room-disk'))
    expect(props.onRemoveVault).toHaveBeenCalledWith('room-disk')
  })

  it('the list has the Help menu too, so a failed row can be reported', async () => {
    const { user } = setup({ vaults: [disk], failure: { room: 'room-disk', message: 'folder moved' } })
    await user.click(screen.getByTestId('manager-help'))
    await user.click(await screen.findByTestId('help:report'))
    expect(help.reportOpen).toBe(true)
  })

  it('a row that cannot open says why, with Try again and Remove', async () => {
    const { props, user } = setup({ vaults: [disk], failure: { room: 'room-disk', message: 'folder moved' } })
    expect(screen.getByTestId('vault-error:room-disk').textContent).toBe(t.vault_error({ message: 'folder moved' }))
    await user.click(screen.getByTestId('retry-vault:room-disk'))
    expect(props.onOpenVault).toHaveBeenCalledWith(disk)
    await user.click(screen.getByTestId('remove-failed:room-disk'))
    expect(screen.getByTestId('remove-note:room-disk')).toBeTruthy()
  })

  it('a row the fs scope refuses offers Allow access again instead of Try again (DEL-89)', async () => {
    const { props, user } = setup({
      vaults: [disk],
      failure: { room: 'room-disk', message: 'needs permission', access: true },
    })
    expect(screen.getByTestId('vault-error:room-disk').textContent).toBe('needs permission')
    expect(screen.queryByTestId('retry-vault:room-disk')).toBeNull()
    await user.click(screen.getByTestId('allow-access:room-disk'))
    expect(props.onAllowAccess).toHaveBeenCalledWith('room-disk')
    expect(screen.getByTestId('remove-failed:room-disk')).toBeTruthy()
  })

  it('the foot says who people see you as, and Change opens Settings', async () => {
    const { props, user } = setup({ vaults: [disk], defaultUser: '' })
    expect(screen.getByTestId('manager-identity').textContent).toContain(l.identity({ name: t.anonymous() }))
    await user.click(screen.getByTestId('manager-identity-change'))
    expect(props.onSettings).toHaveBeenCalled()
    expect(screen.queryByTestId('manager-remembered')).toBeNull()
  })

  it('remembered links sit behind the foot, and one re-joins as before', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'shared-r', token: 'a'.repeat(64) })
    const { props, user } = setup({ vaults: [disk], shares: [{ link, room: 'shared-r', label: 'Team notes' }] })
    const trigger = screen.getByTestId('manager-remembered')
    expect(trigger.textContent).toContain(l.remembered({ count: 1 }))
    await user.click(trigger)
    const popover = screen.getByRole('dialog', { name: l.remembered_title() })
    await user.click(within(popover).getByRole('button', { name: 'Team notes' }))
    expect(props.onJoin).toHaveBeenCalledWith('Chris', link)
  })

  it('a remembered link can be forgotten here (Settings no longer lists them)', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'shared-r', token: 'a'.repeat(64) })
    const onForgetShare = vi.fn()
    const { user } = setup({ vaults: [disk], shares: [{ link, room: 'shared-r', label: 'Team notes' }], onForgetShare })
    await user.click(screen.getByTestId('manager-remembered'))
    await user.click(screen.getByRole('button', { name: l.forget_share({ label: 'Team notes' }) }))
    expect(onForgetShare).toHaveBeenCalledWith('shared-r')
  })

  it('a ?share= link opens the Add dialog from the list too', async () => {
    const link = encodeShareLink({ relay: 'wss://relay.example', room: 'r', token: 'a'.repeat(64) })
    setup({ vaults: [disk], prefillLink: link })
    expect(await screen.findByTestId('add-share-dialog')).toBeTruthy()
  })
})

describe('the welcome’s agent door (settings-shaping ST6)', () => {
  it('on the desktop, Connect an agent opens Settings › AI, where Outside agents lives (it works with no vault)', async () => {
    const { props, user } = setup({ isTauri: true })
    await user.click(screen.getByTestId('manager-agents'))
    expect(props.onSettings).toHaveBeenCalledExactlyOnceWith('ai')
  })

  it('in a browser it is not drawn: no agent reaches a vault kept in the browser', () => {
    setup()
    expect(screen.queryByTestId('manager-agents')).toBeNull()
  })
})
