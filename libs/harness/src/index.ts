/**
 * `@ohhi/harness` — the writing harness's runtime core (writing-harness-shaping
 * §B2). Wave 0 declares the seams (`types.ts`) and the runtime API's
 * signatures; builder A replaces the stubs below.
 *
 * Imports from `@ohhi/agent` and `ai` are type-only here so the web bundle
 * can import this module without pulling in Node code.
 */
import type { LanguageModel, ToolSet, UIMessageChunk } from 'ai'
import type { VaultBackend } from '@ohhi/agent'
import type {
  AgentHost,
  AgentOrigin,
  Mention,
  ProviderConfig,
  RunRecord,
  SkillMeta,
  UIMessageJson,
} from './types.js'

export type * from './types.js'

const notBuilt = (): never => {
  throw new Error('not built: wave 1 A')
}

/** AI SDK 7 model for a provider; every request goes through `fetchImpl`. */
export function createModel(provider: ProviderConfig, fetchImpl: typeof fetch): LanguageModel {
  void provider; void fetchImpl
  return notBuilt()
}

/** One AI SDK tool per `libs/agent` op, named `ohhi_<op>`; read ops only unless `mutates`. */
export function toolsFromContract(
  backend: VaultBackend,
  opts: { mutates: boolean; proposeEdit?: AgentHost['proposeEdit']; origin?: AgentOrigin },
): ToolSet {
  void backend; void opts
  return notBuilt()
}

/** The harness's system prompt: vault discipline, the skills catalog, the active skill, the references. */
export function systemPrompt(input: { skills: SkillMeta[]; skill?: { meta: SkillMeta; body: string }; refs: Mention[] }): string {
  void input
  return notBuilt()
}

/** Fenced blocks headed `path (from–to)` + hash. */
export function renderRefs(refs: Mention[]): string {
  void refs
  return notBuilt()
}

export interface HarnessAgent {
  stream(messages: UIMessageJson[], opts: { signal?: AbortSignal }): Promise<ReadableStream<UIMessageChunk>>
  lastUsage(): RunRecord['usage'] | undefined
}

/** The tool loop over a host. */
export function createHarnessAgent(
  host: AgentHost,
  opts: { provider: ProviderConfig; skill?: { meta: SkillMeta; body: string }; refs: Mention[]; mutates: boolean; origin: AgentOrigin },
): HarnessAgent {
  void host; void opts
  return notBuilt()
}
