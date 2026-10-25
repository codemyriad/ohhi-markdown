// @vitest-environment jsdom
/**
 * Settings › Editor's typing aids: three switches, on by default, each
 * applied at once (the shared store every open editor reads) and kept in
 * this device's config.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { getLL } from '@ohhi/i18n'
import { afterEach, describe, expect, it } from 'vitest'
import type { CommandRegistry } from '../commands.js'
import { typingPrefs } from '../config.js'
import { setTypingAid, typingState } from '../typing.svelte.js'
import EditorSettings from './EditorSettings.svelte'

const t = getLL().web.settings.editor
const registry = { binding: () => '' } as unknown as CommandRegistry

afterEach(() => {
  cleanup()
  for (const key of ['spellcheck', 'autocorrect', 'autocapitalize'] as const) setTypingAid(key, true)
})

describe('Settings › Editor, typing aids', () => {
  it('shows all three, on by default', () => {
    render(EditorSettings, { registry })
    for (const label of [t.spellcheck(), t.autocorrect(), t.autocapitalize()]) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked()
    }
  })

  it('a switch applies at once and persists on this device', async () => {
    const user = userEvent.setup()
    render(EditorSettings, { registry })
    await user.click(screen.getByRole('checkbox', { name: t.spellcheck() }))
    expect(typingState.aids.spellcheck).toBe(false)
    expect(typingPrefs()).toEqual({ spellcheck: false, autocorrect: true, autocapitalize: true })
    await user.click(screen.getByRole('checkbox', { name: t.autocapitalize() }))
    expect(typingPrefs().autocapitalize).toBe(false)
    expect(screen.getByRole('checkbox', { name: t.autocorrect() })).toBeChecked()
  })
})
