// @vitest-environment jsdom
/** The browser-storage note: the manager's note, the ask, and one reminder per session. */
import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import { box } from './shell-actions.fixture.svelte.js'
import { createStorageNote } from './storage-note.svelte.js'

function setup(warn = true) {
  const onManager = box(false)
  const state = box({ state: 'best-effort', refused: false })
  const storage = {
    ready: Promise.resolve(),
    get state() {
      return state.value
    },
    warning: vi.fn(() => warn),
    ask: vi.fn(async () => {
      state.value = { state: 'persisted', refused: false }
    }),
    setReminder: vi.fn(),
  }
  const note = createStorageNote({ onManager: () => onManager.value, hasOpfs: () => true, storage })
  return { note, onManager, storage }
}

describe('createStorageNote', () => {
  it('offers the ask while the browser may evict; a grant stays up to say so, and dismiss clears it', async () => {
    const { note, storage } = setup()
    expect(note.note).toEqual({ canAsk: true, outcome: null })
    note.keep()
    await vi.waitFor(() => expect(note.note).toEqual({ canAsk: false, outcome: 'granted' }))
    note.dismiss()
    expect(storage.setReminder).not.toHaveBeenCalled()
    note.dismiss()
    expect(storage.setReminder).toHaveBeenCalledWith(false)
  })

  it('reminds once per session, and never after the manager note was on screen', async () => {
    const first = setup()
    const notify = vi.fn()
    await first.note.remind(notify)
    await first.note.remind(notify)
    expect(notify).toHaveBeenCalledTimes(1)

    const second = setup()
    second.onManager.value = true
    flushSync()
    await second.note.remind(notify)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('says nothing when the browser keeps the storage, or the vault is gone by then', async () => {
    const quiet = setup(false)
    expect(quiet.note.note).toBeNull()
    const notify = vi.fn()
    await quiet.note.remind(notify)
    await setup().note.remind(notify, () => false)
    expect(notify).not.toHaveBeenCalled()
  })
})
