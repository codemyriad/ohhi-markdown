/**
 * The writing harness's seam types: everything a host and the runtime pass
 * each other.
 *
 * One home per type. The records the workspace stores (suggestions, comment
 * threads, the agent's origin and presence, the edit input) are declared in
 * `@ohhi/workspace`; the skill's shape in `@ohhi/agent/skills` (the loader).
 * This file re-exports both, type-only — the harness's main entry stays
 * browser-safe and pulls in no workspace or loader code — and declares only
 * what is the harness's own: providers, references, sessions, the host.
 */
import type { VaultBackend } from '@ohhi/agent/core'
import type { SkillMeta } from '@ohhi/agent/skills'
import type { AgentPresenceState, ProposeEditInput, SuggestionRecord } from '@ohhi/workspace'
import type { Clock } from '@ohhi/testkit'

export type {
  AgentOrigin,
  AgentPresenceState,
  CommentRecord,
  ProposeEditInput,
  SuggestionRange,
  SuggestionRecord,
  SuggestionStatus,
  ThreadRecord,
} from '@ohhi/workspace'
export type { SkillInput, SkillKind, SkillMeta, SkillOutput } from '@ohhi/agent/skills'

// ---- providers (B1; Cassini's shape) ----
export type ProviderKind = 'anthropic' | 'openai' | 'openrouter' | 'openai-compatible'
export interface ProviderConfig {
  id: string; name: string; kind: ProviderKind
  baseUrl: string            // '' = the kind's default
  apiKey?: string            // write-only in every view; never logged, never rendered
  model: string              // the endpoint's default model
  timeoutSec?: number; maxTokens?: number
}
/** A provider as every view sees it: the key replaced by whether one is set. */
export interface ProviderView extends Omit<ProviderConfig, 'apiKey'> { apiKeyConfigured: boolean }
/** `AppConfigV2.ai`. AI is enabled exactly when `providers` is non-empty (R1). */
export interface AiConfig { providers: ProviderConfig[]; defaultProvider?: string; directEdit?: boolean }

// ---- references (B5) ----
export type VaultRef =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'section'; path: string; section: string }
  | { kind: 'lines'; path: string; lines: { from: number; to: number } }   // 1-based inclusive, as `ohhi read --lines`
export interface Mention {
  id: string; ref: VaultRef; label: string
  hash?: string              // ReadOut.hash at capture
  snapshot?: string          // the text at capture (lines/section)
  anchor?: { yjs?: [unknown, unknown]; headingText?: string }   // Y.RelativePosition JSON pair on an enrolled doc
}

// ---- sessions (B6; pi's shape) ----
/** The first line of a session's JSONL file. */
export interface SessionHeader { type: 'session'; version: 1; id: string; created: number; vault: string; title?: string }
export type RunStatus = 'scheduled' | 'running' | 'successful' | 'failed' | 'cancelled'
export interface RunRecord {
  runId: string; status: RunStatus; progress?: number
  startedAt?: number; endedAt?: number
  input: { refs: Mention[]; skill?: string; instruction: string }
  provider: string; model: string
  host?: string              // the provider's host (`providerHost`), as the run reached it
  usage?: { input: number; output: number }
  error?: string
  suggestions?: string[]     // SuggestionRecord ids this run produced
  threadId?: string          // when a comment thread asked
}
/** One line of a session's JSONL file after the header; a tree via `parentId`. */
export type SessionEntry = { id: string; parentId: string | null; at: number } & (
  | { type: 'message'; message: UIMessageJson }    // AI SDK UIMessage, as JSON
  | { type: 'run'; run: RunRecord }
  | { type: 'label'; label: string }
  | { type: 'compaction'; summary: string; firstKeptId: string }
  | { type: 'custom'; name: string; data: unknown }
)
export type UIMessageJson = { id: string; role: 'user' | 'assistant' | 'system'; parts: unknown[]; metadata?: unknown }

// ---- skills (B9) ----
/** What a host offers the model: only the skills it may use (trusted and enabled in the app). */
export interface SkillSource { list(): Promise<SkillMeta[]>; body(name: string): Promise<string | null> }

// ---- the host seam (B2) ----
/** What the runtime is given: the in-app host (B3/B4) and the Node host (`ohhi ask`) are two implementations. */
export interface AgentHost {
  backend: VaultBackend                  // @ohhi/agent — files (CLI) or the live workspace (app)
  clock: Clock                           // @ohhi/testkit
  fetch: typeof fetch                    // injected; the mock in tests
  skills: SkillSource
  proposeEdit?(input: ProposeEditInput): Promise<SuggestionRecord>   // absent → writes go straight through the backend
  presence?: { set(state: AgentPresenceState | null): void }
}
