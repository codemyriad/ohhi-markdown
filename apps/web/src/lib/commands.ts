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
 * muscle memory transfers (measured: 17 custom hotkeys in .obsidian/hotkeys.json)
 * — and every one of them is overridable (tab-groups R1.3, quiet-shell F10):
 * the registry merges the active KEYMAP FILE's resolved bindings over the
 * defaults (`keymap-spec.ts`; `[]` meaning "no key"). Before a vault is open
 * the legacy per-device `config.hotkeys` map stands in, as bindings through
 * the same `setKeymap` (`keymap.svelte.ts` is the one path that applies either).
 * Defaults for everything, then the user's own, is the whole policy.
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

const ARROW_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown'])

/**
 * How a binding is actually PRESSED off mac. On mac the string is literal —
 * Cmd is Mod, Ctrl is Ctrl — so this only answers for everywhere else, where
 * there is one Mod and it IS Ctrl.
 *
 * `Ctrl+Mod+X` (the shape Obsidian writes for a chord recorded on a Mac) has
 * nowhere to put its second modifier. Collapsing it onto plain Ctrl is what
 * Obsidian does, and it silently kills one of the two: Chris's `Ctrl+Mod+←`
 * (focus the pane left) and his `Mod+←` (toggle the sidebar) become the same
 * key, as do `Ctrl+Mod+-` (close other tabs) and `Mod+-` (previous daily
 * note). So the second modifier lands on **Alt** instead (tab-groups R1).
 *
 * **Except on the arrows.** `Ctrl+Alt+Arrows` is GNOME's workspace switcher
 * (verified on this machine: `org.gnome.desktop.wm.keybindings
 * switch-to-workspace-left/right/up/down` each list `<Control><Alt>` + the
 * arrow), so the event never reaches the page at all — the four
 * `workspace.focus-*` keys would be dead on Linux. There the chord drops Ctrl
 * and is pressed as `Alt+Arrow`, which no window manager claims; the app's
 * capture-phase handler takes it back from the browser's own back/forward,
 * and in-app back/forward is `Mod+[` / `Mod+]` anyway. The STORED string and
 * the mac chord are unchanged; Settings prints what is actually pressed.
 */
function offMacChord(b: ParsedBinding): { ctrl: boolean; alt: boolean } {
  if (!(b.ctrl && b.mod)) return { ctrl: b.ctrl || b.mod, alt: b.alt }
  return ARROW_KEYS.has(b.key) ? { ctrl: false, alt: true } : { ctrl: true, alt: true }
}

export function eventMatches(binding: ParsedBinding, e: KeyEventLike, mac: boolean): boolean {
  if (e.key.toLowerCase() !== binding.key) return false
  if (binding.shift !== e.shiftKey) return false
  // On mac, Mod is Cmd and Ctrl is a separate modifier.
  if (mac) return binding.alt === e.altKey && binding.mod === e.metaKey && binding.ctrl === e.ctrlKey
  const chord = offMacChord(binding)
  if (chord.alt !== e.altKey) return false
  return chord.ctrl === e.ctrlKey && !e.metaKey
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
      : // A named key reads as it is written on the keycap: `Enter`, not `enter`.
        parsed.key[0].toUpperCase() + parsed.key.slice(1)
  if (mac) {
    return `${parsed.ctrl ? '⌃' : ''}${parsed.alt ? '⌥' : ''}${parsed.shift ? '⇧' : ''}${parsed.mod ? '⌘' : ''}${key}`
  }
  // Printed as it is actually pressed here — see `offMacChord`.
  const chord = offMacChord(parsed)
  const mods = [chord.ctrl ? 'Ctrl' : '', chord.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '']
  return [...mods.filter(Boolean), key].join('+')
}

/**
 * Chords the desktop takes before a browser ever sees them. Measured, not
 * guessed: GNOME's `switch-to-workspace-*` on this machine. A default that
 * lands on one is dead, and a user who rebinds onto one deserves to be told
 * rather than to find out by pressing it — so Settings prints a hint.
 *
 * Compared against the chord as it is PRESSED (`formatBinding`), so the same
 * table answers for a default and for an override. Mac is left out: its own
 * reservations are Cmd-shaped and the OS surfaces them itself.
 */
const DESKTOP_RESERVED = new Set(['Ctrl+Alt+←', 'Ctrl+Alt+→', 'Ctrl+Alt+↑', 'Ctrl+Alt+↓'])

export function isDesktopReserved(keys: string, mac: boolean): boolean {
  if (mac || !keys) return false
  return DESKTOP_RESERVED.has(formatBinding(keys, mac))
}

/**
 * A user's per-device binding overrides: command id → binding, or `null` for
 * "this command has no key". Persisted in config (`config.hotkeys`), merged
 * over the defaults by the registry — Obsidian's `hotkeys.json`, R1.3.
 */
export type BindingOverrides = Record<string, string | null>

/**
 * Tolerant read of a stored override map. Anything that is not a parseable
 * binding string or an explicit `null` is dropped, so a hand-edited config
 * degrades to "the defaults" rather than to a command nobody can reach and
 * no screen can explain.
 */
export function normalizeOverrides(raw: unknown): BindingOverrides {
  const out: BindingOverrides = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    if (value === null) out[id] = null
    else if (typeof value === 'string' && parseBinding(value)) out[id] = value
  }
  return out
}

/**
 * The binding a key press describes, for the "record a shortcut" affordance
 * in Settings — the inverse of `eventMatches`. Null for a press that is only
 * modifiers (the user is still reaching for the key).
 *
 * Off mac there is one Mod, so a held Ctrl is recorded as `Mod`; on mac Cmd
 * is `Mod` and Ctrl is its own modifier, which is what makes `Ctrl+Mod+Left`
 * expressible there.
 */
export function bindingFromEvent(e: KeyEventLike, mac: boolean): string | null {
  const key = e.key
  if (!key || ['Control', 'Meta', 'Shift', 'Alt', 'OS', 'AltGraph', 'Dead'].includes(key)) return null
  const mod = mac ? e.metaKey : e.ctrlKey
  const ctrl = mac ? e.ctrlKey : false
  const parts = [ctrl ? 'Ctrl' : '', mod ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '']
  // A single character is stored lowercase (parseBinding lowercases anyway);
  // named keys keep their KeyboardEvent spelling so `ArrowLeft` stays legible.
  return [...parts.filter(Boolean), key.length === 1 ? key.toLowerCase() : key].join('+')
}

/** One row of the Settings › Keys table: what a command is bound to, and why. */
export interface CommandBinding {
  id: string
  title: string
  /** Palette/Settings grouping label; '' when the command declares none. */
  group: string
  /** The binding the command ships with; '' when it ships unbound. */
  defaultKeys: string
  /** `defaultKeys` rendered for a human; '' when it ships unbound. */
  defaultDisplay: string
  /** The binding in force, in the `Mod+Shift+K` form; '' when unbound. */
  keys: string
  /** `chords` rendered for a human (`⌘⇧P` / `Ctrl+Shift+P`, comma-joined); '' when unbound. */
  display: string
  /** Every chord in force (a keymap may bind several); `keys` is the first. */
  chords: string[]
  /** True when the user's override — not the default — produced `keys`. */
  overridden: boolean
  /**
   * Titles of the OTHER commands whose effective chord is this one. `match()`
   * silently prefers the later registration, so a collision is a command that
   * quietly stopped working — Settings says so rather than leaving it to be
   * discovered by pressing the key.
   */
  conflicts: string[]
  /** True when the desktop takes this chord before the app can see it. */
  reserved: boolean
}

/**
 * A source of commands whose SET changes with the app's state — one
 * `group.open:<id>` per saved tab group (tab-groups Fork 2-A). They cannot be
 * registered, because the ids come and go on every close and reopen.
 */
export type CommandProvider = () => Command[]

/**
 * Resolved keymap bindings (`keymap-spec.ts`): command id → the chords in
 * force, `[]` for unbound. An id that is absent keeps its default.
 */
export type ResolvedBindings = Readonly<Record<string, readonly string[]>>

/** Tolerant: an unparseable chord is dropped, never stored. */
function normalizeBindings(raw: ResolvedBindings): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [id, chords] of Object.entries(raw)) {
    if (!id || !Array.isArray(chords)) continue
    out[id] = chords.filter((c) => typeof c === 'string' && parseBinding(c) !== null)
  }
  return out
}

export class CommandRegistry {
  private commands = new Map<string, Command>()
  private providers: CommandProvider[] = []
  private keymap: Record<string, string[]> = {}
  /** True while Settings is RECORDING a chord: no key may run a command. */
  private suspended = false
  private readonly mac: boolean

  constructor(mac = isMac()) {
    this.mac = mac
  }

  /**
   * Replace the user's overrides with the ACTIVE keymap's resolved bindings
   * (quiet-shell F10): `[]` unbinds, several chords all match, an absent id
   * keeps its default.
   */
  setKeymap(bindings: ResolvedBindings): void {
    this.keymap = normalizeBindings(bindings)
  }

  /**
   * Suspend matching while a binding is being recorded in Settings.
   *
   * Global hotkeys are handled in the CAPTURE phase, so the shell sees the
   * chord before the field the user is pressing it into does — without this,
   * recording `Mod+W` would close the tab it is being bound to.
   */
  setSuspended(on: boolean): void {
    this.suspended = on
  }

  register(...commands: Command[]): void {
    for (const command of commands) this.commands.set(command.id, command)
  }

  /**
   * Add a source of state-dependent commands (the saved tab groups). They
   * show up in the palette and run by id, but take no part in `bindings()` or
   * `match()`: an id nobody can predict is an id nobody can bind.
   */
  addProvider(provider: CommandProvider): void {
    this.providers.push(provider)
  }

  private provided(): Command[] {
    return this.providers.flatMap((p) => p())
  }

  get(id: string): Command | undefined {
    return this.commands.get(id) ?? this.provided().find((c) => c.id === id)
  }

  /** Commands whose `when` guard passes, in registration order, providers last. */
  available(): Command[] {
    return [...this.commands.values(), ...this.provided()].filter((c) => !c.when || c.when())
  }

  /** The binding a command ships with, or '' when it ships unbound. */
  defaultKeys(id: string): string {
    return this.commands.get(id)?.keys ?? ''
  }

  /**
   * Every chord in force for a command: the keymap's when it names the id,
   * else the default. `[]` means unbound — the command ships without a key,
   * or the keymap cleared it. `keymap` previews a draft (Settings).
   */
  effectiveChords(id: string, keymap: ResolvedBindings = this.keymap): string[] {
    if (!this.commands.has(id)) return []
    if (Object.hasOwn(keymap, id)) return [...keymap[id]!]
    const keys = this.defaultKeys(id)
    return keys ? [keys] : []
  }

  /** The first chord in force, or '' when unbound. */
  effectiveKeys(id: string): string {
    return this.effectiveChords(id)[0] ?? ''
  }

  /** Display binding for a command (its first chord), or '' when unbound. */
  binding(id: string): string {
    const keys = this.effectiveKeys(id)
    return keys ? formatBinding(keys, this.mac) : ''
  }

  /**
   * The binding a key press describes, on THIS registry's platform — the
   * inverse of `match`, for Settings' "record a shortcut". Keeping it here
   * means one answer to "are we on a mac" for the whole app.
   */
  bindingFor(e: KeyEventLike): string | null {
    return bindingFromEvent(e, this.mac)
  }

  /** One chord as it is pressed on THIS registry's platform (`⌘⇧P` / `Ctrl+Shift+P`) — Settings' chips and chord search. */
  format(keys: string): string {
    return formatBinding(keys, this.mac)
  }

  /**
   * Every registered command as a Settings row, in registration order —
   * INCLUDING commands whose `when` guard is currently false and commands
   * that ship unbound. A guard says when a command can run, not whether the
   * user may bind it, and a key you cannot see is a key you cannot change.
   *
   * `keymap` previews a draft keymap instead of the one in force (Settings
   * shows an unsaved edit's conflicts before it is written).
   */
  bindings(keymap: ResolvedBindings = this.keymap): CommandBinding[] {
    const rows = [...this.commands.values()].map((c) => {
      const chords = this.effectiveChords(c.id, keymap)
      return {
        id: c.id,
        title: c.title,
        group: c.group ?? '',
        defaultKeys: c.keys ?? '',
        defaultDisplay: c.keys ? formatBinding(c.keys, this.mac) : '',
        keys: chords[0] ?? '',
        chords,
        display: chords.map((k) => formatBinding(k, this.mac)).join(', '),
        overridden: Object.hasOwn(keymap, c.id),
        conflicts: [] as string[],
        reserved: chords.some((k) => isDesktopReserved(k, this.mac)),
      }
    })
    // Grouped by the chord as it is PRESSED, not by the stored string: off mac
    // `Ctrl+Mod+X` and `Ctrl+Alt+X` are the same key press, and two commands on
    // them collide however differently they are written down.
    const byChord = new Map<string, CommandBinding[]>()
    for (const row of rows) {
      for (const pressed of new Set(row.chords.map((k) => formatBinding(k, this.mac)))) {
        const sharing = byChord.get(pressed)
        if (sharing) sharing.push(row)
        else byChord.set(pressed, [row])
      }
    }
    for (const sharing of byChord.values()) {
      if (sharing.length < 2) continue
      for (const row of sharing) {
        for (const other of sharing) {
          if (other !== row && !row.conflicts.includes(other.title)) row.conflicts.push(other.title)
        }
      }
    }
    return rows
  }

  /**
   * The command a key event triggers, or null.
   *
   * Later registrations win when two commands share a key, so a rebind is a
   * re-register rather than a removal. Guarded commands are skipped, not
   * matched-and-ignored — the key must fall through to the editor when the
   * command does not apply.
   */
  match(e: KeyEventLike): Command | null {
    if (this.suspended) return null
    let hit: Command | null = null
    for (const command of this.commands.values()) {
      const chords = this.effectiveChords(command.id)
      if (chords.length === 0) continue
      if (command.when && !command.when()) continue
      for (const keys of chords) {
        const parsed = parseBinding(keys)
        if (parsed && eventMatches(parsed, e, this.mac)) hit = command
      }
    }
    return hit
  }
}
