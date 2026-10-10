// @vitest-environment jsdom
/**
 * The Import door (first-run F1): three routes, each sentence true today —
 * the desktop opens a folder in place, the browser says it cannot, and the
 * two export routes point at the import guide.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { guideHref } from '../guide.js'
import ImportDialog from './ImportDialog.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const t = getLL().web.import_app

function open(isTauri: boolean) {
  const props = { isTauri, onOpenFolder: vi.fn(), onClose: vi.fn() }
  render(ImportDialog, props)
  return { props, user: userEvent.setup() }
}

describe('ImportDialog', () => {
  it('names the three routes and what stays where it is', () => {
    open(true)
    const dialog = screen.getByRole('dialog', { name: t.title() })
    expect(within(dialog).getByRole('heading', { name: t.obsidian() })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: t.notion() })).toBeTruthy()
    expect(within(dialog).getByRole('heading', { name: t.other() })).toBeTruthy()
    expect(dialog.textContent).toContain(t.obsidian_body())
    expect(dialog.textContent).toContain(t.notion_body())
    expect(dialog.textContent).toContain(t.other_body())
    expect(screen.getByTestId('import-foot').textContent).toBe(t.foot())
  })

  it('on the desktop, Obsidian opens a folder through the same path as the welcome', async () => {
    const { props, user } = open(true)
    await user.click(screen.getByRole('button', { name: t.open_folder() }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onOpenFolder).toHaveBeenCalled()
  })

  it('in a browser, Obsidian says a folder cannot be opened here and points at the desktop app', () => {
    open(false)
    expect(screen.queryByRole('button', { name: t.open_folder() })).toBeNull()
    expect(screen.getByTestId('import-obsidian-browser').textContent).toBe(t.obsidian_browser())
  })

  it('the export routes link the import guide in a new tab', () => {
    open(false)
    const links = screen.getAllByRole('link', { name: t.guide() })
    expect(links).toHaveLength(2)
    for (const a of links) {
      expect(a.getAttribute('href')).toBe(guideHref('import'))
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noreferrer')
    }
  })

  it('closes on its own close button', async () => {
    const { props, user } = open(false)
    await user.click(screen.getByTestId('import-close'))
    expect(props.onClose).toHaveBeenCalled()
  })
})
