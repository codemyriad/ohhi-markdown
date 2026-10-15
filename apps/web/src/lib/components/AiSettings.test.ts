// @vitest-environment jsdom
/**
 * Settings › AI: the one AI surface that exists at rest — since
 * settings-shaping ST1 the `ai` section of the Settings view, and since QA
 * round 1 one page with no sub-tabs: the egress sentence as its lede, then
 * Providers, Skills (only once a provider exists — the quiet default) and
 * Outside agents (always: it needs no provider).
 */
import { cleanup, render, screen } from '@testing-library/svelte'
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

  it('with no provider: the egress rule, Providers and Outside agents — no Skills, and no tabs at all', () => {
    renderAt('ai')
    expect(screen.getByTestId('settings-lede:ai')).toHaveTextContent(t.settings.egress())
    expect(screen.getByTestId('ai-providers')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-skills')).toBeNull()
    expect(screen.getByTestId('settings-agents')).toBeInTheDocument()
    // The only tabs on the page are the nav's and the route picker's.
    const lists = screen.getAllByRole('tablist').map((l) => l.getAttribute('aria-label'))
    expect(lists).toEqual([getLL().web.settings.sections(), getLL().web.settings.agents.routes()])
  })

  it('with a provider: Skills between Providers and Outside agents, on the same page; removing the last provider takes it away again', () => {
    setAiConfig({ providers: [PROVIDER] })
    renderAt('ai')
    const groups = ['ai-providers', 'ai-skills', 'settings-agents'].map((id) => screen.getByTestId(id))
    // In that order down the page.
    expect(groups[0]!.compareDocumentPosition(groups[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(groups[1]!.compareDocumentPosition(groups[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    setAiConfig({ providers: [] })
    flushSync()
    expect(screen.queryByTestId('ai-skills')).toBeNull()
    expect(screen.getByTestId('ai-providers')).toBeInTheDocument()
  })
})
