// @vitest-environment jsdom
/**
 * Settings › AI: the one AI surface that exists at rest — since
 * settings-shaping ST1 the `ai` section of the Settings view. The section is
 * there with no provider and carries the egress sentence; Skills joins
 * Providers only once a provider exists (the quiet default).
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { aiConfigChanged, setAiConfig } from '../ai-config.svelte.js'
import { CommandRegistry } from '../commands.js'
import Settings from './Settings.svelte'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  aiConfigChanged()
})

const t = getLL().web.ai
const PROVIDER = { id: 'claude', name: 'Claude', kind: 'anthropic' as const, baseUrl: '', model: 'claude-x', apiKey: 'sk-test' }

/** Settings at `section`, with no vault open: Providers are this device's config. */
function renderAt(section: 'sync' | 'ai') {
  return render(Settings, { section, onSection: vi.fn(), vault: null, registry: new CommandRegistry(false) })
}

describe('Settings › AI', () => {
  it('is a section with no provider configured — where one is added', () => {
    renderAt('sync')
    expect(screen.getByTestId('settings-tab:ai')).toHaveTextContent(getLL().web.settings.nav.ai())
  })

  it('with no provider: the egress rule and Providers, no Skills', () => {
    renderAt('ai')
    expect(screen.getByTestId('ai-settings-egress')).toHaveTextContent(t.settings.egress())
    expect(screen.getByTestId('ai-providers')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-settings-tab:skills')).toBeNull()
  })

  it('with a provider: Skills beside Providers; removing the last one takes it away again', async () => {
    setAiConfig({ providers: [PROVIDER] })
    renderAt('ai')
    expect(screen.getByTestId('ai-settings-tab:providers')).toHaveAttribute('aria-selected', 'true')
    await userEvent.setup().click(screen.getByTestId('ai-settings-tab:skills'))
    expect(screen.getByTestId('ai-skills')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-providers')).toBeNull()
    setAiConfig({ providers: [] })
    flushSync()
    expect(screen.queryByTestId('ai-settings-tab:skills')).toBeNull()
    expect(screen.getByTestId('ai-providers')).toBeInTheDocument()
  })
})
