// @vitest-environment jsdom
/**
 * Settings › Appearance's picker (Chris, 2026-10-15): two groups — Built in
 * (System and the designed built-ins) and In this vault (every theme folder
 * the vault holds, by name, the one in use pressed) — with the typed-name
 * field kept under the vault group as a fallback.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { BUILTIN_THEMES } from '@ohhi/ui/tokens'
import { settingsEnvContext, type SettingsEnv } from '../settings-host.js'
import { applyTheme, restoreVaultTheme, themeState } from '../theme.svelte.js'
import { THEME_EXAMPLES } from '../theme-examples.js'
import AppearanceSettings from './AppearanceSettings.svelte'

const t = getLL().web.settings.appearance

function env(vaultOpen: boolean): SettingsEnv {
  return {
    vaultOpen,
    vault: vaultOpen ? { name: 'black book', kind: 'opfs' } : null,
    desktop: false,
    host: 'view',
    openSection: vi.fn(),
  }
}

const THEMES = [
  { name: 'nord-dark', path: '.ohhi/themes/nord-dark/theme.css' },
  { name: 'paper', path: '.ohhi/themes/paper/theme.css' },
]
const files: Record<string, string> = {
  '.ohhi/themes/nord-dark/theme.css': '[data-theme="nord-dark"] { color-scheme: dark; --ed-surface: #2e3440; }',
  '.ohhi/themes/paper/theme.css': '[data-theme="paper"] { color-scheme: light; }',
}
const readAppFile = async (path: string): Promise<string | null> => files[path] ?? null

beforeEach(() => {
  localStorage.clear()
  applyTheme('system')
})
afterEach(() => {
  cleanup()
  document.getElementById('ed-user-theme')?.remove()
})

describe('Settings › Appearance — Built in and In this vault', () => {
  it('draws two groups with eyebrows: System and every built-in, then the vault’s theme folders by name', () => {
    render(AppearanceSettings, { props: { readAppFile, themes: THEMES }, context: settingsEnvContext(env(true)) })
    const builtin = screen.getByRole('group', { name: t.builtin() })
    expect(within(builtin).getAllByRole('button').map((b) => b.dataset.testid)).toEqual([
      'theme-system',
      ...BUILTIN_THEMES.map((th) => `theme-${th}`),
    ])
    const vault = screen.getByRole('group', { name: t.in_vault() })
    expect(within(screen.getByTestId('theme-vault-list')).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      'nord-dark',
      'paper',
    ])
    // The fallback field lives under the vault group.
    expect(within(vault).getByLabelText(t.custom_label())).toBeVisible()
  })

  it('picking a vault theme reads its file and applies it at once; the one in use is pressed', async () => {
    const user = userEvent.setup()
    render(AppearanceSettings, { props: { readAppFile, themes: THEMES }, context: settingsEnvContext(env(true)) })
    const nord = screen.getByTestId('theme-custom:nord-dark')
    expect(nord).toHaveAttribute('aria-pressed', 'false')
    await user.click(nord)
    expect(themeState.pref).toBe('custom:nord-dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord-dark')
    expect(document.getElementById('ed-user-theme')?.textContent).toContain('#2e3440')
    expect(nord).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'false')
    // The source line names the folder, from this vault.
    expect(screen.getByTestId('theme-source-name')).toHaveTextContent('nord-dark')

    // Back to a built-in: the vault theme is no longer pressed.
    await user.click(screen.getByTestId('theme-editor-dark'))
    expect(nord).toHaveAttribute('aria-pressed', 'false')
  })

  it('says so when the vault has no theme folders, and when no vault is open', () => {
    render(AppearanceSettings, { props: { readAppFile, themes: [] }, context: settingsEnvContext(env(true)) })
    expect(screen.getByTestId('theme-vault-empty')).toHaveTextContent('.ohhi/themes/<name>/theme.css')
    expect(screen.queryByTestId('theme-vault-list')).toBeNull()
    cleanup()

    render(AppearanceSettings, { props: {}, context: settingsEnvContext(env(false)) })
    expect(screen.getByTestId('theme-vault-none')).toHaveTextContent(t.vault_none())
    expect(screen.queryByTestId('custom-theme-name')).toBeNull()
  })

  it('the typed name still reaches a folder the list does not show, and says why it cannot', async () => {
    const user = userEvent.setup()
    render(AppearanceSettings, { props: { readAppFile, themes: [] }, context: settingsEnvContext(env(true)) })
    await user.type(screen.getByTestId('custom-theme-name'), 'paper')
    await user.click(screen.getByTestId('custom-theme-load'))
    expect(themeState.pref).toBe('custom:paper')
    await user.clear(screen.getByTestId('custom-theme-name'))
    await user.type(screen.getByTestId('custom-theme-name'), 'gone')
    await user.click(screen.getByTestId('custom-theme-load'))
    expect(screen.getByTestId('custom-theme-error')).toHaveTextContent('.ohhi/themes/gone/theme.css')
  })
})

describe('Settings › Appearance — the example themes (Nord out of the built-ins, Fork 4-A)', () => {
  it('lists no Nord among the built-ins', () => {
    render(AppearanceSettings, { props: { readAppFile, themes: [] }, context: settingsEnvContext(env(true)) })
    expect(screen.queryByTestId('theme-nord-dark')).toBeNull()
    expect(screen.queryByTestId('theme-nord-light')).toBeNull()
  })

  it('offers each example the vault lacks; Add writes the bundled file through the app-file writer', async () => {
    const user = userEvent.setup()
    const disk: Record<string, string> = {}
    const writeAppFile = vi.fn(async (path: string, text: string) => void (disk[path] = text))
    const read = async (path: string) => disk[path] ?? null
    render(AppearanceSettings, {
      props: { readAppFile: read, writeAppFile, themes: [THEMES[1]!] },
      context: settingsEnvContext(env(true)),
    })
    expect(screen.getByTestId('theme-example:nord-light')).toBeVisible()
    await user.click(screen.getByTestId('theme-example-add:nord-dark'))
    expect(writeAppFile).toHaveBeenCalledWith('.ohhi/themes/nord-dark/theme.css', THEME_EXAMPLES['nord-dark'])
    expect(screen.getByTestId('theme-example-status')).toHaveTextContent('Added .ohhi/themes/nord-dark/theme.css')
    // Not the preference: added, listed once the loader re-lists, not applied.
    expect(themeState.pref).toBe('system')

    // A file already there is someone's: never written over.
    await user.click(screen.getByTestId('theme-example-add:nord-dark'))
    expect(writeAppFile).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('theme-example-error')).toHaveTextContent('already has .ohhi/themes/nord-dark/theme.css')
  })

  it('a stored nord-dark: the vault without the folder shows Oh hi Dark standing in; Add applies Nord Dark at once', async () => {
    const user = userEvent.setup()
    const disk: Record<string, string> = {}
    const read = async (path: string) => disk[path] ?? null
    const writeAppFile = vi.fn(async (path: string, text: string) => void (disk[path] = text))
    themeState.pref = 'custom:nord-dark'
    expect(await restoreVaultTheme(read)).toBe('missing')
    expect(themeState.fellBackFrom).toBe('nord-dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('editor-dark')
    expect(document.documentElement.getAttribute('data-polarity')).toBe('dark')

    render(AppearanceSettings, { props: { readAppFile: read, writeAppFile, themes: [] }, context: settingsEnvContext(env(true)) })
    expect(screen.getByTestId('theme-source-name')).toHaveTextContent('Oh hi Dark')
    expect(screen.getByTestId('theme-source-fallback')).toHaveTextContent('nord-dark')
    await user.click(screen.getByTestId('theme-example-add:nord-dark'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('nord-dark')
    expect(themeState.pref).toBe('custom:nord-dark')
    expect(themeState.fellBackFrom).toBeNull()
    expect(screen.queryByTestId('theme-source-fallback')).toBeNull()
    // A later vault open finds it and installs it again.
    document.getElementById('ed-user-theme')?.remove()
    expect(await restoreVaultTheme(read)).toBe('installed')
    expect(document.getElementById('ed-user-theme')?.textContent).toContain('#2e3440')
  })
})
