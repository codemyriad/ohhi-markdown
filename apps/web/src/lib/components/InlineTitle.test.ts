// @vitest-environment jsdom
/**
 * The inline title (foundations round 2, P3): a heading named by the note,
 * editable as a field; Enter / blur rename, Escape reverts, Tab and ↓ leave
 * for the note's first line, a refused name goes back. The rename itself —
 * its checks and its journaled write — is `file-actions`' (tested there).
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import InlineTitle from './InlineTitle.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function setup(path = 'notes/Weekly plan.md', rename: (name: string) => Promise<string | null> = async (n) => `notes/${n}.md`) {
  const onRename = vi.fn(rename)
  const onExit = vi.fn()
  const view = render(InlineTitle, { props: { path, onRename, onExit } })
  const field = screen.getByTestId('inline-title-input') as HTMLInputElement
  return { onRename, onExit, field, view, user: userEvent.setup() }
}

describe('InlineTitle', () => {
  it('is a level-1 heading showing the basename without .md, named for what it is', () => {
    const { field } = setup()
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(field)
    expect(field.value).toBe('Weekly plan')
    expect(field).toHaveAccessibleName(getLL().web.note.inline_title())
    expect(field.tagName).toBe('INPUT')
    expect(screen.getByTestId('inline-title').closest('[contenteditable]')).toBeNull()
  })

  it('Enter renames with the new name (no extension) and moves into the note', async () => {
    const { field, onRename, onExit, user } = setup()
    await user.click(field)
    await user.clear(field)
    await user.type(field, 'Monthly plan{Enter}')
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onRename).toHaveBeenCalledWith('Monthly plan')
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('blur renames too, once — a blur after Enter does not rename again', async () => {
    const { field, onRename, user } = setup()
    await user.click(field)
    await user.clear(field)
    await user.type(field, 'Other')
    field.blur()
    await vi.waitFor(() => expect(onRename).toHaveBeenCalledWith('Other'))
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('Escape puts the name back and renames nothing', async () => {
    const { field, onRename, user } = setup()
    await user.click(field)
    await user.type(field, ' draft{Escape}')
    expect(field.value).toBe('Weekly plan')
    field.blur()
    await Promise.resolve()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('Tab and ArrowDown leave for the first line without renaming an unchanged title', async () => {
    const { field, onRename, onExit, user } = setup()
    await user.click(field)
    await user.keyboard('{ArrowDown}')
    expect(onExit).toHaveBeenCalledTimes(1)
    await user.click(field)
    await user.keyboard('{Tab}')
    expect(onExit).toHaveBeenCalledTimes(2)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('an empty or whitespace title is no rename: the name comes back', async () => {
    const { field, onRename, user } = setup()
    await user.click(field)
    await user.clear(field)
    await user.type(field, '   {Enter}')
    expect(onRename).not.toHaveBeenCalled()
    expect(field.value).toBe('Weekly plan')
  })

  it('a refused name reverts and keeps the caret in the title', async () => {
    const { field, onRename, onExit, user } = setup('a.md', async () => null)
    await user.click(field)
    await user.clear(field)
    await user.type(field, 'b{Enter}')
    expect(onRename).toHaveBeenCalledWith('b')
    expect(field.value).toBe('a')
    expect(onExit).not.toHaveBeenCalled()
  })

  it('follows a rename made elsewhere while it is not being edited', async () => {
    const { field, view } = setup('notes/a.md')
    await view.rerender({ path: 'notes/renamed in tree.md' })
    expect(field.value).toBe('renamed in tree')
  })
})
