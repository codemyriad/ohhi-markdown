import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig, setPaneHints } from './config.js'
import { paneHints } from './pane-hints.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'

beforeEach(() => {
  useMemStorage()
  paneHints.reload()
})
afterEach(dropStorage)

describe('paneHints — the reactive setting every surface reads (E6)', () => {
  it('starts at the device’s value, Subtle by default', () => {
    expect(paneHints.value).toBe('subtle')
    setPaneHints('off')
    paneHints.reload()
    expect(paneHints.value).toBe('off')
  })
  it('set() changes the value and writes device config', () => {
    paneHints.set('full')
    expect(paneHints.value).toBe('full')
    expect(loadConfig().paneHints).toBe('full')
  })
})
