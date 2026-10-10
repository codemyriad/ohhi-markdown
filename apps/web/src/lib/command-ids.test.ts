/**
 * `COMMAND_IDS` is the command table as data (quiet-shell F10/F16): the
 * generated schemas and `docs/customising.md` enumerate it. This builds every
 * real table through `installShellCommands`, the way App.svelte does, and
 * asserts the two agree — a command added to a table but not to the list (or
 * the reverse) fails here, not in an agent's hands.
 */
import { describe, expect, it, vi } from 'vitest'
import { COMMAND_IDS } from './command-ids.js'
import { CommandRegistry } from './commands.js'
import { formatCommands, groupCommands, paneCommands, tableCommands } from './pane-commands.js'
import { readCommands } from './read.svelte.js'
import { PRESETS } from './layout-spec.js'
import { installShellCommands } from './shell-commands.js'

/** Every action is a no-op: only the ids matter here. */
const noop = new Proxy({}, { get: () => () => false }) as never

function registeredIds(): string[] {
  return shellRegistry().bindings().map((b) => b.id)
}

function shellRegistry(mac = false): CommandRegistry {
  const registry = new CommandRegistry(mac)
  installShellCommands({
    registry,
    openPalette: vi.fn(),
    panes: {
      commands: () => paneCommands(noop),
      readCommands: () => readCommands(noop),
      formatCommands: () => formatCommands(noop),
      tableCommands: () => tableCommands(noop),
      travel: vi.fn(),
      handleKey: () => false,
    },
    groups: { commands: () => groupCommands(noop), savedCommands: () => [] },
    daily: { openToday: vi.fn(async () => {}), step: vi.fn(), steps: { prev: null, next: null } },
    fileOps: { createNote: vi.fn(async () => {}), op: null },
    sharing: { addShareOpen: null, folderSharePath: null },
    mounts: () => [],
    layout: { treeOpen: true, railOpen: false, spec: PRESETS.default },
    selectedPath: () => null,
    hasWorkspace: () => true,
    inWorkspace: () => true,
    claimed: () => false,
    openDeviceLink: vi.fn(),
    openView: vi.fn(),
    devtools: () => true,
    reloadResources: vi.fn(),
    focusMode: { active: () => false, toggle: vi.fn(), leave: vi.fn() },
    templates: { commands: () => [] },
    help: { run: vi.fn(), menuMounted: () => true },
  })
  return registry
}

describe('COMMAND_IDS', () => {
  it('is exactly the set of ids the shell registers (providers aside)', () => {
    const ids = registeredIds()
    expect([...ids].sort()).toEqual([...COMMAND_IDS].sort())
  })
  it('has no duplicates', () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length)
  })
})

describe('the default keys', () => {
  it('no two commands share a default chord, on a Mac or off one (E6 picked free ones)', () => {
    for (const mac of [false, true]) {
      const clashes = shellRegistry(mac)
        .bindings()
        .filter((b) => b.conflicts.length > 0)
        .map((b) => `${b.id} (${b.display}) ↔ ${b.conflicts.join(', ')}`)
      expect(clashes).toEqual([])
    }
  })
})
