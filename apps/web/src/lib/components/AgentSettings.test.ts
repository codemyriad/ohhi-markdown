// @vitest-environment jsdom
/**
 * Settings › Agents (settings-shaping ST5) in its three places: a folder
 * vault on the desktop (the routes filled in with its path, copyable), a
 * vault in browser storage (Fork 5: shown, with the honest explanation and
 * the way to Sync & devices), and no vault (the manager's page: the routes
 * with a placeholder path, never the needs-vault notice).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { AGENT_CAPABILITIES, GET_REPO, PLACEHOLDER_VAULT_PATH } from '../agent-setup.js'
import { settingsEnvContext, type SettingsEnv, type SettingsVault } from '../settings-host.js'
import AgentSettings from './AgentSettings.svelte'

afterEach(() => cleanup())

const t = getLL().web.settings.agents

function setup(
  opts: { vault?: SettingsVault | null; desktop?: boolean; host?: 'view' | 'page'; openGuide?: (page: string) => void } = {}
) {
  const vault = opts.vault ?? null
  const env: SettingsEnv = {
    vaultOpen: vault !== null,
    vault,
    desktop: opts.desktop ?? false,
    host: opts.host ?? 'view',
    openSection: vi.fn(),
  }
  const writeClipboard = vi.fn(async (_text: string) => {})
  render(AgentSettings, {
    props: { writeClipboard, ...(opts.openGuide ? { openGuide: opts.openGuide } : {}) },
    context: settingsEnvContext(env),
  })
  return { env, writeClipboard, user: userEvent.setup() }
}

const codeOf = (id: string): string => screen.getByTestId(`agents-code:${id}`).textContent ?? ''

describe('Settings › Agents', () => {
  it('lists what an agent can do, one line per op group', () => {
    setup({ vault: { name: 'notes', kind: 'tauri', path: '/home/me/notes' }, desktop: true })
    const list = screen.getByTestId('agents-can-do')
    expect(list.querySelectorAll('li')).toHaveLength(AGENT_CAPABILITIES.length)
    expect(list.textContent).toContain(t.cap.find())
    expect(list.textContent).toContain('backlinks')
  })

  it('on the desktop, fills every route with the vault’s path and copies it', async () => {
    const { user, writeClipboard } = setup({
      vault: { name: 'black book', kind: 'tauri', path: '/home/me/black book' },
      desktop: true,
    })
    expect(screen.queryByTestId('agents-unreachable')).toBeNull()
    expect(screen.queryByTestId('agents-placeholder')).toBeNull()

    // Claude Code (the default route): the scripts, the skill line, the MCP line.
    expect(codeOf('install-ohhi')).toBe('./scripts/install-ohhi.sh')
    expect(codeOf('install-skill')).toBe('./scripts/install-skill.sh')
    expect(codeOf('claude-skill')).toBe('OHHI_VAULT="/home/me/black book" claude')
    expect(codeOf('claude-mcp')).toBe('claude mcp add ohhi -- ohhi mcp --vault "/home/me/black book"')

    await user.click(screen.getByTestId('agents-copy:claude-mcp'))
    expect(writeClipboard).toHaveBeenCalledWith('claude mcp add ohhi -- ohhi mcp --vault "/home/me/black book"')
    await waitFor(() => expect(screen.getByTestId('agents-copy:claude-mcp').textContent?.trim()).toBe(t.copied()))

    // Another MCP client: valid JSON naming the path.
    await user.click(screen.getByTestId('agents-route:mcp'))
    expect(JSON.parse(codeOf('mcp-json')).mcpServers.ohhi.args).toEqual(['mcp', '--vault', '/home/me/black book'])

    // The terminal.
    await user.click(screen.getByTestId('agents-route:terminal'))
    expect(codeOf('terminal')).toContain('ohhi stats --vault "/home/me/black book"')
  })

  it('starts every route with the private repository and its dependencies; MCP is Claude Code’s unnumbered alternative', async () => {
    const { user } = setup({ vault: { name: 'n', kind: 'tauri', path: '/n' }, desktop: true })
    expect(screen.getByTestId('agents-get').textContent).toContain('codemyriad/ohhi-markdown')
    expect(screen.getByTestId('agents-get').textContent).toContain('private')
    expect(GET_REPO).toContain('git clone git@github.com:codemyriad/ohhi-markdown.git')
    expect(GET_REPO).toContain('node common/scripts/install-run-rush.js install')

    for (const route of ['claude', 'mcp', 'terminal']) {
      await user.click(screen.getByTestId(`agents-route:${route}`))
      const first = screen.getByRole('tabpanel').querySelector('ol > li')!
      expect(first.textContent).toContain(t.step_repo())
      expect(first.querySelector('[data-testid="agents-code:get-repo"]')?.textContent).toBe(GET_REPO)
    }

    await user.click(screen.getByTestId('agents-route:claude'))
    const instead = screen.getByTestId('agents-claude-instead')
    expect(instead.closest('ol')).toBeNull()
    expect(instead.textContent).toContain(t.claude_mcp_instead())
    expect(instead.querySelector('[data-testid="agents-code:claude-mcp"]')).not.toBeNull()
  })

  it('says when the clipboard refused', async () => {
    const { user, writeClipboard } = setup({ vault: { name: 'n', kind: 'tauri', path: '/n' }, desktop: true })
    writeClipboard.mockRejectedValueOnce(new Error('denied'))
    await user.click(screen.getByTestId('agents-copy:claude-skill'))
    await waitFor(() => expect(screen.getByTestId('agents-copy-status').textContent).toContain(t.copy_failed()))
  })

  it('in the browser, explains that no agent can reach the vault and offers Sync & devices', async () => {
    const { env, user } = setup({ vault: { name: 'web notes', kind: 'opfs' } })
    expect(screen.getByTestId('agents-unreachable').textContent).toContain(t.browser_title())
    expect(screen.queryByTestId('agents-connect')).toBeNull()
    // Still says what an agent could do.
    expect(screen.getByTestId('agents-can-do')).toBeTruthy()
    await user.click(screen.getByTestId('agents-open-sync'))
    expect(env.openSection).toHaveBeenCalledWith('sync')
  })

  it('with no vault (the manager’s page), shows the routes with a placeholder path', () => {
    setup({ vault: null, host: 'page', desktop: true })
    expect(screen.queryByTestId('agents-unreachable')).toBeNull()
    expect(screen.getByTestId('agents-placeholder').textContent).toContain(t.placeholder())
    expect(screen.getByTestId('agents-placeholder').textContent).not.toContain(t.placeholder_browser())
    expect(codeOf('claude-mcp')).toBe(`claude mcp add ohhi -- ohhi mcp --vault "${PLACEHOLDER_VAULT_PATH}"`)
  })

  it('with no vault in a browser, adds that browser vaults are out of reach', () => {
    setup({ vault: null, host: 'page', desktop: false })
    expect(screen.getByTestId('agents-placeholder').textContent).toContain(t.placeholder_browser())
  })
})

describe('Settings › Agents — the guide (settings-shaping ST6)', () => {
  it('Read the guide opens the agents guide page, in every place the section is drawn', async () => {
    for (const vault of [{ name: 'notes', kind: 'tauri' as const, path: '/n' }, { name: 'web', kind: 'opfs' as const }, null]) {
      const openGuide = vi.fn()
      const { user } = setup({ vault, openGuide })
      const link = screen.getByTestId('agents-guide')
      expect(link).toHaveAccessibleName(t.read_guide_label())
      await user.click(link)
      expect(openGuide).toHaveBeenCalledExactlyOnceWith('agents')
      cleanup()
    }
  })
})
