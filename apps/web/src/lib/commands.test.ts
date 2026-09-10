/**
 * The command registry, tested without a DOM.
 *
 * These bindings are Chris's actual Obsidian hotkeys, so "does Mod+ArrowLeft
 * resolve on both platforms" is a real behavioural question, not a formality:
 * on mac Mod is Cmd and Ctrl is a separate modifier, everywhere else `Ctrl+Mod`
 * would mean Ctrl twice.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  CommandRegistry,
  bindingFromEvent,
  eventMatches,
  formatBinding,
  isMac,
  normalizeOverrides,
  parseBinding,
  type KeyEventLike,
} from './commands.js'

const key = (over: Partial<KeyEventLike> & { key: string }): KeyEventLike => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})

describe('parseBinding', () => {
  it('parses modifiers in any order', () => {
    expect(parseBinding('Mod+Shift+P')).toEqual({
      key: 'p',
      mod: true,
      shift: true,
      alt: false,
      ctrl: false,
    })
    expect(parseBinding('Shift+Mod+P')).toEqual(parseBinding('Mod+Shift+P'))
  })

  it('parses a bare key and a symbol key', () => {
    expect(parseBinding('Escape')?.key).toBe('escape')
    expect(parseBinding('Mod+,')?.key).toBe(',')
    expect(parseBinding('Alt+=')).toMatchObject({ key: '=', alt: true })
  })

  it('rejects an unknown modifier rather than silently binding it', () => {
    expect(parseBinding('Hyper+P')).toBeNull()
  })

  it('rejects an empty binding', () => {
    expect(parseBinding('')).toBeNull()
  })
})

describe('eventMatches', () => {
  const b = (s: string) => parseBinding(s)!

  it('maps Mod to Cmd on mac and Ctrl elsewhere', () => {
    expect(eventMatches(b('Mod+o'), key({ key: 'o', metaKey: true }), true)).toBe(true)
    expect(eventMatches(b('Mod+o'), key({ key: 'o', ctrlKey: true }), true)).toBe(false)
    expect(eventMatches(b('Mod+o'), key({ key: 'o', ctrlKey: true }), false)).toBe(true)
    expect(eventMatches(b('Mod+o'), key({ key: 'o', metaKey: true }), false)).toBe(false)
  })

  it('is case-insensitive on the key', () => {
    expect(eventMatches(b('Mod+o'), key({ key: 'O', ctrlKey: true }), false)).toBe(true)
  })

  it('does not fire a plain binding when a modifier is held', () => {
    expect(eventMatches(b('Mod+o'), key({ key: 'o', ctrlKey: true, shiftKey: true }), false)).toBe(
      false
    )
  })

  it("matches Obsidian's unrebound Ctrl+Tab on both platforms", () => {
    // Off mac Ctrl IS Mod, so a Ctrl-only binding must not also demand that
    // Mod be absent — that contradiction made Ctrl+Tab unmatchable (R1).
    expect(eventMatches(b('Ctrl+Tab'), key({ key: 'Tab', ctrlKey: true }), false)).toBe(true)
    expect(eventMatches(b('Ctrl+Tab'), key({ key: 'Tab', ctrlKey: true }), true)).toBe(true)
    expect(
      eventMatches(b('Ctrl+Shift+Tab'), key({ key: 'Tab', ctrlKey: true, shiftKey: true }), false)
    ).toBe(true)
    expect(eventMatches(b('Ctrl+Tab'), key({ key: 'Tab', metaKey: true }), true)).toBe(false)
  })

  it('gives Ctrl+Mod its own chord off mac instead of shadowing Mod', () => {
    // Cmd+Ctrl on mac; Ctrl+Alt everywhere else, so that Chris's
    // `Ctrl+Mod+←` (focus a pane) and his `Mod+←` (toggle a sidebar) stay two
    // different keys on Linux, as they are on the machine they came from.
    expect(
      eventMatches(
        b('Ctrl+Mod+ArrowLeft'),
        key({ key: 'ArrowLeft', ctrlKey: true, metaKey: true }),
        true
      )
    ).toBe(true)
    expect(
      eventMatches(b('Ctrl+Mod+ArrowLeft'), key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }), false)
    ).toBe(true)
    expect(
      eventMatches(b('Ctrl+Mod+ArrowLeft'), key({ key: 'ArrowLeft', ctrlKey: true }), false)
    ).toBe(false)
    expect(eventMatches(b('Mod+ArrowLeft'), key({ key: 'ArrowLeft', ctrlKey: true }), false)).toBe(
      true
    )
    expect(
      eventMatches(b('Mod+ArrowLeft'), key({ key: 'ArrowLeft', ctrlKey: true, altKey: true }), false)
    ).toBe(false)
    expect(formatBinding('Ctrl+Mod+ArrowLeft', false)).toBe('Ctrl+Alt+←')
  })
})

describe('CommandRegistry', () => {
  it('matches a bound key and returns the command', () => {
    const run = vi.fn()
    const registry = new CommandRegistry(false)
    registry.register({ id: 'a', title: 'A', keys: 'Mod+o', run })
    expect(registry.match(key({ key: 'o', ctrlKey: true }))?.id).toBe('a')
    expect(registry.match(key({ key: 'o' }))).toBeNull()
  })

  it('lets a later registration rebind the same key', () => {
    const registry = new CommandRegistry(false)
    registry.register({ id: 'a', title: 'A', keys: 'Mod+o', run: () => {} })
    registry.register({ id: 'b', title: 'B', keys: 'Mod+o', run: () => {} })
    expect(registry.match(key({ key: 'o', ctrlKey: true }))?.id).toBe('b')
  })

  it('lets a guarded-off command fall through to the editor', () => {
    const registry = new CommandRegistry(false)
    registry.register({ id: 'a', title: 'A', keys: 'Mod+o', run: () => {}, when: () => false })
    expect(registry.match(key({ key: 'o', ctrlKey: true }))).toBeNull()
    expect(registry.available()).toEqual([])
  })

  it('reports a display binding, and nothing for an unbound command', () => {
    const registry = new CommandRegistry(false)
    registry.register({ id: 'a', title: 'A', keys: 'Mod+Shift+p', run: () => {} })
    registry.register({ id: 'b', title: 'B', run: () => {} })
    expect(registry.binding('a')).toBe('Ctrl+Shift+P')
    expect(registry.binding('b')).toBe('')
  })
})

describe('binding overrides (R1.3)', () => {
  const registry = (): CommandRegistry => {
    const r = new CommandRegistry(false)
    r.register(
      { id: 'a', title: 'A', group: 'Pane', keys: 'Mod+o', run: () => {} },
      { id: 'b', title: 'B', group: 'Pane', run: () => {} }
    )
    return r
  }

  it('lets an override win over the default, for matching and for display', () => {
    const r = registry()
    r.setOverrides({ a: 'Alt+=' })
    expect(r.match(key({ key: '=', altKey: true }))?.id).toBe('a')
    expect(r.match(key({ key: 'o', ctrlKey: true }))).toBeNull()
    expect(r.binding('a')).toBe('Alt+=')
  })

  it('binds a command that ships without a key', () => {
    const r = registry()
    r.setOverrides({ b: 'Mod+Shift+g' })
    expect(r.match(key({ key: 'g', ctrlKey: true, shiftKey: true }))?.id).toBe('b')
    expect(r.binding('b')).toBe('Ctrl+Shift+G')
  })

  it('unbinds on null — the key falls through to the editor', () => {
    const r = registry()
    r.setOverrides({ a: null })
    expect(r.match(key({ key: 'o', ctrlKey: true }))).toBeNull()
    expect(r.binding('a')).toBe('')
    expect(r.bindings()[0]).toMatchObject({ keys: '', defaultKeys: 'Mod+o', overridden: true })
  })

  it('restores the default when the override is dropped', () => {
    const r = registry()
    r.setOverrides({ a: 'Alt+=' })
    r.setOverrides({})
    expect(r.match(key({ key: 'o', ctrlKey: true }))?.id).toBe('a')
    expect(r.bindings()[0].overridden).toBe(false)
  })

  it('ignores an unparseable override and keeps the default', () => {
    const r = registry()
    r.setOverrides({ a: 'Hyper+K', b: 42, c: 'Mod+j' })
    expect(r.match(key({ key: 'o', ctrlKey: true }))?.id).toBe('a')
    expect(r.binding('a')).toBe('Ctrl+O')
    // An override for a command nobody registered is kept in the map (the
    // command may register later) but resolves to nothing today.
    expect(r.effectiveKeys('c')).toBe('')
  })

  it('lists every registered command, guarded-off ones included', () => {
    const r = registry()
    r.register({ id: 'c', title: 'C', keys: 'Mod+k', run: () => {}, when: () => false })
    expect(r.bindings().map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(r.available().map((cmd) => cmd.id)).toEqual(['a', 'b'])
    expect(r.bindings()[1]).toMatchObject({ id: 'b', group: 'Pane', keys: '', display: '' })
  })

  it('sees a command registered after the overrides were set', () => {
    const r = registry()
    r.setOverrides({ later: 'Mod+9' })
    r.register({ id: 'later', title: 'Later', run: () => {} })
    expect(r.match(key({ key: '9', ctrlKey: true }))?.id).toBe('later')
  })

  it('records a chord on its own platform, so Settings never re-decides', () => {
    const mac = new CommandRegistry(true)
    expect(registry().bindingFor(key({ key: 'k', ctrlKey: true }))).toBe('Mod+k')
    expect(mac.bindingFor(key({ key: 'k', ctrlKey: true }))).toBe('Ctrl+k')
  })

  it('matches nothing at all while a chord is being recorded', () => {
    const r = registry()
    r.setSuspended(true)
    expect(r.match(key({ key: 'o', ctrlKey: true }))).toBeNull()
    r.setSuspended(false)
    expect(r.match(key({ key: 'o', ctrlKey: true }))?.id).toBe('a')
  })
})

describe('normalizeOverrides', () => {
  it('keeps parseable strings and explicit nulls, drops the rest', () => {
    expect(normalizeOverrides({ a: 'Mod+o', b: null, c: 'Hyper+K', d: 7, '': 'Mod+p' })).toEqual({
      a: 'Mod+o',
      b: null,
    })
  })

  it('reads a missing or garbage map as no overrides', () => {
    expect(normalizeOverrides(undefined)).toEqual({})
    expect(normalizeOverrides('nope')).toEqual({})
  })
})

describe('bindingFromEvent', () => {
  it('round-trips through parseBinding, so what is recorded is what matches', () => {
    const e = key({ key: 'W', ctrlKey: true, shiftKey: true })
    const binding = bindingFromEvent(e, false)!
    expect(binding).toBe('Mod+Shift+w')
    expect(eventMatches(parseBinding(binding)!, e, false)).toBe(true)
  })

  it('separates Cmd from Ctrl on mac and collapses them elsewhere', () => {
    expect(bindingFromEvent(key({ key: 'ArrowLeft', metaKey: true, ctrlKey: true }), true)).toBe(
      'Ctrl+Mod+ArrowLeft'
    )
    expect(bindingFromEvent(key({ key: 'ArrowLeft', ctrlKey: true }), false)).toBe('Mod+ArrowLeft')
  })

  it('waits through a modifier-only press', () => {
    expect(bindingFromEvent(key({ key: 'Control', ctrlKey: true }), false)).toBeNull()
    expect(bindingFromEvent(key({ key: 'Shift', shiftKey: true }), false)).toBeNull()
  })
})

describe('formatBinding', () => {
  it('uses mac glyphs on mac and words elsewhere', () => {
    expect(formatBinding('Mod+Shift+p', true)).toBe('⇧⌘P')
    expect(formatBinding('Mod+Shift+p', false)).toBe('Ctrl+Shift+P')
  })

  it('renders arrow keys as arrows', () => {
    expect(formatBinding('Mod+ArrowLeft', true)).toBe('⌘←')
  })
})

describe('isMac', () => {
  it('reads the platform string', () => {
    expect(isMac('MacIntel')).toBe(true)
    expect(isMac('Linux x86_64')).toBe(false)
  })
})
