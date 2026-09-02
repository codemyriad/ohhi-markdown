/**
 * Command registry + keybinding resolver.
 *
 * The registry is the point, not the palette. Editor's V2 command surface is
 * ~20 commands, not Obsidian's ~300, so a palette over it is thin value — but
 * this is where daily notes, pane focus, back/forward and sidebar toggles get
 * bound, and it is the precondition for slash commands later. Building it
 * properly now is the reason those are cheap later.
 *
 * Bindings default to the ones Chris has actually rebound in Obsidian, so the
 * muscle memory transfers (measured: 17 custom hotkeys in .obsidian/hotkeys.json).
 *
 * Pure and DOM-free so it is unit-testable without a browser (parent R6): the
 * component layer only calls `matchBinding` with a real KeyboardEvent's fields
 * and runs whatever comes back.
 */

export interface Command {
  id: string
  title: string
  /** Grouping label for the palette, e.g. 'Navigate'. */
  group?: string
  /** Default binding, in the `Mod+Shift+K` form. Mod = Cmd on mac, Ctrl elsewhere. */
  keys?: string
  run: () => void | Promise<void>
  /** Optional guard; a command that returns false is hidden and unbound. */
  when?: () => boolean
}

export interface ParsedBinding {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
  /** Ctrl as a modifier IN ADDITION to Mod (the `Ctrl+Mod+Left` shape). */
  ctrl: boolean
}

/**
 * `Mod+Shift+P`, `Alt+=`, `Ctrl+Mod+ArrowLeft`. Case-insensitive on the
 * modifier names; the final segment is the key, compared case-insensitively
 * against KeyboardEvent.key.
 */
export function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.split('+').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase())
  if (mods.some((m) => !['mod', 'shift', 'alt', 'ctrl'].includes(m))) return null
  return {
    key: key.toLowerCase(),
    mod: mods.includes('mod'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt'),
    ctrl: mods.includes('ctrl'),
  }
}

/** The subset of KeyboardEvent this module needs — keeps it DOM-free. */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function eventMatches(binding: ParsedBinding, e: KeyEventLike, mac: boolean): boolean {
  if (e.key.toLowerCase() !== binding.key) return false
  const modDown = mac ? e.metaKey : e.ctrlKey
  if (binding.mod !== modDown) return false
  if (binding.shift !== e.shiftKey) return false
  if (binding.alt !== e.altKey) return false
  // On mac, Mod is Cmd and Ctrl is a separate modifier; elsewhere `Ctrl+Mod`
  // would mean Ctrl twice, so it collapses into Mod.
  const wantCtrl = mac ? binding.ctrl : binding.ctrl || binding.mod
  const haveCtrl = e.ctrlKey
  return wantCtrl === haveCtrl
}

export function isMac(platform = globalThis.navigator?.platform ?? ''): boolean {
  return /mac|iphone|ipad/i.test(platform)
}

/** Human-readable binding for the palette, e.g. `⌘⇧P` / `Ctrl+Shift+P`. */
export function formatBinding(binding: string, mac: boolean): string {
  const parsed = parseBinding(binding)
  if (!parsed) return binding
  const key = parsed.key.startsWith('arrow')
    ? { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓' }[parsed.key] ?? parsed.key
    : parsed.key.length === 1
      ? parsed.key.toUpperCase()
      : parsed.key
  if (mac) {
    return `${parsed.ctrl ? '⌃' : ''}${parsed.alt ? '⌥' : ''}${parsed.shift ? '⇧' : ''}${parsed.mod ? '⌘' : ''}${key}`
  }
  const mods = [parsed.mod || parsed.ctrl ? 'Ctrl' : '', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '']
  return [...mods.filter(Boolean), key].join('+')
}

export class CommandRegistry {
  private commands = new Map<string, Command>()
  private readonly mac: boolean

  constructor(mac = isMac()) {
    this.mac = mac
  }

  register(...commands: Command[]): void {
    for (const command of commands) this.commands.set(command.id, command)
  }

  get(id: string): Command | undefined {
    return this.commands.get(id)
  }

  /** Commands whose `when` guard passes, in registration order. */
  available(): Command[] {
    return [...this.commands.values()].filter((c) => !c.when || c.when())
  }

  /** Display binding for a command, or '' when unbound. */
  binding(id: string): string {
    const keys = this.commands.get(id)?.keys
    return keys ? formatBinding(keys, this.mac) : ''
  }

  /**
   * The command a key event triggers, or null.
   *
   * Later registrations win, so a rebind is a re-register rather than a
   * removal. Guarded commands are skipped, not matched-and-ignored — the key
   * must fall through to the editor when the command does not apply.
   */
  match(e: KeyEventLike): Command | null {
    let hit: Command | null = null
    for (const command of this.commands.values()) {
      if (!command.keys) continue
      if (command.when && !command.when()) continue
      const parsed = parseBinding(command.keys)
      if (parsed && eventMatches(parsed, e, this.mac)) hit = command
    }
    return hit
  }
}
