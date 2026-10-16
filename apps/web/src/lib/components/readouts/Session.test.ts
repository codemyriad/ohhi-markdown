// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import type { ProviderConfig } from '@ohhi/harness'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAiConfig } from '../../ai-config.svelte.js'
import { fakeViewShell } from '../../readouts.fixture.js'
import { viewShellContext } from '../../views.js'
import Session from './Session.svelte'

const PROVIDER: ProviderConfig = { id: 'p1', name: 'Local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'mock-model', apiKey: 'k' }

beforeEach(() => {
  localStorage.clear()
  setAiConfig({ providers: [] })
})
afterEach(cleanup)

describe('the session readout (the Session view’s door on the toolbar)', () => {
  it('draws nothing without a provider — the quiet default', () => {
    render(Session, { props: { ctx: {} }, context: viewShellContext(fakeViewShell()) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('with a provider, opens the current session through the shell', async () => {
    setAiConfig({ providers: [PROVIDER] })
    const shell = fakeViewShell()
    render(Session, { props: { ctx: {} }, context: viewShellContext(shell) })
    const button = screen.getByRole('button', { name: getLL().web.ai.commands.session() })
    await userEvent.setup().click(button)
    expect(shell.openView).toHaveBeenCalledWith('session', expect.any(String))
  })
})
