import { describe, expect, it } from 'vitest'
import { parseAppParams } from './params.js'

function memStore(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    },
  }
}

describe('parseAppParams — ?layout=', () => {
  it('a valid choice holds for the tab, past the URL clean-up, until a pick clears it', () => {
    const store = memStore()
    // `dense` is the example file now (round 3, Q6): the fixtures' boot still resolves to it.
    expect(parseAppParams(new URLSearchParams('layout=dense'), store).layout.get()).toBe('custom:dense')
    // The shell drops the query after boot; a reload in the same tab still has it.
    const again = parseAppParams(new URLSearchParams(''), store)
    expect(again.layout.get()).toBe('custom:dense')
    again.layout.clear()
    expect(again.layout.get()).toBeNull()
    expect(parseAppParams(new URLSearchParams(''), store).layout.get()).toBeNull()
  })

  it('ignores what is not a layout choice', () => {
    const store = memStore()
    expect(parseAppParams(new URLSearchParams('layout=../x'), store).layout.get()).toBeNull()
    expect(parseAppParams(new URLSearchParams('layout=custom:writing'), store).layout.get()).toBe('custom:writing')
    expect(parseAppParams(new URLSearchParams('mode=memory'), null).layout.get()).toBeNull()
  })
})
