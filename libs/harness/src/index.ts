/**
 * `@ohhi/harness` — the writing harness's runtime core (writing-harness-shaping
 * §B2): the provider layer, the contract as tools, the system prompt and the
 * tool loop. Hosts (the app's transport, `ohhi ask`) build an `AgentHost` and
 * call `createHarnessAgent`; nothing here reads a clock, a timer or the
 * network except through the host.
 *
 * Browser note: `tools.ts` runs the `libs/agent` ops, so this entry pulls in
 * `@ohhi/agent`. `@ohhi/harness/model` is the provider layer alone, for a
 * surface that only needs a model (Settings › AI › Providers).
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
export { renderRefs, skillsCatalog, systemPrompt } from './prompt.js'
export { createHarnessAgent, errorText, MAX_STEPS, type HarnessAgent } from './agent.js'
export { editSpan, type EditSpan } from './edit-span.js'
export { HarnessTimeoutError, withTimeout } from './timeout.js'
