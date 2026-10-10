/**
 * Settings › AI › Providers, as pure functions over the stored AI config
 * (`ai-config.svelte.ts`): the list as every view sees it (the key
 * replaced by whether one is set), the add/edit form's schema and draft,
 * saving with the write-only key rule, delete, the default, and *Test
 * connection* through the harness's provider layer.
 *
 * `@ohhi/harness/model` — not the package root — because the root pulls the
 * vault ops in, and Settings only needs a model.
 */
import { z } from 'zod'
import { getLL } from '@ohhi/i18n'
import { DEFAULT_BASE_URLS, PROVIDER_KINDS } from '@ohhi/harness/config'
import { providerHost, resolveBaseUrl, testConnection } from '@ohhi/harness/model'
import type { AiConfig, ProviderConfig, ProviderKind, ProviderView } from '@ohhi/harness'
import { providerView } from './config.js'
import { aiConfig, setAiConfig } from './ai-config.svelte.js'


/** A row of the list: what may be shown, plus where the text goes. */
export interface ProviderRow extends ProviderView {
  host: string
  isDefault: boolean
}

/** The stored providers as rows; the first is the default when none is named. */
export function providerRows(config: AiConfig = aiConfig()): ProviderRow[] {
  const def = config.defaultProvider ?? config.providers[0]?.id
  return config.providers.map((p) => ({ ...providerView(p), host: providerHost(p), isDefault: p.id === def }))
}

/** The form's values — strings throughout, as the controls bind them. */
export interface ProviderDraft extends Record<string, unknown> {
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  /** Write-only: empty on edit; saving it empty keeps the stored key. */
  apiKey: string
  timeoutSec: string
  maxTokens: string
}

/** A blank draft of `kind`, its base URL prefilled. */
export function emptyDraft(kind: ProviderKind = 'anthropic'): ProviderDraft {
  return { name: '', kind, baseUrl: DEFAULT_BASE_URLS[kind], model: '', apiKey: '', timeoutSec: '', maxTokens: '' }
}

/** A stored provider as a draft — never with its key. */
export function draftOf(p: ProviderConfig | ProviderView): ProviderDraft {
  return {
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    timeoutSec: p.timeoutSec ? String(p.timeoutSec) : '',
    maxTokens: p.maxTokens ? String(p.maxTokens) : '',
  }
}

/**
 * The kind changed: move the base URL to the new kind's default unless the
 * person typed their own (anything other than the old kind's default).
 */
export function baseUrlForKind(current: string, from: ProviderKind, to: ProviderKind): string {
  return current.trim() === '' || current.trim() === DEFAULT_BASE_URLS[from] ? DEFAULT_BASE_URLS[to] : current
}

const positiveIntOrEmpty = (message: string) =>
  z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0), message)

/** The add/edit form's rules; messages in the current locale. */
export function providerSchema(): z.ZodType<ProviderDraft> {
  const e = getLL().web.ai.providers.error
  return z
    .object({
      name: z.string().trim().min(1, e.name_required()),
      kind: z.enum(PROVIDER_KINDS as unknown as [ProviderKind, ...ProviderKind[]]),
      baseUrl: z
        .string()
        .trim()
        .refine((v) => v === '' || /^https?:\/\/[^\s/]+/.test(v), e.base_url_invalid()),
      model: z.string().trim().min(1, e.model_required()),
      apiKey: z.string(),
      timeoutSec: positiveIntOrEmpty(e.number_invalid()),
      maxTokens: positiveIntOrEmpty(e.number_invalid()),
    })
    .superRefine((d, ctx) => {
      if (d.kind === 'openai-compatible' && d.baseUrl.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: e.base_url_required() })
      }
    }) as unknown as z.ZodType<ProviderDraft>
}

/** `Claude (work)` → `claude-work`, unique among `taken`. */
export function providerId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'provider'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/**
 * The stored key may stand in for an empty key field only while it would go
 * where it went before: the same kind at the same resolved base URL. An edit
 * that points the provider somewhere else needs the key typed again — a
 * stored key is never sent to a host it was not entered for.
 */
export function keepsStoredKey(draft: Pick<ProviderDraft, 'kind' | 'baseUrl'>, existing: Pick<ProviderConfig, 'kind' | 'baseUrl'>): boolean {
  if (draft.kind !== existing.kind) return false
  try {
    return resolveBaseUrl({ kind: draft.kind, baseUrl: draft.baseUrl.trim() }) === resolveBaseUrl(existing)
  } catch {
    return false
  }
}

/**
 * A draft as a stored provider. `existing` is the provider being edited: an
 * empty key field keeps its key (the key is write-only — the form never had
 * it) unless the edit moved the provider (`keepsStoredKey`).
 */
export function providerFrom(draft: ProviderDraft, id: string, existing?: ProviderConfig): ProviderConfig {
  const out: ProviderConfig = {
    id,
    name: draft.name.trim(),
    kind: draft.kind,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
  }
  const key = draft.apiKey.trim() || (existing && keepsStoredKey(draft, existing) ? existing.apiKey : undefined)
  if (key) out.apiKey = key
  if (draft.timeoutSec.trim()) out.timeoutSec = Number(draft.timeoutSec)
  if (draft.maxTokens.trim()) out.maxTokens = Number(draft.maxTokens)
  return out
}

/** Add (no `editingId`) or replace a provider; the first one becomes the default. Returns the new config. */
export function saveProvider(draft: ProviderDraft, editingId?: string): AiConfig {
  const config = aiConfig()
  const existing = editingId ? config.providers.find((p) => p.id === editingId) : undefined
  const id = existing?.id ?? providerId(draft.name, config.providers.map((p) => p.id))
  const provider = providerFrom(draft, id, existing)
  const providers = existing
    ? config.providers.map((p) => (p.id === existing.id ? provider : p))
    : [...config.providers, provider]
  const next: AiConfig = { ...config, providers, defaultProvider: config.defaultProvider ?? providers[0].id }
  setAiConfig(next)
  return next
}

/** Remove a provider; the default moves to the first remaining one. */
export function deleteProvider(id: string): AiConfig {
  const config = aiConfig()
  const providers = config.providers.filter((p) => p.id !== id)
  const next: AiConfig = { ...config, providers }
  if (config.defaultProvider === id || !providers.some((p) => p.id === next.defaultProvider)) {
    if (providers.length > 0) next.defaultProvider = providers[0].id
    else delete next.defaultProvider
  }
  setAiConfig(next)
  return next
}

export function setDefaultProvider(id: string): AiConfig {
  const config = aiConfig()
  if (!config.providers.some((p) => p.id === id)) return config
  const next = { ...config, defaultProvider: id }
  setAiConfig(next)
  return next
}

export type ConnectionResult = { ok: true; models: string[] } | { ok: false; error: string }

/**
 * *Test connection* on a draft — the stored key standing in for an empty key
 * field — through the same provider layer a run uses. Never throws.
 */
export async function testDraft(
  draft: ProviderDraft,
  opts: { editingId?: string; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ConnectionResult> {
  const existing = opts.editingId ? aiConfig().providers.find((p) => p.id === opts.editingId) : undefined
  try {
    const { models } = await testConnection(providerFrom(draft, existing?.id ?? 'draft', existing), opts.fetch ?? globalThis.fetch.bind(globalThis), {
      signal: opts.signal,
    })
    return { ok: true, models }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message || err.name : String(err) }
  }
}

/** "Connected. 3 models available: a, b, c" — the list cut at five. */
export function connectionText(result: ConnectionResult): string {
  const t = getLL().web.ai.providers
  if (!result.ok) return t.test_failed({ error: result.error })
  const shown = result.models.slice(0, 5).join(', ')
  const more = result.models.length > 5 ? ', …' : ''
  return t.test_ok({ count: result.models.length, list: shown ? `: ${shown}${more}` : '' })
}

/** The kind's label key: the dictionary cannot hold a hyphen in a key. */
export function kindLabel(kind: ProviderKind): string {
  const k = getLL().web.ai.providers.kinds
  return kind === 'openai-compatible' ? k.openai_compatible() : k[kind]()
}
