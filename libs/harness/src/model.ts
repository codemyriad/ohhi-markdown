/**
 * The provider layer (writing-harness-shaping Fork 1-A): one function from a
 * stored `ProviderConfig` to an AI SDK 7 model, with every request going
 * through the injected `fetch` — the mock in tests, the webview's (or a
 * Tauri HTTP plugin's) in the app, Node's under `ohhi ask`.
 *
 * Browser-safe on purpose: no Node import here or below, because the web
 * app's Settings › AI › Providers imports this module directly (package
 * subpath `@ohhi/harness/model`) for *Test connection*.
 */
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, type LanguageModel } from 'ai'
import type { ProviderConfig, ProviderKind } from './types.js'

/** What `baseUrl: ''` means per kind — and what Settings prefills. */
export const DEFAULT_BASE_URLS: Readonly<Record<ProviderKind, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'openai-compatible': '',
}

export const PROVIDER_KINDS: readonly ProviderKind[] = ['anthropic', 'openai', 'openrouter', 'openai-compatible']

/** Thrown for a provider that cannot be built (no endpoint for `openai-compatible`). */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

/**
 * The endpoint requests go to: the stored `baseUrl` or the kind's default,
 * without a trailing slash. Anthropic's SDK wants the `/v1` root; a person
 * types (and Settings prefills) the bare host, so it is added when missing.
 */
export function resolveBaseUrl(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): string {
  const raw = (provider.baseUrl.trim() || DEFAULT_BASE_URLS[provider.kind]).replace(/\/+$/, '')
  if (!raw) throw new ProviderConfigError(`${provider.kind} needs a base URL`)
  if (provider.kind === 'anthropic' && !/\/v\d+$/.test(raw)) return `${raw}/v1`
  return raw
}

/** The host the egress line names ("…sent to {name} at {host}"); the raw text when it is not a URL. */
export function providerHost(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): string {
  const raw = provider.baseUrl.trim() || DEFAULT_BASE_URLS[provider.kind]
  try {
    return new URL(raw).host
  } catch {
    return raw
  }
}

/** AI SDK 7 model for a provider; every request goes through `fetchImpl`. */
export function createModel(provider: ProviderConfig, fetchImpl: typeof fetch): LanguageModel {
  const baseURL = resolveBaseUrl(provider)
  // An absent key is sent as absent, never looked up in the environment: the
  // SDKs fall back to `process.env.*_API_KEY`, which in Node would quietly
  // use a key the person never gave this provider.
  const apiKey = provider.apiKey ?? ''
  switch (provider.kind) {
    case 'anthropic':
      return createAnthropic({
        baseURL,
        apiKey,
        fetch: fetchImpl,
        // Spike S13: Anthropic refuses a browser origin without it; the
        // webview IS a browser, and the key is the person's own.
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      }).messages(provider.model)
    case 'openai':
      // Chat Completions, not Responses: one wire shape for OpenAI,
      // OpenRouter and every local server, and the one the mock speaks.
      return createOpenAI({ baseURL, apiKey, fetch: fetchImpl }).chat(provider.model)
    case 'openrouter':
      return createOpenRouter({ baseURL, apiKey, fetch: fetchImpl, compatibility: 'strict' }).chat(
        provider.model,
      ) as unknown as LanguageModel
    case 'openai-compatible':
      return createOpenAICompatible({
        name: provider.id,
        baseURL,
        apiKey: provider.apiKey || undefined,
        fetch: fetchImpl,
        includeUsage: true,
      }).chatModel(provider.model)
  }
}

/** The per-call settings a provider carries (`maxTokens` → `maxOutputTokens`). */
export function callSettings(provider: ProviderConfig): { maxOutputTokens?: number } {
  return provider.maxTokens ? { maxOutputTokens: provider.maxTokens } : {}
}

/**
 * *Test connection* (B1): the model names the endpoint lists (`GET /models`
 * for the OpenAI-shaped kinds), or for Anthropic a one-token `generateText`
 * through `createModel` — the configured model is the answer when it works.
 * Throws with the endpoint's own message when it does not.
 */
export async function testConnection(
  provider: ProviderConfig,
  fetchImpl: typeof fetch,
  opts: { signal?: AbortSignal } = {},
): Promise<{ models: string[] }> {
  if (provider.kind === 'anthropic') {
    await generateText({
      model: createModel(provider, fetchImpl),
      prompt: 'ping',
      maxOutputTokens: 1,
      maxRetries: 0,
      abortSignal: opts.signal,
    })
    return { models: [provider.model] }
  }
  const headers: Record<string, string> = { accept: 'application/json' }
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`
  const res = await fetchImpl(`${resolveBaseUrl(provider)}/models`, { headers, signal: opts.signal })
  const body = (await res.json().catch(() => null)) as { data?: Array<{ id?: unknown }>; error?: { message?: unknown } } | null
  if (!res.ok) {
    const detail = typeof body?.error?.message === 'string' ? `: ${body.error.message}` : ''
    throw new Error(`${res.status} ${res.statusText}${detail}`.trim())
  }
  const models = (body?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
  return { models }
}
