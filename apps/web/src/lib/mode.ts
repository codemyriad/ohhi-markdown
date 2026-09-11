/**
 * The pane mode — Zellij's leader-then-letters, as a pure reducer
 * (tab-groups-shaping B12, Fork 6-A).
 *
 * ~30 pane/tab/group verbs will not fit on chords, so one leader (`Mod+P`)
 * enters *pane* mode, single letters act, and `m`/`s`/`t`/`g` open sub-modes.
 * *pane*, *tab* and *group* are one-shot — an action returns you to typing;
 * *move* and *resize* are sticky, because you press `h h h`. Unknown letters
 * do nothing and keep the mode, so a typo never leaks a keystroke into the
 * editor.
 *
 * The tables ARE the command table (B7): every value is a registry command id,
 * so the mode, the palette and the flat bindings can never disagree. No
 * strings live here — `hints` asks the caller for every label, which is what
 * keeps the hint bar translatable (the ids it asks for are listed on `hints`).
 */
export type Mode = 'pane' | 'move' | 'resize' | 'tab' | 'group'

export interface ModeTable {
  /** Sticky modes survive an action and leave only on Escape/Enter. */
  sticky: boolean
  /** key → command id. */
  keys: Record<string, string>
  /** key → sub-mode to enter. */
  subs?: Record<string, Mode>
}

/** `h j k l` for the four directions, in Vim's order. */
function dirKeys(prefix: string): Record<string, string> {
  return { h: `${prefix}left`, j: `${prefix}down`, k: `${prefix}up`, l: `${prefix}right` }
}

const GOTO: Record<string, string> = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `tab.goto-${n}`])
)

export const MODES: Record<Mode, ModeTable> = {
  pane: {
    sticky: false,
    keys: {
      n: 'workspace.split-auto',
      d: 'workspace.split-down',
      r: 'workspace.split-right',
      x: 'workspace.close-pane',
      f: 'workspace.zoom',
      p: 'workspace.focus-next',
      w: 'workspace.rotate',
      ...dirKeys('workspace.focus-'),
    },
    subs: { m: 'move', s: 'resize', t: 'tab', g: 'group' },
  },
  move: { sticky: true, keys: dirKeys('workspace.move-') },
  resize: {
    sticky: true,
    keys: { ...dirKeys('workspace.resize-'), '=': 'workspace.equalize' },
  },
  tab: {
    sticky: false,
    keys: {
      n: 'tab.new',
      x: 'tab.close',
      '[': 'tab.prev',
      ']': 'tab.next',
      p: 'tab.pin',
      c: 'workspace.close-others',
      r: 'tab.reopen',
      ...dirKeys('tab.move-'),
      ...GOTO,
    },
  },
  group: {
    sticky: false,
    keys: {
      n: 'group.new',
      f: 'group.toggle',
      x: 'group.close',
      c: 'group.copy-links',
      u: 'group.ungroup',
      // A whole group moves by chip drag; `h j k l` is its keyboard
      // equivalent, the same four letters every other family uses (R8).
      ...dirKeys('group.move-'),
    },
  },
}

/** Arrows are the same keys for anyone who has not learned hjkl yet. */
const ARROWS: Record<string, string> = {
  ArrowLeft: 'h',
  ArrowDown: 'j',
  ArrowUp: 'k',
  ArrowRight: 'l',
}

/** A modifier pressed on its own is not a key press yet. */
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'])

/**
 * One key in a live mode. Escape and Enter leave; a sub-mode key enters it; a
 * bound key runs its command and leaves unless the mode is sticky; anything
 * else keeps the mode and does nothing.
 *
 * `key` is a `KeyboardEvent.key` — matching is exact, so `Shift+D` is not `d`.
 */
export function step(mode: Mode | null, key: string): { mode: Mode | null; command?: string } {
  if (!mode) return { mode: null }
  if (MODIFIERS.has(key)) return { mode }
  if (key === 'Escape' || key === 'Enter') return { mode: null }
  const table = MODES[mode]
  const k = ARROWS[key] ?? key
  const sub = table.subs?.[k]
  if (sub) return { mode: sub }
  const command = table.keys[k]
  if (!command) return { mode }
  return { mode: table.sticky ? mode : null, command }
}

export interface Hint {
  /** What to print on the keycap: one key, `h j k l`, or `1–9`. */
  key: string
  label: string
  /** True when this row enters a sub-mode; `label` came from a `mode.*` id. */
  sub?: boolean
  /**
   * The command ids this row stands for — several for a collapsed family, none
   * for a sub-mode row. The bar's host uses them to drop a row whose commands
   * are all currently refused by their `when` guard: a hint for a key that
   * does nothing is worse than no hint.
   */
  ids: string[]
}

/**
 * The hint bar's rows for a live mode, in table order, with the four
 * directions collapsed onto one `h j k l` row and go-to-tab onto `1–9` — the
 * bar has to fit on one line.
 *
 * `titleOf` is asked for three kinds of id: a command id
 * (`workspace.split-down`), a **family** id for a collapsed row
 * (`workspace.focus`, `workspace.move`, `workspace.resize`, `tab.move`,
 * `tab.goto`), and a **mode** id for a sub-mode row (`mode.move`,
 * `mode.resize`, `mode.tab`, `mode.group`). The registry holds the first; the
 * dictionary holds the other two.
 */
export function hints(mode: Mode, titleOf: (id: string) => string): Hint[] {
  const table = MODES[mode]
  const families = new Map<string, string[]>()
  for (const [key, id] of Object.entries(table.keys)) {
    const fam = familyOf(key, id)
    if (!fam) continue
    const keys = families.get(fam)
    if (keys) keys.push(key)
    else families.set(fam, [key])
  }
  const done = new Set<string>()
  const out: Hint[] = []
  for (const [key, id] of Object.entries(table.keys)) {
    const fam = familyOf(key, id)
    if (!fam) {
      out.push({ key, label: titleOf(id), ids: [id] })
      continue
    }
    if (done.has(fam)) continue
    done.add(fam)
    const keys = families.get(fam) ?? [key]
    out.push({ key: capsFor(keys), label: titleOf(fam), ids: keys.map((k) => table.keys[k]) })
  }
  for (const [key, sub] of Object.entries(table.subs ?? {})) {
    out.push({ key, label: titleOf(`mode.${sub}`), sub: true, ids: [] })
  }
  return out
}

/**
 * `workspace.focus-left` → `workspace.focus`; `tab.goto-3` → `tab.goto`.
 * Keyed on the KEY as well as the id: `workspace.split-down` sits on `d`, not
 * on `j`, so it is its own row rather than a direction.
 */
function familyOf(key: string, id: string): string | null {
  const dir = /^[hjkl]$/.test(key) && /-(?:left|down|up|right)$/.test(id)
  const digit = /^[1-9]$/.test(key) && /-[1-9]$/.test(id)
  if (!dir && !digit) return null
  return id.replace(/-(?:left|down|up|right|[1-9])$/, '')
}

/** A run of digits prints as a range; anything else as spaced keycaps. */
function capsFor(keys: string[]): string {
  const digits = keys.every((k) => /^[0-9]$/.test(k))
  return digits && keys.length > 2 ? `${keys[0]}–${keys[keys.length - 1]}` : keys.join(' ')
}
