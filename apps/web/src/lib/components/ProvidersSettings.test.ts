// @vitest-environment jsdom
/**
 * Settings › AI › Providers (writing-harness-build A6): add → it appears with
 * its egress line and no key on screen; edit never echoes the key; test
 * connection through the injected (mock) fetch; default; delete with confirm.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { mockLlmFetch } from '@ohhi/testkit'
import { aiConfig, aiEnabled } from '../config.js'
import ProvidersSettings from './ProvidersSettings.svelte'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const t = getLL().web.ai.providers

async function addClaude(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('ai-provider-add'))
  await user.type(screen.getByTestId('ai-provider-name'), 'Claude')
  await user.type(screen.getByTestId('ai-provider-model'), 'claude-x')
  await user.type(screen.getByTestId('ai-provider-key'), 'sk-very-secret')
  await user.click(screen.getByTestId('ai-provider-save'))
}

describe('Settings › AI › Providers', () => {
  it('starts empty, with the local-servers help', () => {
    render(ProvidersSettings)
    expect(screen.getByTestId('ai-providers-empty')).toHaveTextContent(t.empty())
    expect(screen.getByTestId('ai-providers-local-help')).toHaveTextContent('OLLAMA_ORIGINS')
  })

  it('add → the provider appears with its egress line, and the key is never on screen', async () => {
    const user = userEvent.setup()
    render(ProvidersSettings)
    await addClaude(user)
    const row = screen.getByTestId('ai-provider:claude')
    expect(row).toHaveTextContent('Claude')
    expect(row).toHaveTextContent('claude-x')
    expect(screen.getByTestId('ai-provider-key:claude')).toHaveTextContent(t.key_configured())
    expect(screen.getByTestId('ai-provider-egress:claude')).toHaveTextContent(
      t.egress({ name: 'Claude', host: 'api.anthropic.com' }),
    )
    expect(document.body.innerHTML).not.toContain('sk-very-secret')
    expect(aiEnabled()).toBe(true)
    expect(aiConfig().providers[0].apiKey).toBe('sk-very-secret')
  })

  it('edit opens with an empty key field; saving it empty keeps the key', async () => {
    const user = userEvent.setup()
    render(ProvidersSettings)
    await addClaude(user)
    await user.click(screen.getByTestId('ai-provider-edit:claude'))
    expect(screen.getByTestId('ai-provider-key')).toHaveValue('')
    expect(screen.getByTestId('ai-provider-form')).toHaveTextContent(t.field.api_key_keep())
    expect(document.body.innerHTML).not.toContain('sk-very-secret')
    const model = screen.getByTestId('ai-provider-model')
    await user.clear(model)
    await user.type(model, 'claude-y')
    await user.click(screen.getByTestId('ai-provider-save'))
    expect(aiConfig().providers[0]).toMatchObject({ model: 'claude-y', apiKey: 'sk-very-secret' })
  })

  it('validates: a compatible server needs its base URL; the kind prefills it per kind', async () => {
    const user = userEvent.setup()
    render(ProvidersSettings)
    await user.click(screen.getByTestId('ai-provider-add'))
    expect(screen.getByTestId('ai-provider-base-url')).toHaveValue('https://api.anthropic.com')
    await user.selectOptions(screen.getByTestId('ai-provider-kind'), 'openrouter')
    expect(screen.getByTestId('ai-provider-base-url')).toHaveValue('https://openrouter.ai/api/v1')
    await user.selectOptions(screen.getByTestId('ai-provider-kind'), 'openai-compatible')
    expect(screen.getByTestId('ai-provider-base-url')).toHaveValue('')
    await user.type(screen.getByTestId('ai-provider-name'), 'Ollama')
    await user.type(screen.getByTestId('ai-provider-model'), 'llama3')
    await user.click(screen.getByTestId('ai-provider-save'))
    expect(screen.getByTestId('field-errors:baseUrl')).toHaveTextContent(t.error.base_url_required())
    expect(aiEnabled()).toBe(false)
  })

  it('test connection lists the models through the injected fetch', async () => {
    const user = userEvent.setup()
    const mock = mockLlmFetch([], { models: ['llama3', 'qwen2'] })
    render(ProvidersSettings, { fetchImpl: mock })
    await user.click(screen.getByTestId('ai-provider-add'))
    await user.selectOptions(screen.getByTestId('ai-provider-kind'), 'openai-compatible')
    await user.type(screen.getByTestId('ai-provider-name'), 'Ollama')
    await user.type(screen.getByTestId('ai-provider-base-url'), 'http://localhost:11434/v1')
    await user.type(screen.getByTestId('ai-provider-model'), 'llama3')
    await user.click(screen.getByTestId('ai-provider-test'))
    const result = await screen.findByTestId('ai-provider-test-result')
    expect(result).toHaveAttribute('data-ok', 'true')
    expect(result).toHaveTextContent('Connected. 2 models available: llama3, qwen2')
    expect(mock.requests[0].url).toBe('http://localhost:11434/v1/models')
  })

  it('test connection shows the provider’s error', async () => {
    const user = userEvent.setup()
    render(ProvidersSettings, { fetchImpl: mockLlmFetch([{ error: { status: 401, message: 'invalid x-api-key' } }]) })
    await user.click(screen.getByTestId('ai-provider-add'))
    await user.type(screen.getByTestId('ai-provider-name'), 'Claude')
    await user.type(screen.getByTestId('ai-provider-model'), 'claude-x')
    await user.click(screen.getByTestId('ai-provider-test'))
    const result = await screen.findByTestId('ai-provider-test-result')
    expect(result).toHaveAttribute('data-ok', 'false')
    expect(result).toHaveTextContent(/Could not connect: .*invalid x-api-key/)
  })

  it('default radio and delete with confirm', async () => {
    const user = userEvent.setup()
    render(ProvidersSettings)
    await addClaude(user)
    await user.click(screen.getByTestId('ai-provider-add'))
    await user.selectOptions(screen.getByTestId('ai-provider-kind'), 'openai')
    await user.type(screen.getByTestId('ai-provider-name'), 'GPT')
    await user.type(screen.getByTestId('ai-provider-model'), 'gpt-x')
    await user.click(screen.getByTestId('ai-provider-save'))
    expect(screen.getByTestId('ai-provider-default:claude')).toBeChecked()
    await user.click(screen.getByTestId('ai-provider-default:gpt'))
    expect(aiConfig().defaultProvider).toBe('gpt')

    await user.click(screen.getByTestId('ai-provider-delete:gpt'))
    const row = screen.getByTestId('ai-provider:gpt')
    expect(within(row).getByRole('alert')).toHaveTextContent(t.delete_confirm({ name: 'GPT' }))
    expect(aiConfig().providers).toHaveLength(2)
    await user.click(screen.getByTestId('ai-provider-delete-confirm:gpt'))
    expect(screen.queryByTestId('ai-provider:gpt')).toBeNull()
    expect(aiConfig().defaultProvider).toBe('claude')
  })
})
