// @vitest-environment jsdom
/**
 * The selection handle's items (selection explorations, shape B): Comment |
 * Ask, each a registry command; Ask only while its guard (a provider)
 * passes; a press runs the command and keeps the editor's focus.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { getLL } from '@ohhi/i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../commands.js'
import SelectionBar from './SelectionBar.svelte'

afterEach(() => cleanup())

function setup(opts: { ai: boolean; form?: 'fine' | 'coarse' }) {
  const comment = vi.fn()
  const ask = vi.fn()
  const registry = new CommandRegistry(false)
  registry.register(
    { id: 'note.comment', title: 'Comment on selection', run: comment },
    { id: 'ai.ask-selection', title: 'Ask about this', run: ask, when: () => opts.ai }
  )
  const view = { hasFocus: true, focus: vi.fn() } as never
  render(SelectionBar, { props: { ids: ['note.comment', 'ai.ask-selection'], registry, form: opts.form ?? 'fine', view } })
  return { comment, ask, view: view as { focus: ReturnType<typeof vi.fn> } }
}

describe('SelectionBar', () => {
  const t = getLL().web.toolbar

  it('with a provider: Comment | Ask, a named toolbar with a divider between', async () => {
    const { comment, ask } = setup({ ai: true })
    const bar = screen.getByRole('toolbar', { name: t.selection_group() })
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([t.selection_comment(), t.selection_ask()])
    expect(bar.querySelectorAll('[role="separator"]')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: t.selection_ask() }))
    expect(ask).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: t.selection_comment() }))
    expect(comment).toHaveBeenCalledOnce()
  })

  it('without a provider: Comment alone — nothing AI-shaped', () => {
    setup({ ai: false })
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([t.selection_comment()])
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('a pointer press keeps the editor’s focus (mousedown is not the button’s)', () => {
    setup({ ai: true })
    const button = screen.getByRole('button', { name: t.selection_comment() })
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('each item’s tooltip names its command and key', async () => {
    const user = userEvent.setup()
    const comment = vi.fn()
    const registry = new CommandRegistry(false)
    registry.register({ id: 'note.comment', title: 'Comment on selection', keys: 'Mod+Shift+M', run: comment })
    render(SelectionBar, { props: { ids: ['note.comment'], registry, form: 'fine', view: { hasFocus: true, focus: vi.fn() } as never } })
    const button = screen.getByRole('button', { name: t.selection_comment() })
    await user.hover(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Comment on selection · Ctrl+Shift+M')
  })
})
