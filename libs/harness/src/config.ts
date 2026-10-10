/**
 * `@ohhi/harness/config` — the provider config's one home: the kinds, each
 * kind's default endpoint, the schema a person-written providers file is
 * checked against (`ohhi ask`), and the tolerant reader for a stored config
 * (the app's). No AI SDK import: a surface that only reads or edits the
 * config takes this subpath and nothing else.
 */
import { z } from 'zod'
import type { AiConfig, ProviderConfig, ProviderKind } from './types.js'

export const PROVIDER_KINDS: readonly ProviderKind[] = ['anthropic', 'openai', 'openrouter', 'openai-compatible']

/** What `baseUrl: ''` means per kind — and what Settings prefills. */
export const DEFAULT_BASE_URLS: Readonly<Record<ProviderKind, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'openai-compatible': '',
}

/** Does this kind need a key? Only a local OpenAI-compatible server may run without one. */
export const kindNeedsKey = (kind: ProviderKind): boolean => kind !== 'openai-compatible'

/** One provider as a person writes it (`providers.json`): strict, with the optional fields defaulted. */
export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  kind: z.enum(PROVIDER_KINDS as unknown as [ProviderKind, ...ProviderKind[]]),
  baseUrl: z.string().default(''),
  apiKey: z.string().optional(),
  model: z.string().min(1),
  timeoutSec: z.number().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
})

/** A whole `AiConfig` as a person writes it. */
export const AiConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema),
  defaultProvider: z.string().optional(),
  directEdit: z.boolean().optional(),
})

/** One stored provider, or null when it is not one. Garbage in one entry never costs the others. */
function normalizeProvider(raw: unknown): ProviderConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string') return null
  if (!PROVIDER_KINDS.includes(p.kind as ProviderKind)) return null
  const out: ProviderConfig = {
    id: p.id,
    name: p.name,
    kind: p.kind as ProviderKind,
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
    model: typeof p.model === 'string' ? p.model : '',
  }
  if (typeof p.apiKey === 'string' && p.apiKey) out.apiKey = p.apiKey
  if (typeof p.timeoutSec === 'number' && p.timeoutSec > 0) out.timeoutSec = p.timeoutSec
  if (typeof p.maxTokens === 'number' && p.maxTokens > 0) out.maxTokens = p.maxTokens
  return out
}

/**
 * A stored AI config, read tolerantly: malformed providers dropped, a
 * `defaultProvider` that names none dropped, `directEdit` only when `true`.
 * Anything that is not a config reads as no providers (AI off, R1).
 */
export function normalizeAiConfig(raw: unknown): AiConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AiConfig, unknown>>
  const providers = Array.isArray(r.providers)
    ? r.providers.map(normalizeProvider).filter((p): p is ProviderConfig => p !== null)
    : []
  const out: AiConfig = { providers }
  if (typeof r.defaultProvider === 'string' && providers.some((p) => p.id === r.defaultProvider)) {
    out.defaultProvider = r.defaultProvider
  }
  if (r.directEdit === true) out.directEdit = true
  return out
}

/**
 * Error text with the provider's key taken out — a provider's 401 often
 * echoes what it was sent ("Incorrect API key provided: sk-…", a
 * `Bearer …` header), and an error lands in the run record, the session file,
 * the UI and `ohhi ask`'s stderr. The configured key, any `Bearer <token>`
 * and any `sk-…`-shaped token are replaced.
 */
export function redactSecrets(text: string, apiKey?: string): string {
  let out = text
  if (apiKey && apiKey.length >= 4) out = out.split(apiKey).join('[redacted]')
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_*.-]{6,}/g, 'sk-[redacted]')
}
