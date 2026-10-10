/**
 * `@ohhi/harness` — the writing harness's runtime core (writing-harness-shaping
 * §B2): the provider layer, the contract as tools, the system prompt and the
 * tool loop. Hosts (the app's transport, `ohhi ask`) build an `AgentHost` and
 * call `createHarnessAgent`; nothing here reads a clock, a timer or the
 * network except through the host.
 *
 * Browser-safe: `tools.ts` runs the `libs/agent` ops through
 * `@ohhi/agent/core`, which reaches no Node module. `@ohhi/harness/model` is
 * the provider layer alone, for a surface that only needs a model
 * (Settings › AI › Providers).
 */
export type * from './types.js'
export {
  callSettings,
  createModel,
  DEFAULT_BASE_URLS,
  PROVIDER_KINDS,
  ProviderConfigError,
  providerHost,
  resolveBaseUrl,
  testConnection,
} from './model.js'
export { toolName, toolsFromContract, type ProposalResult } from './tools.js'
export { renderRefs, systemPrompt } from './prompt.js'
/** The catalog's one home is the skills loader (`@ohhi/agent/skills`); re-exported for the hosts. */
export { skillsCatalog } from '@ohhi/agent/skills'
/** The contract's error, for a host's backend that refuses a write the way the files backend does. */
export { OpError } from '@ohhi/agent/core'
export { createHarnessAgent, errorText, MAX_STEPS, type HarnessAgent } from './agent.js'
export { editSpan, type EditSpan } from './edit-span.js'
export { HarnessTimeoutError, withTimeout } from './timeout.js'
