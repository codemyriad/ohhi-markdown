/**
 * The writing harness's seams (plans/writing-harness-build.md §The seams).
 *
 * Every record and interface two builders touch is declared here, once.
 * Change it minimally, keep every existing field, and say so in the report —
 * every other owner imports it.
 */
import type { VaultBackend } from '@ohhi/agent'
import type { Clock } from '@ohhi/testkit'

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

// ---- agent writes (B3/B7) ----
export interface AgentOrigin { kind: 'agent'; runId: string; sessionId: string; name: string; threadId?: string }
export type SuggestionRange = { yjs: [unknown, unknown] } | { from: number; to: number }  // relative positions (enrolled) or char offsets (tracked)
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'stale'
export interface SuggestionRecord {
  id: string; path: string; origin: AgentOrigin; at: number
  range: SuggestionRange; baseText: string; proposedText: string
  status: SuggestionStatus; threadId?: string
}
export interface ProposeEditInput { path: string; from: number; to: number; baseText: string; proposedText: string; origin: AgentOrigin }

// ---- comments (B8) ----
export interface ThreadRecord {
  id: string; path: string; author: string; created: number; resolved: boolean
  anchor: { live?: [unknown, unknown]; quote: { exact: string; prefix: string; suffix: string } }
  comments: CommentRecord[]
}
export interface CommentRecord { id: string; author: string; at: number; body: string; to?: 'agent'[]; answered?: boolean; answering?: string }

// ---- skills (B9) ----
export type SkillKind = 'check' | 'transform' | 'generate' | 'research'
export type SkillInput = 'selection' | 'section' | 'note' | 'folder'
export type SkillOutput = 'replace' | 'insert' | 'annotate' | 'new-note'
export interface SkillMeta {
  name: string; description: string; dir: string            // dir = vault-relative folder
  license?: string; compatibility?: string; metadata: Record<string, string>
  kind?: SkillKind; input?: SkillInput; output?: SkillOutput  // from metadata.ohhi-*
  hasScripts: boolean; problems: string[]                     // validation findings (empty = valid)
}
export interface SkillSource { list(): Promise<SkillMeta[]>; body(name: string): Promise<string | null> }

// ---- the host seam (B2) ----
export interface AgentPresenceState { name: string; status: 'thinking' | 'composing' | 'idle'; path?: string; working?: { from: number; to: number }[] }
/** What the runtime is given: the in-app host (B3/B4) and the Node host (`ohhi ask`) are two implementations. */
export interface AgentHost {
  backend: VaultBackend                  // @ohhi/agent — files (CLI) or the live workspace (app)
  clock: Clock                           // @ohhi/testkit
  fetch: typeof fetch                    // injected; the mock in tests
  skills: SkillSource
  proposeEdit?(input: ProposeEditInput): Promise<SuggestionRecord>   // absent → writes go straight through the backend
  presence?: { set(state: AgentPresenceState | null): void }
}
