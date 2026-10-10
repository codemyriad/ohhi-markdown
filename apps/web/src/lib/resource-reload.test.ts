/**
 * "A file changed under you" (settings-shaping ST6): when a reload is worth
 * saying, the words the toast and the Log share, and the one toast.
 */
import { getLL } from '@ohhi/i18n'
import { describe, expect, it, vi } from 'vitest'
import { announceReload, reloadedFile, reloadText, type ReloadSide } from './resource-reload.js'
import type { ToastData } from './ui/toaster.js'

const entry = { name: 'focus', root: 'vault' as const, path: '.ohhi/layouts/focus.json', shadows: [] }
const side = (over: Partial<ReloadSide> = {}): ReloadSide => ({
  choice: 'custom:focus',
  entry,
  error: null,
  content: 'a',
  ...over,
})

describe('reloadedFile', () => {
  it('a change or a reload that alters the same choice is said, naming the file and its root', () => {
    for (const why of ['change', 'reload'] as const) {
      expect(reloadedFile('layouts', side(), side({ content: 'b' }), why)).toEqual({
        kind: 'layouts',
        name: 'focus',
        file: 'focus.json',
        root: 'vault',
      })
    }
  })

  it('is silent on a vault opening, a pick, no difference, no before, and a fallback', () => {
    const after = side({ content: 'b' })
    expect(reloadedFile('layouts', side(), after, 'open')).toBeNull()
    expect(reloadedFile('layouts', side(), after, undefined)).toBeNull()
    expect(reloadedFile('layouts', side({ choice: 'default' }), after, 'change')).toBeNull()
    expect(reloadedFile('layouts', side(), side(), 'change')).toBeNull()
    expect(reloadedFile('layouts', null, after, 'change')).toBeNull()
    expect(reloadedFile('layouts', side(), side({ content: 'b', error: 'bad', entry: null }), 'change')).toBeNull()
  })

  it('a built-in is named by its name', () => {
    const builtin = { name: 'default', root: 'builtin' as const, path: 'built-in', shadows: [] }
    const f = reloadedFile('keymaps', side({ choice: 'default' }), side({ choice: 'default', entry: builtin, content: 'b' }), 'change')
    expect(f).toMatchObject({ file: 'default', root: 'builtin' })
  })
})

describe('reloadText', () => {
  const LL = getLL()
  it('says the kind, the file and where it came from', () => {
    expect(reloadText(LL, { kind: 'layouts', name: 'focus', file: 'focus.json', root: 'vault' })).toBe(
      'Layout focus.json reloaded from this vault'
    )
    expect(reloadText(LL, { kind: 'keymaps', name: 'mine', file: 'mine.json', root: 'user' })).toBe(
      'Keymap mine.json reloaded from your config folder'
    )
    expect(reloadText(LL, { kind: 'keymaps', name: 'default', file: 'default', root: 'builtin' })).toBe(
      'Keymap default reloaded: the built-in one is in use'
    )
  })
})

describe('announceReload', () => {
  const f = { kind: 'layouts' as const, name: 'focus', file: 'focus.json', root: 'vault' as const }

  it('logs an info notice and toasts once; without Undo, Show is the one button', () => {
    const toasts: ToastData[] = []
    const notify = vi.fn()
    announceReload({ notify, toast: (d) => void toasts.push(d), openSettings: vi.fn() }, f, null)
    expect(notify).toHaveBeenCalledWith({ level: 'info', code: 'resource_reloaded', params: f })
    expect(toasts).toEqual([
      { level: 'info', title: 'Layout focus.json reloaded from this vault', action: { label: 'Show', run: expect.any(Function) } },
    ])
  })

  it('no host to open Settings: no Show', () => {
    const toasts: ToastData[] = []
    announceReload({ toast: (d) => void toasts.push(d) }, f, null)
    expect(toasts[0]!.action).toBeUndefined()
    expect(toasts[0]!.secondary).toBeUndefined()
  })

  it('Undo runs once and says what it did — or why it could not', async () => {
    const toasts: ToastData[] = []
    const undo = vi.fn(async () => 'done')
    announceReload({ toast: (d) => void toasts.push(d) }, f, undo)
    expect(toasts[0]!.description).toBe('Undo goes back to the layout you had, for this session. The file is not changed.')
    toasts[0]!.action!.run()
    toasts[0]!.action!.run()
    await Promise.resolve()
    await Promise.resolve()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(toasts[1]).toEqual({ level: 'info', title: 'done' })

    const failing: ToastData[] = []
    announceReload({ toast: (d) => void failing.push(d) }, f, async () => {
      throw new Error('moved on')
    })
    failing[0]!.action!.run()
    await Promise.resolve()
    await Promise.resolve()
    expect(failing[1]).toEqual({ level: 'error', title: 'Could not undo: moved on' })
  })
})
