import { generateText } from 'ai'
import { describe, expect, it } from 'vitest'
import { mockLlmFetch } from '@ohhi/testkit'
import { createModel, providerHost, resolveBaseUrl, testConnection } from '../src/model.js'
import { KINDS, providerOf } from './helpers.js'

describe('resolveBaseUrl / providerHost', () => {
  it('falls back to the kind’s default and drops a trailing slash', () => {
    expect(resolveBaseUrl({ kind: 'openai', baseUrl: '' })).toBe('https://api.openai.com/v1')
    expect(resolveBaseUrl({ kind: 'openrouter', baseUrl: '' })).toBe('https://openrouter.ai/api/v1')
    expect(resolveBaseUrl({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1/' })).toBe('http://localhost:11434/v1')
  })

  it('gives Anthropic its /v1 root when the person typed the bare host', () => {
    expect(resolveBaseUrl({ kind: 'anthropic', baseUrl: '' })).toBe('https://api.anthropic.com/v1')
    expect(resolveBaseUrl({ kind: 'anthropic', baseUrl: 'https://gw.example/anthropic/v1' })).toBe('https://gw.example/anthropic/v1')
  })

  it('refuses an OpenAI-compatible provider with no endpoint', () => {
    expect(() => resolveBaseUrl({ kind: 'openai-compatible', baseUrl: ' ' })).toThrow(/base URL/)
  })

  it('names the host for the egress line', () => {
    expect(providerHost({ kind: 'anthropic', baseUrl: '' })).toBe('api.anthropic.com')
    expect(providerHost({ kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' })).toBe('localhost:11434')
  })
})

describe('createModel', () => {
  it.each(KINDS)('%s: every request goes through the injected fetch, to the configured endpoint, with the key', async (kind) => {
    const mock = mockLlmFetch([{ text: 'Hello from the mock.' }])
    const { text } = await generateText({ model: createModel(providerOf(kind), mock), prompt: 'hi', maxRetries: 0 })
    expect(text).toBe('Hello from the mock.')
    const [req] = mock.requests
    expect(req.model).toBe('mock-model')
    expect(req.lastUser).toBe('hi')
    if (kind === 'anthropic') {
      expect(req.url).toBe('https://api.anthropic.com/v1/messages')
      expect(req.headers['x-api-key']).toBe('sk-test')
      expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    } else {
      expect(req.url).toMatch(/\/chat\/completions$/)
      expect(req.headers.authorization).toBe('Bearer sk-test')
    }
  })

  it('sends no key for a keyless local server', async () => {
    const mock = mockLlmFetch([{ text: 'ok' }])
    await generateText({ model: createModel(providerOf('openai-compatible', { apiKey: undefined }), mock), prompt: 'hi' })
    expect(mock.requests[0].headers.authorization).toBeUndefined()
  })
})

describe('testConnection', () => {
  it('lists the endpoint’s models for the OpenAI-shaped kinds, consuming no turn', async () => {
    for (const kind of ['openai', 'openrouter', 'openai-compatible'] as const) {
      const mock = mockLlmFetch([], { models: ['llama3', 'qwen'] })
      expect(await testConnection(providerOf(kind), mock)).toEqual({ models: ['llama3', 'qwen'] })
      expect(mock.requests[0]).toMatchObject({ wire: 'models', method: 'GET' })
      expect(mock.requests[0].headers.authorization).toBe('Bearer sk-test')
    }
  })

  it('makes a one-token call for Anthropic and answers with the configured model', async () => {
    const mock = mockLlmFetch([{ text: 'k' }])
    expect(await testConnection(providerOf('anthropic', { model: 'claude-x' }), mock)).toEqual({ models: ['claude-x'] })
    expect((mock.requests[0].body as { max_tokens: number }).max_tokens).toBe(1)
  })

  it('throws the endpoint’s own message', async () => {
    const refusing: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401, statusText: 'Unauthorized' })
    await expect(testConnection(providerOf('openai'), refusing)).rejects.toThrow('401 Unauthorized: invalid api key')
    const mock = mockLlmFetch([{ error: { status: 401, message: 'invalid x-api-key' } }])
    await expect(testConnection(providerOf('anthropic'), mock)).rejects.toThrow(/invalid x-api-key/)
  })
})
