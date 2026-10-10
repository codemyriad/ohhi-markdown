/**
 * The AI settings as the views read them: `config.ts`'s `aiConfig` /
 * `aiEnabled`, made reactive. Every read depends on a version that
 * `setAiConfig` here bumps, so a view showing "no provider", a provider
 * picker or the composer follows a provider being added, edited or removed
 * without a reload. Every web read and write of the AI config goes through
 * this module; `config.ts` stays the storage.
 */
import type { AiConfig } from '@ohhi/harness'
import { aiConfig as readAiConfig, setAiConfig as writeAiConfig } from './config.js'

let version = $state(0)

/** The stored AI config (reactive). */
export function aiConfig(): AiConfig {
  void version
  return readAiConfig()
}

/** The quiet default: the app has an AI surface exactly when a provider exists (reactive). */
export function aiEnabled(): boolean {
  return aiConfig().providers.length > 0
}

/** Store the AI config and tell every reader. */
export function setAiConfig(ai: AiConfig): void {
  writeAiConfig(ai)
  version++
}

/** The config changed underneath (another tab, a test's `localStorage.clear()`): re-read. */
export function aiConfigChanged(): void {
  version++
}
