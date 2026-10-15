import { describe, expect, it } from 'vitest'
import { CommandRegistry } from './commands.js'
import { commandHint } from './command-hint.js'

describe('a bar button’s tooltip text', () => {
  it('the title and the key as bound now, in the readable keycap form', () => {
    const registry = new CommandRegistry(false)
    registry.register({ id: 'format.bold', title: 'Bold', keys: 'Mod+b', run: () => {} })
    expect(commandHint('Bold', registry.binding('format.bold'))).toBe('Bold · Ctrl+B')
  })
  it('an unbound command: the title alone', () => {
    expect(commandHint('Table', '')).toBe('Table')
  })
})
