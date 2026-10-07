/**
 * A keymap world for tests (quiet-shell F10): a fake vault's app files, the
 * real resource loader over it, the real `createKeymap` applying to a real
 * registry, and a config stand-in for `hotkeys` / `keymap.active`.
 */
import { CommandRegistry, normalizeOverrides, type BindingOverrides } from './commands.js'
import type { KeymapChoice } from './keymap-spec.js'
import { createKeymap } from './keymap.svelte.js'
import { createResources } from './resources.svelte.js'
import { fakeVault } from './resources.fixture.js'

export interface KeymapWorldOptions {
  /** The vault's app files; null = no vault open. */
  vault?: Record<string, unknown> | null
  /** `config.hotkeys` before boot. */
  hotkeys?: BindingOverrides
  active?: KeymapChoice
  registry?: CommandRegistry
  /** `clearLegacy` silently does nothing — localStorage refused the write. */
  clearFails?: boolean
}

export function keymapWorld(opts: KeymapWorldOptions = {}) {
  let v = opts.vault === null ? null : fakeVault(opts.vault ?? {})
  const config = { hotkeys: normalizeOverrides(opts.hotkeys ?? {}), active: opts.active ?? ('default' as KeymapChoice) }
  const warnings: { name: string; error: string; kind?: string }[] = []
  const notices: unknown[] = []
  const registry = opts.registry ?? new CommandRegistry(false)
  const resources = createResources({
    vault: () => v?.vault ?? null,
    userRoot: async () => null,
    warn: (name, error, kind) => warnings.push({ name, error, kind }),
  })
  const keymap = createKeymap({
    resources,
    hasVault: () => v !== null,
    legacy: () => config.hotkeys,
    clearLegacy: () => {
      if (!opts.clearFails) config.hotkeys = {}
    },
    choice: () => config.active,
    setChoice: (c) => (config.active = c),
    apply: (bindings) => registry.setKeymap(bindings),
    migrated: (r) => notices.push(r),
  })
  return {
    registry,
    resources,
    keymap,
    config,
    warnings,
    notices,
    get disk() {
      return v?.disk
    },
    get writes() {
      return v?.writes ?? []
    },
    get vault() {
      return v?.vault ?? null
    },
    /** Open a vault (the fixture's "boot"). */
    open(files: Record<string, unknown> = {}) {
      v = fakeVault(files)
    },
  }
}
