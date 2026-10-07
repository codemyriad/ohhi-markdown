/**
 * The keymap file (quiet-shell F10): parse, `extends` with cycle protection,
 * `[]` unbinding, and the shapes the migration and Settings write.
 */
import { describe, expect, it } from 'vitest'
import { CommandRegistry } from './commands.js'
import {
  KEYMAP_SCHEMA_ID,
  KeymapDocSchema,
  KeymapError,
  keymapFile,
  overridesToBindings,
  parseKeymap,
  parseKeymapChoice,
  resolveKeymap,
  type KeymapFile,
} from './keymap-spec.js'

const $schema = KEYMAP_SCHEMA_ID
const file = (bindings: KeymapFile['bindings'], ext?: string): KeymapFile => ({
  $schema,
  ...(ext ? { extends: ext } : {}),
  bindings,
})

describe('parseKeymap', () => {
  it('reads a chord, a list and an unbinding', () => {
    const r = parseKeymap(
      JSON.stringify({ $schema, extends: 'default', bindings: { 'daily.next': 'Alt+ArrowRight', 'nav.quick-open': ['Mod+o', 'Mod+k'], 'format.bold': [] } })
    )
    expect(r.ok).toBe(true)
  })
  it('refuses what it cannot read, saying where', () => {
    expect(parseKeymap('{')).toMatchObject({ ok: false, error: expect.stringMatching(/not JSON/) })
    expect(parseKeymap({ $schema: 'ohhi.layout.v1', bindings: {} })).toMatchObject({ ok: false })
    expect(parseKeymap({ $schema, bindings: { 'nav.back': 'Hyper+K' } })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^bindings\.nav\.back/),
    })
    expect(parseKeymap({ $schema, bindings: {}, extra: 1 })).toMatchObject({ ok: false })
  })
  it('loads an id this build does not know (a newer file); the documented schema names the typo', () => {
    expect(parseKeymap({ $schema, bindings: { 'future.thing': 'Mod+j' } }).ok).toBe(true)
    expect(KeymapDocSchema.safeParse({ $schema, bindings: { 'future.thing': 'Mod+j' } }).success).toBe(false)
    expect(KeymapDocSchema.safeParse({ $schema, bindings: { 'daily.next': 'Alt+ArrowRight' } }).success).toBe(true)
  })
})

describe('resolveKeymap', () => {
  it('layers parents first, this file over them, per command id', () => {
    const files = {
      base: file({ 'nav.back': 'Alt+b', 'tab.close': ['Mod+w', 'Alt+w'] }, 'default'),
    }
    expect(resolveKeymap(file({ 'nav.back': [], 'daily.next': 'Alt+ArrowRight' }, 'base'), files, 'mine')).toEqual({
      'nav.back': [],
      'tab.close': ['Mod+w', 'Alt+w'],
      'daily.next': ['Alt+ArrowRight'],
    })
  })
  it('default is built in and overrides nothing', () => {
    expect(resolveKeymap(file({}, 'default'))).toEqual({})
  })
  it('refuses a cycle, an unknown parent and a self-extend', () => {
    const files = { a: file({}, 'b'), b: file({}, 'a') }
    expect(() => resolveKeymap(files.a, files, 'a')).toThrow(/cycle/)
    expect(() => resolveKeymap(file({}, 'nowhere'))).toThrow(KeymapError)
    expect(() => resolveKeymap(file({}, 'me'), { me: file({}, 'me') }, 'me')).toThrow(/cycle/)
  })
})

describe('a keymap with [] unbinds in the registry — and so in the palette (Stage 6 gate)', () => {
  it('clears the default key; several chords all match; an absent id keeps its default', () => {
    const r = new CommandRegistry(false)
    r.register(
      { id: 'format.bold', title: 'Bold', keys: 'Mod+b', run: () => {} },
      { id: 'daily.next', title: 'Next', keys: 'Mod+=', run: () => {} },
      { id: 'nav.back', title: 'Back', keys: 'Mod+[', run: () => {} }
    )
    r.setKeymap(resolveKeymap(file({ 'format.bold': [], 'daily.next': ['Alt+ArrowRight', 'Alt+l'] }, 'default')))
    const press = (key: string, mods: { ctrl?: boolean; alt?: boolean } = {}) =>
      r.match({ key, ctrlKey: !!mods.ctrl, metaKey: false, shiftKey: false, altKey: !!mods.alt })?.id ?? null
    expect(press('b', { ctrl: true })).toBeNull()
    // The palette's hint is `binding(id)`: nothing to show for an unbound command.
    expect(r.binding('format.bold')).toBe('')
    expect(press('ArrowRight', { alt: true })).toBe('daily.next')
    expect(press('l', { alt: true })).toBe('daily.next')
    expect(press('=', { ctrl: true })).toBeNull()
    expect(r.binding('daily.next')).toBe('Alt+→')
    expect(press('[', { ctrl: true })).toBe('nav.back')
    const row = r.bindings().find((b) => b.id === 'daily.next')!
    expect(row.chords).toEqual(['Alt+ArrowRight', 'Alt+l'])
    expect(row.display).toBe('Alt+→, Alt+L')
    expect(row.overridden).toBe(true)
  })
  it('a shared chord is a conflict on either side', () => {
    const r = new CommandRegistry(false)
    r.register({ id: 'a', title: 'A', run: () => {} }, { id: 'b', title: 'B', keys: 'Alt+x', run: () => {} })
    r.setKeymap({ a: ['Mod+j', 'Alt+x'] })
    expect(r.bindings().map((b) => [b.id, b.conflicts])).toEqual([
      ['a', ['B']],
      ['b', ['A']],
    ])
  })
})

describe('the shapes Settings and the migration write', () => {
  it('config.hotkeys → bindings → a short file', () => {
    const bindings = overridesToBindings({ 'tab.close': 'Mod+Shift+w', 'nav.back': null })
    expect(bindings).toEqual({ 'tab.close': ['Mod+Shift+w'], 'nav.back': [] })
    expect(keymapFile({ ...bindings, 'x.y': ['Mod+1', 'Mod+2'] }, 'default')).toEqual({
      $schema,
      extends: 'default',
      bindings: { 'nav.back': [], 'tab.close': 'Mod+Shift+w', 'x.y': ['Mod+1', 'Mod+2'] },
    })
  })
  it('a choice is default or custom:<name>', () => {
    expect(parseKeymapChoice('default')).toBe('default')
    expect(parseKeymapChoice('custom:device')).toBe('custom:device')
    expect(parseKeymapChoice('custom:../x')).toBeNull()
    expect(parseKeymapChoice(3)).toBeNull()
  })
})
