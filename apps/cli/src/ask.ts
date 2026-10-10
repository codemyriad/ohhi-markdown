/**
 * `ohhi ask "<prompt>"` — the Node host of the writing harness
 * (writing-harness-build A7). NOT a contract op: it is not a vault operation
 * but an agent run over the vault's read ops, so it has no `OP_SCHEMAS`
 * entry, no `spec/` schema and no MCP tool. Its `--json` document is defined
 * here, beside the code that prints it.
 *
 *   stdout  the model's answer, streamed (or one `ohhi.ask.v1` with --json)
 *   stderr  each tool call (`tool=ohhi_search query="…"`), then provenance
 *   exit    0 · 1 a provider or run error · 2 usage (no providers file, an
 *           unknown provider, a bad --ref)
 *
 * Providers come from `$XDG_CONFIG_HOME/ohhi/providers.json` (else
 * `~/.config/ohhi/providers.json`) in the app's `AiConfig` shape;
 * `OHHI_API_KEY` overrides the chosen provider's key.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { OpError, runOp, type VaultBackend } from '@ohhi/agent'
import { parseSkillsState, SKILLS_STATE_PATH, usableSkills, type SkillsState } from '@ohhi/agent/skills'
import {
  createHarnessAgent,
  PROVIDER_KINDS,
  type AiConfig,
  type Mention,
  type ProviderConfig,
  type SkillMeta,
  type SkillSource,
  type VaultRef,
} from '@ohhi/harness'
import { openVault } from './backend.js'
import { RealClock } from './clock.js'
import type { AskCommand } from './grammar.js'
import type { Io, Sink } from './io.js'

// ---- the --json document ----

export const AskOut = z.object({
  schema: z.literal('ohhi.ask.v1'),
  /** The model's final answer, every text part of the run joined. */
  text: z.string(),
  /** Tokens across every step; null when the provider did not report them. */
  usage: z.object({ input: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).nullable(),
  /** The tools the model called, in order, with the input it gave each. */
  tools: z.array(z.object({ name: z.string(), input: z.unknown() })),
})
export type AskOut = z.infer<typeof AskOut>

// ---- providers.json ----

const ProvidersFile = z.object({
  providers: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().default(''),
      kind: z.enum(PROVIDER_KINDS as unknown as [ProviderConfig['kind'], ...ProviderConfig['kind'][]]),
      baseUrl: z.string().default(''),
      apiKey: z.string().optional(),
      model: z.string().min(1),
      timeoutSec: z.number().positive().optional(),
      maxTokens: z.number().int().positive().optional(),
    }),
  ),
  defaultProvider: z.string().optional(),
  directEdit: z.boolean().optional(),
})

/** `$XDG_CONFIG_HOME/ohhi/providers.json`, else `~/.config/ohhi/providers.json`. */
export function providersPath(env: Io['env']): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || env.USERPROFILE || '.', '.config')
  return join(base, 'ohhi', 'providers.json')
}

async function loadProviders(env: Io['env']): Promise<AiConfig> {
  const path = providersPath(env)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new OpError(
      'usage',
      `no providers configured — create ${path} with {"providers":[{"id":"…","kind":"anthropic|openai|openrouter|openai-compatible","baseUrl":"","model":"…"}]} (the key may come from $OHHI_API_KEY)`,
      { path },
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new OpError('usage', `${path} is not JSON: ${err instanceof Error ? err.message : String(err)}`, { path })
  }
  const result = ProvidersFile.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new OpError('usage', `${path}: ${issue.path.join('.')}: ${issue.message}`, { path })
  }
  return result.data
}

/** `--provider`, else the file's `defaultProvider`, else the first; `--model` and `$OHHI_API_KEY` laid over it. */
export function chooseProvider(config: AiConfig, command: Pick<AskCommand, 'provider' | 'model'>, env: Io['env']): ProviderConfig {
  const id = command.provider ?? config.defaultProvider
  const chosen = id === undefined ? config.providers[0] : config.providers.find((p) => p.id === id)
  if (!chosen) {
    const known = config.providers.map((p) => p.id).join(', ') || 'none'
    throw new OpError('usage', id === undefined ? 'providers.json lists no providers' : `no provider ${JSON.stringify(id)} (known: ${known})`, { provider: id ?? null })
  }
  const out: ProviderConfig = { ...chosen }
  if (command.model) out.model = command.model
  if (env.OHHI_API_KEY) out.apiKey = env.OHHI_API_KEY
  return out
}

// ---- --ref ----

/** `path`, `path/` (folder), `path#Section/Sub`, `path:12-20`. */
export function parseRef(raw: string): VaultRef {
  const lines = /^(.+):(\d+)-(\d+)$/.exec(raw)
  if (lines) {
    const from = Number(lines[2])
    const to = Number(lines[3])
    if (from < 1 || to < from) throw new OpError('usage', `--ref ${raw}: a line range is 1-based and ascending`, { flag: 'ref' })
    return { kind: 'lines', path: lines[1], lines: { from, to } }
  }
  const hash = raw.indexOf('#')
  if (hash > 0) return { kind: 'section', path: raw.slice(0, hash), section: raw.slice(hash + 1) }
  if (raw.endsWith('/')) return { kind: 'folder', path: raw }
  return { kind: 'file', path: raw }
}

/** Resolve a ref into a mention the prompt can carry: the text as it is now, with the note's hash. */
async function mentionOf(backend: VaultBackend, raw: string, index: number): Promise<Mention> {
  const ref = parseRef(raw)
  const id = `ref-${index + 1}`
  if (ref.kind === 'folder') return { id, ref, label: ref.path }
  const read = await runOp(backend, 'read', {
    path: ref.path,
    ...(ref.kind === 'lines' ? { lines: ref.lines } : ref.kind === 'section' ? { section: ref.section } : {}),
  })
  const label =
    ref.kind === 'lines' ? `${read.path} (${ref.lines.from}–${ref.lines.to})` : ref.kind === 'section' ? `${read.path} › ${ref.section}` : read.path
  const normalized: VaultRef = { ...ref, path: read.path }
  // A truncated read is not "the text": leave it unattached and let the model read narrowly.
  return read.truncated || read.text === undefined
    ? { id, ref: normalized, label, hash: read.hash }
    : { id, ref: normalized, label, hash: read.hash, snapshot: read.text }
}

// ---- skills, through the contract's own ops ----

/**
 * The vault's `.ohhi/skills.json` (the app's trust and enabled state), or
 * null when the app never wrote one — then every valid skill is usable (C's
 * `usableSkills` rule). A skill the app lists untrusted or disabled is never
 * offered here either: one gate, both hosts.
 */
async function skillsState(backend: VaultBackend): Promise<SkillsState | null> {
  const bytes = await backend.adapter.read(SKILLS_STATE_PATH).catch(() => null)
  return parseSkillsState(bytes ? new TextDecoder().decode(bytes) : null)
}

function skillSource(backend: VaultBackend, state: SkillsState | null): SkillSource {
  return {
    list: async () => {
      const out = await runOp(backend, 'skills', { limit: 1000 })
      return usableSkills(out.skills, state).map((s): SkillMeta => ({ ...s, metadata: {} }))
    },
    body: async (name) => {
      try {
        const found = await runOp(backend, 'skill', { name })
        return usableSkills([found.meta], state).length > 0 ? found.body : null
      } catch (err) {
        if (err instanceof OpError && err.code === 'not_found') return null
        throw err
      }
    },
  }
}

// ---- the run ----

/** `tool=ohhi_search query="pooling" limit=5` — one line per call, for a human tailing stderr. */
export function toolLine(name: string, input: unknown): string {
  const parts = [`tool=${name}`]
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      parts.push(`${k}=${JSON.stringify(v)}`)
    }
  }
  return parts.join(' ')
}

export async function runAsk(command: AskCommand, io: Io, sink: Sink): Promise<number> {
  const config = await loadProviders(io.env)
  const provider = chooseProvider(config, command, io.env)
  const backend = await openVault(command.globals, io)
  const state = await skillsState(backend)
  const skills = skillSource(backend, state)

  let skill: { meta: SkillMeta; body: string } | undefined
  if (command.skill) {
    const found = await runOp(backend, 'skill', { name: command.skill })
    if (found.meta.problems.length > 0) {
      throw new OpError('refused', `skill ${command.skill} has problems: ${found.meta.problems.join(', ')}`, { skill: command.skill })
    }
    if (usableSkills([found.meta], state).length === 0) {
      throw new OpError('refused', `skill ${command.skill} is not trusted and enabled in ${SKILLS_STATE_PATH}; review it in the app first`, {
        skill: command.skill,
      })
    }
    skill = { meta: found.meta, body: found.body }
  }
  const refs = await Promise.all(command.refs.map((raw, i) => mentionOf(backend, raw, i)))

  const agent = createHarnessAgent(
    { backend, clock: new RealClock(), fetch: globalThis.fetch, skills },
    {
      provider,
      skill,
      refs,
      mutates: false,
      origin: { kind: 'agent', runId: 'ask', sessionId: 'ask', name: 'ohhi ask' },
    },
  )
  const stream = await agent.stream(
    [{ id: 'ask-1', role: 'user', parts: [{ type: 'text', text: command.prompt }] }],
    {},
  )

  let text = ''
  const tools: AskOut['tools'] = []
  const names = new Map<string, string>()
  let error: string | undefined
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    switch (value.type) {
      case 'text-delta':
        text += value.delta
        if (!command.globals.json) sink.raw(value.delta)
        break
      case 'tool-input-available':
        names.set(value.toolCallId, value.toolName)
        tools.push({ name: value.toolName, input: value.input })
        sink.err(toolLine(value.toolName, value.input))
        break
      case 'tool-output-error':
        sink.err(`tool=${names.get(value.toolCallId) ?? '?'} error=${JSON.stringify(value.errorText)}`)
        break
      case 'error':
        error = value.errorText
        break
      case 'abort':
        error = 'the run was cancelled'
        break
    }
  }
  if (!command.globals.json && text && !text.endsWith('\n')) sink.raw('\n')
  if (error !== undefined) throw new OpError('runtime', `${provider.id}: ${error}`, { provider: provider.id })

  const usage = agent.lastUsage() ?? null
  sink.err(`provider=${provider.id} model=${provider.model}${usage ? ` tokens=${usage.input}/${usage.output}` : ''}`)
  if (command.globals.json) {
    sink.raw(JSON.stringify(AskOut.parse({ schema: 'ohhi.ask.v1', text, usage, tools })) + '\n')
  }
  return 0
}
