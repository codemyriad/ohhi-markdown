import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockLlmFetch } from '@ohhi/testkit'
import {
  baseUrlForKind,
  connectionText,
  deleteProvider,
  draftOf,
  emptyDraft,
  providerFrom,
  providerId,
  providerRows,
  providerSchema,
  saveProvider,
  setDefaultProvider,
  testDraft,
  type ProviderDraft,
} from './ai-providers.js'
import { aiConfig, aiEnabled } from './ai-config.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'

beforeEach(() => {
  useMemStorage()
})
afterEach(dropStorage)

const draft = (extra: Partial<ProviderDraft> = {}): ProviderDraft => ({
  ...emptyDraft('anthropic'),
  name: 'Claude',
  model: 'claude-x',
  apiKey: 'sk-secret',
  ...extra,
})

describe('ai-providers', () => {
  it('adding the first provider turns AI on and makes it the default', () => {
    expect(aiEnabled()).toBe(false)
    saveProvider(draft())
    expect(aiEnabled()).toBe(true)
    expect(aiConfig().defaultProvider).toBe('claude')
    const [row] = providerRows()
    expect(row).toMatchObject({ id: 'claude', name: 'Claude', apiKeyConfigured: true, host: 'api.anthropic.com', isDefault: true })
    expect('apiKey' in row).toBe(false)
  })

  it('an edit with an empty key keeps the stored key; a new key replaces it', () => {
    saveProvider(draft())
    const edit = draftOf(aiConfig().providers[0])
    expect(edit.apiKey).toBe('')
    saveProvider({ ...edit, model: 'claude-y' }, 'claude')
    expect(aiConfig().providers[0]).toMatchObject({ model: 'claude-y', apiKey: 'sk-secret' })
    saveProvider({ ...edit, apiKey: 'sk-new' }, 'claude')
    expect(aiConfig().providers[0].apiKey).toBe('sk-new')
  })

  it('the stored key never follows an edit to another host or kind', () => {
    saveProvider(draft())
    const edit = draftOf(aiConfig().providers[0])
    // The same endpoint written differently (the default, or with /v1) is still the same host.
    saveProvider({ ...edit, baseUrl: 'https://api.anthropic.com/v1/' }, 'claude')
    expect(aiConfig().providers[0].apiKey).toBe('sk-secret')
    saveProvider({ ...edit, baseUrl: 'https://gateway.example/v1' }, 'claude')
    expect(aiConfig().providers[0].apiKey).toBeUndefined()
    saveProvider({ ...edit, apiKey: 'sk-again' }, 'claude')
    saveProvider({ ...draftOf(aiConfig().providers[0]), kind: 'openrouter', baseUrl: '' }, 'claude')
    expect(aiConfig().providers[0].apiKey).toBeUndefined()
  })

  it('test connection on an edit pointed elsewhere sends no stored key', async () => {
    saveProvider(draft())
    const mock = mockLlmFetch([], { models: ['a'] })
    await testDraft({ ...draftOf(aiConfig().providers[0]), kind: 'openai-compatible', baseUrl: 'http://evil.example/v1' }, { editingId: 'claude', fetch: mock })
    expect(mock.requests[0].headers.authorization ?? '').not.toContain('sk-secret')
    expect(JSON.stringify(mock.requests[0].headers)).not.toContain('sk-secret')
  })

  it('ids are slugs, unique', () => {
    expect(providerId('Claude (work)', [])).toBe('claude-work')
    expect(providerId('Claude', ['claude', 'claude-2'])).toBe('claude-3')
    expect(providerId('…', [])).toBe('provider')
  })

  it('stores numbers as numbers and drops empty optionals', () => {
    expect(providerFrom(draft({ timeoutSec: '30', maxTokens: '' , apiKey: '' }), 'x')).toEqual({
      id: 'x', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', timeoutSec: 30,
    })
  })

  it('delete moves the default; deleting the last turns AI off', () => {
    saveProvider(draft())
    saveProvider(draft({ name: 'Local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', apiKey: '' }))
    setDefaultProvider('local')
    expect(providerRows().find((r) => r.isDefault)?.id).toBe('local')
    deleteProvider('local')
    expect(aiConfig().defaultProvider).toBe('claude')
    deleteProvider('claude')
    expect(aiEnabled()).toBe(false)
    expect(aiConfig().defaultProvider).toBeUndefined()
  })

  it('switching kind moves an untouched base URL and keeps a typed one', () => {
    expect(baseUrlForKind('https://api.anthropic.com', 'anthropic', 'openai')).toBe('https://api.openai.com/v1')
    expect(baseUrlForKind('', 'anthropic', 'openrouter')).toBe('https://openrouter.ai/api/v1')
    expect(baseUrlForKind('https://gw.example/v1', 'openai', 'openrouter')).toBe('https://gw.example/v1')
    expect(baseUrlForKind('https://api.openai.com/v1', 'openai', 'openai-compatible')).toBe('')
  })

  it('the schema needs a name and a model, a URL for a compatible server, and whole numbers', () => {
    const schema = providerSchema()
    expect(schema.safeParse(draft()).success).toBe(true)
    const issues = (d: ProviderDraft) => {
      const r = schema.safeParse(d)
      return r.success ? [] : r.error.issues.map((i) => String(i.path[0]))
    }
    expect(issues(draft({ name: ' ', model: '' }))).toEqual(['name', 'model'])
    expect(issues(draft({ kind: 'openai-compatible', baseUrl: '' }))).toEqual(['baseUrl'])
    expect(issues(draft({ baseUrl: 'ftp://x' }))).toEqual(['baseUrl'])
    expect(issues(draft({ timeoutSec: '0', maxTokens: '1.5' }))).toEqual(['timeoutSec', 'maxTokens'])
  })

  it('test connection lists models through the provider layer, the stored key standing in', async () => {
    saveProvider(draft({ name: 'OR', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or' }))
    const mock = mockLlmFetch([], { models: ['a', 'b'] })
    const result = await testDraft({ ...draftOf(aiConfig().providers[0]) }, { editingId: 'or', fetch: mock })
    expect(result).toEqual({ ok: true, models: ['a', 'b'] })
    expect(mock.requests[0].headers.authorization).toBe('Bearer sk-or')
    expect(connectionText(result)).toBe('Connected. 2 models available: a, b')
  })

  it('test connection reports the error, never throws', async () => {
    const mock = mockLlmFetch([{ error: { status: 401, message: 'invalid x-api-key' } }])
    const result = await testDraft(draft(), { fetch: mock })
    expect(result.ok).toBe(false)
    expect(connectionText(result)).toMatch(/^Could not connect: .*invalid x-api-key/)
  })
})
