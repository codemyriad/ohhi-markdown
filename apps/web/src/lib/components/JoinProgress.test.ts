// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import type { PullProgress } from '../workspace.svelte.js'
import JoinProgress from './JoinProgress.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const LL = getLL()
const t = LL.web.device_link
const DEST = '/home/chris/vault'

function open(progress: PullProgress | null, error: string | null = null, kind?: 'device' | 'folder') {
  const onRetry = vi.fn()
  const onCancel = vi.fn()
  render(JoinProgress, {
    ...(kind ? { kind } : {}),
    vaultName: kind === 'folder' ? 'Team notes' : 'Chris’s vault',
    destination: DEST,
    progress,
    error,
    onRetry,
    onCancel,
  })
  return { onRetry, onCancel }
}

describe('JoinProgress', () => {
  it('says where the vault is going before the relay has answered', () => {
    open(null)

    expect(screen.getByRole('heading', { name: t.panel_title() })).toBeInTheDocument()
    expect(screen.getByTestId('join-destination')).toHaveTextContent(DEST)
    expect(screen.getByTestId('join-phase')).toHaveTextContent(t.starting())
    // Determinate from the start: an unknown denominator is 0%, never a full bar.
    expect(screen.getByRole('progressbar', { name: t.progress_label() })).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
    // No counts until there is a denominator to count against.
    expect(screen.queryByTestId('join-counts')).toBeNull()
  })

  it('counts the pull against the map’s denominator', () => {
    open({ phase: 'pull', done: 250, total: 1000 })

    expect(screen.getByTestId('join-phase')).toHaveTextContent(t.phase_pull({ total: 1000 }))
    expect(screen.getByTestId('join-counts')).toHaveTextContent(t.counts({ done: 250, total: 1000 }))
    expect(screen.getByRole('progressbar', { name: t.progress_label() })).toHaveAttribute(
      'aria-valuenow',
      '25'
    )
  })

  it('names the destination in the WRITE phase — the 92% nothing used to report', () => {
    open({ phase: 'write', done: 900, total: 1000 })

    expect(screen.getByTestId('join-phase')).toHaveTextContent(t.phase_write({ dest: DEST }))
    expect(screen.getByTestId('join-bar')).toHaveAttribute('data-phase', 'write')
    expect(screen.getByTestId('join-counts')).toHaveTextContent(t.counts({ done: 900, total: 1000 }))
  })

  it('states plainly that images and PDFs will not arrive (decision 6)', () => {
    open({ phase: 'pull', done: 0, total: 3 })
    expect(screen.getByTestId('join-attachments')).toHaveTextContent(t.attachments())
  })

  it('renders a stall as an error with a retry, and no progress bar to stare at', async () => {
    const user = userEvent.setup()
    const { onRetry, onCancel } = open({ phase: 'pull', done: 2, total: 1000 }, 'relay stalled')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(t.failed())
    expect(alert).toHaveTextContent('relay stalled')
    expect(screen.queryByRole('progressbar')).toBeNull()

    await user.click(screen.getByRole('button', { name: t.retry() }))
    expect(onRetry).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: LL.common.cancel() }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('a device link is "Linking this device", the vault named on a Vault row (the default kind)', () => {
    open(null, null, 'device')
    expect(screen.getByRole('heading', { name: t.panel_title() })).toBeInTheDocument()
    expect(screen.getByText(t.panel_vault())).toBeInTheDocument()
    expect(screen.queryByText(LL.web.share.add.panel_folder())).toBeNull()
    expect(screen.getByTestId('join-attachments')).toHaveTextContent(t.attachments())
  })

  it('a folder share opened as its own vault is "Adding <folder>", on a Folder row (first-run F1)', () => {
    const f = LL.web.share.add
    open({ phase: 'pull', done: 1, total: 4 }, null, 'folder')
    expect(screen.getByRole('heading', { name: f.panel_title({ name: 'Team notes' }) })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t.panel_title() })).toBeNull()
    expect(screen.getByText(f.panel_folder())).toBeInTheDocument()
    expect(screen.queryByText(t.panel_vault())).toBeNull()
    expect(screen.getByTestId('join-destination')).toHaveTextContent(DEST)
    // The attachments note is true of a folder too.
    expect(screen.getByTestId('join-attachments')).toHaveTextContent(t.attachments())
  })

  it('a folder join that fails says adding failed, not linking', () => {
    open({ phase: 'pull', done: 1, total: 4 }, 'relay stalled', 'folder')
    expect(screen.getByRole('alert')).toHaveTextContent(LL.web.share.add.panel_failed())
    expect(screen.getByRole('alert')).not.toHaveTextContent(t.failed())
  })

  it('offers no retry while it is still working', () => {
    open({ phase: 'pull', done: 2, total: 1000 })
    expect(screen.queryByRole('button', { name: t.retry() })).toBeNull()
  })
})
