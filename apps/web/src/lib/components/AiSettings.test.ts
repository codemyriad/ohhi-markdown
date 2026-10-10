// @vitest-environment jsdom
/**
 * Settings › AI (writing-harness-build W0 §5): the one AI surface that exists
 * at rest. The section is there with no provider, carries the egress sentence
 * above its two sub-tabs, and each sub-tab hosts its builder's component.
 * Since settings-shaping ST1 it is the `ai` section of the Settings view.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { CommandRegistry } from '../commands.js'
import Settings from './Settings.svelte'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const t = getLL().web.ai

describe('Settings › AI', () => {
  it('is a section with no provider configured — where one is added (R1)', () => {
    render(Settings, { section: 'you', onSection: vi.fn(), vault: null, registry: new CommandRegistry(false) })
    expect(screen.getByTestId('settings-tab:ai')).toHaveTextContent(getLL().web.settings.nav.ai())
  })

  it('states the egress rule above Providers and Skills', async () => {
    render(Settings, { section: 'ai', onSection: vi.fn(), vault: null, registry: new CommandRegistry(false) })
    expect(screen.getByTestId('ai-settings-egress')).toHaveTextContent(t.settings.egress())
    expect(screen.getByTestId('ai-settings-tab:providers')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('ai-providers')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByTestId('ai-settings-tab:skills'))
    expect(screen.getByTestId('ai-skills')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-providers')).toBeNull()
  })
})
