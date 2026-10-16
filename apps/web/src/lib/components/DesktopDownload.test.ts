// @vitest-environment jsdom
/**
 * *Get the desktop app* as drawn: Settings › About's section (the file for
 * this computer, its install sentence, the others; loading and failure said)
 * and the storage note's one quiet line.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { getLL } from '@ohhi/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopDownloads } from '../downloads.svelte.js'
import DesktopDownload from './DesktopDownload.svelte'

afterEach(cleanup)

const LL = getLL()
const t = LL.web.downloads
const URL_ = 'https://dist.ohhi.md/stable/downloads.json'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0'
const MANIFEST = {
  schema: 1,
  version: '0.1.42',
  date: '2026-10-16T10:00:00Z',
  files: [
    { os: 'macos', kind: 'dmg', arch: 'universal', name: 'ohhi_0.1.42_universal.dmg', url: 'https://dist.ohhi.md/0.1.42/ohhi_0.1.42_universal.dmg', size: 30_000_000, sha256: '' },
    { os: 'linux', kind: 'appimage', arch: 'x86_64', name: 'ohhi_0.1.42_amd64.AppImage', url: 'https://dist.ohhi.md/0.1.42/ohhi_0.1.42_amd64.AppImage', size: 0, sha256: '' },
  ],
}

function downloads(opts: { ua?: string; desktop?: boolean; url?: string; fetch?: typeof fetch } = {}) {
  return createDesktopDownloads({
    url: opts.url ?? URL_,
    desktop: () => opts.desktop ?? false,
    fetch: opts.fetch ?? (vi.fn(async () => new Response(JSON.stringify(MANIFEST))) as unknown as typeof fetch),
    navigator: () => ({ userAgent: opts.ua ?? MAC }),
  })
}

describe('DesktopDownload — section (Settings › About)', () => {
  it('offers this computer’s file first, with its size, release and install sentence, then the others', async () => {
    render(DesktopDownload, { downloads: downloads() })
    expect(screen.getByRole('heading', { name: t.heading() })).toBeVisible()
    expect(screen.getByTestId('desktop-download-status')).toHaveTextContent(t.loading())
    const link = await screen.findByTestId('desktop-download-primary')
    expect(link).toHaveAccessibleName(t.for_os({ os: 'macOS' }))
    expect(link).toHaveAttribute('href', MANIFEST.files[0]!.url)
    expect(screen.getByTestId('desktop-download-meta')).toHaveTextContent(/ohhi_0\.1\.42_universal\.dmg · 30 MB · version 0\.1\.42/)
    expect(screen.getByTestId('desktop-download-install')).toHaveTextContent(t.install.dmg())
    const others = screen.getByTestId('desktop-download-others')
    expect(others).toHaveTextContent(t.kind.appimage())
    // No size in the manifest → none shown.
    expect(others).toHaveTextContent(t.meta_unsized({ name: 'ohhi_0.1.42_amd64.AppImage', version: '0.1.42' }))
  })

  it('a system with no build says so and lists them all', async () => {
    render(DesktopDownload, { downloads: downloads({ ua: WIN }) })
    expect(await screen.findByTestId('desktop-download-none')).toHaveTextContent(t.none_for_os())
    expect(screen.queryByTestId('desktop-download-primary')).toBeNull()
    expect(screen.getByTestId('desktop-download-others').querySelectorAll('li')).toHaveLength(2)
  })

  it('a list that does not load is said, with a retry and the guide', async () => {
    const failing = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch
    render(DesktopDownload, { downloads: downloads({ fetch: failing }) })
    await waitFor(() => expect(screen.getByTestId('desktop-download-status')).toHaveAttribute('data-state', 'failed'))
    expect(screen.getByTestId('desktop-download-status')).toHaveTextContent(t.failed())
    expect(screen.getByTestId('desktop-download-retry')).toBeVisible()
  })

  it('nothing at all in the desktop app or without a list', () => {
    const { container } = render(DesktopDownload, { downloads: downloads({ desktop: true }) })
    expect(container.textContent?.trim()).toBe('')
    const other = render(DesktopDownload, { downloads: downloads({ url: '' }) })
    expect(other.container.textContent?.trim()).toBe('')
  })
})

describe('DesktopDownload — line (the browser-storage note)', () => {
  it('one link for this computer once the list is in; nothing before, on failure or for a system with no build', async () => {
    render(DesktopDownload, { variant: 'line', downloads: downloads() })
    const link = await screen.findByTestId('desktop-download-line')
    expect(link).toHaveTextContent(t.note_link({ os: 'macOS' }))
    expect(link).toHaveAttribute('href', MANIFEST.files[0]!.url)
  })

  it('stays quiet for Windows', async () => {
    const d = downloads({ ua: WIN })
    const { container } = render(DesktopDownload, { variant: 'line', downloads: d })
    await waitFor(() => expect(d.status).toBe('ready'))
    expect(container.textContent?.trim()).toBe('')
  })
})
