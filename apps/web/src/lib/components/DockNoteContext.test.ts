// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { fakeViewShell } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import DockNoteContext from './DockNoteContext.svelte'

const t = getLL().web.rail.note
const NOTE = 'Competitors/untitled-3.md'

afterEach(cleanup)

describe('DockNoteContext', () => {
  it('names the focused note, its folder muted after it', () => {
    render(DockNoteContext, {
      props: { note: { path: NOTE, lastFocused: false } },
      context: viewShellContext(fakeViewShell()),
    })
    const go = screen.getByRole('button', { name: t.go({ name: 'untitled-3' }) })
    expect(go.textContent).toContain('untitled-3')
    expect(go.textContent).toContain('Competitors')
    expect(screen.getByRole('group', { name: t.label() })).toBeTruthy()
    expect(screen.queryByTestId('dock-note-last')).toBeNull()
  })

  it('says "last focused" while a session pane has the focus', () => {
    render(DockNoteContext, {
      props: { note: { path: NOTE, lastFocused: true } },
      context: viewShellContext(fakeViewShell()),
    })
    expect(screen.getByTestId('dock-note-last').textContent).toContain(t.last_focused())
    expect(screen.getByTestId('dock-note').dataset.lastFocused).toBe('true')
  })

  it('a click goes to the note: the pane holding it, else opened beside', async () => {
    const shell = fakeViewShell()
    render(DockNoteContext, { props: { note: { path: NOTE, lastFocused: true } }, context: viewShellContext(shell) })
    await userEvent.setup().click(screen.getByRole('button', { name: t.go({ name: 'untitled-3' }) }))
    expect(shell.openPath).toHaveBeenCalledWith(NOTE, { beside: true })
  })

  it('draws nothing before a note has been focused', () => {
    render(DockNoteContext, { props: { note: null }, context: viewShellContext(fakeViewShell()) })
    expect(screen.queryByTestId('dock-note')).toBeNull()
  })
})
