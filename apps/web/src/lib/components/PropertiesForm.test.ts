// @vitest-environment jsdom
/**
 * The properties form on a row-note (bases-shaping A7): one typed row per
 * entry, an edit as ONE patch of the document's current text handed to the
 * editor, the keys as doors into the YAML, nothing writable in Reading.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropertiesEditor, TextChange } from '@ohhi/editor-lang'
import { MemoryIndex, type IndexDoc } from '@ohhi/index'
import { fakeViewShell } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import type { Workspace } from '../workspace.svelte.js'
import PropertiesForm from './PropertiesForm.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const flushEffects = () => new Promise<void>((r) => setTimeout(r, 0))

const BLOCK = '---\nthreat: direct\nactive: true\nscore: 8\nverified: 2026-06-02\ntags:\n  - a\n  - b\nlink: "[[Clusters]]"\n---'
const BODY = '\n\n# Ingredifind\n'

function setup(over: { text?: string; editable?: boolean } = {}) {
  /** The document the widget's editor sees: the form patches it, the edits land on it. */
  let doc = (over.text ?? BLOCK) + BODY
  const apply = vi.fn((changes: readonly TextChange[]) => {
    for (const c of [...changes].sort((a, b) => b.from - a.from)) doc = doc.slice(0, c.from) + c.insert + doc.slice(c.to)
    return true
  })
  const editor: PropertiesEditor = { text: () => doc, apply, enter: vi.fn(), undo: vi.fn(() => true), redo: vi.fn(() => true) }
  const flash = vi.fn()
  const workspace = { flash } as unknown as Workspace
  const index = new MemoryIndex()
  index.rebuild(
    ['Competitors/Quiteful.md', 'Competitors/Stale.md'].map(
      (path): IndexDoc => ({ guid: path, path, text: `---\nthreat: ${path.includes('Stale') ? 'direct' : 'adjacent'}\n---\n` })
    )
  )
  const propertyValues = vi.spyOn(index, 'propertyValues')
  const shell = fakeViewShell(Date.UTC(2026, 6, 1), { index: () => index })
  const rendered = render(PropertiesForm, {
    props: { workspace, path: 'Competitors/Ingredifind.md', text: over.text ?? BLOCK, editable: over.editable ?? true, editor },
    context: viewShellContext(shell),
  })
  return { editor, apply, flash, propertyValues, doc: () => doc, rerender: rendered.rerender }
}

describe('PropertiesForm', () => {
  it('draws one typed row per entry, named after the note', () => {
    setup()
    expect(screen.getByRole('group', { name: 'Properties of Ingredifind' })).toBeInTheDocument()
    expect(screen.getAllByTestId(/^property-key:/).map((el) => el.textContent?.trim())).toEqual(['threat', 'active', 'score', 'verified', 'tags', 'link'])
    expect(screen.getByTestId('property:threat')).toHaveTextContent('direct')
    expect(screen.getByTestId('property:threat')).toHaveAccessibleName('Edit threat of Ingredifind')
    // A boolean is its checkbox; a number, a date and a list draw as the table draws them.
    expect(screen.getByTestId('property:active')).toBeChecked()
    expect(screen.getByTestId('property:score')).toHaveTextContent('8')
    expect(screen.getByTestId('property:tags')).toHaveTextContent('a, b')
    expect(screen.getByTestId('property:link')).toHaveTextContent('Clusters')
  })

  it('a text edit is ONE patch of the current document, handed to the editor', async () => {
    const { apply, doc } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('property:threat'))
    const input = screen.getByTestId('property:threat:input')
    await user.clear(input)
    await user.type(input, 'adjacent{Enter}')
    expect(apply).toHaveBeenCalledTimes(1)
    // One value's bytes moved; every other line is byte-identical.
    expect(doc()).toBe(BLOCK.replace('threat: direct', 'threat: adjacent') + BODY)
  })

  it('a checkbox writes true/false; a number stays a number', async () => {
    const { doc } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('property:active'))
    expect(doc()).toContain('active: false\n')
    await user.click(screen.getByTestId('property:score'))
    const input = screen.getByTestId('property:score:input')
    await user.clear(input)
    await user.type(input, '9{Enter}')
    expect(doc()).toContain('score: 9\n')
  })

  it('offers the vault’s values for a text key as suggestions', async () => {
    setup()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('property:threat'))
    await waitFor(() => {
      const values = [...document.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value)
      expect(values).toEqual(expect.arrayContaining(['adjacent', 'direct']))
    })
  })

  it('a key, the gutter and “Edit as YAML” put the caret in the block', async () => {
    const { editor } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit score as YAML' }))
    expect(editor.enter).toHaveBeenLastCalledWith(3)
    await user.click(screen.getByRole('button', { name: 'Edit as YAML' }))
    expect(editor.enter).toHaveBeenLastCalledWith(0)
    await user.click(screen.getByTestId('properties-gutter'))
    expect(editor.enter).toHaveBeenCalledTimes(3)
  })

  it('in Reading everything is text: no door into the YAML, no editors, no checkbox', () => {
    setup({ editable: false })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByTestId('properties-gutter')).toBeNull()
    expect(screen.getByTestId('property-key:threat').tagName).toBe('SPAN')
    expect(screen.getByTestId('property:threat').tagName).toBe('SPAN')
    expect(screen.getByTestId('property:threat')).toHaveTextContent('direct')
    expect(screen.getByTestId('property:active')).toHaveTextContent('true')
  })

  it('Mod+Z and Mod+Shift+Z from a cell reach the document’s history; an open text field keeps its own', async () => {
    const { editor } = setup()
    const user = userEvent.setup()
    screen.getByTestId('property:threat').focus()
    await user.keyboard('{Control>}z{/Control}')
    expect(editor.undo).toHaveBeenCalledTimes(1)
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(editor.redo).toHaveBeenCalledTimes(1)
    await user.keyboard('{Control>}y{/Control}')
    expect(editor.redo).toHaveBeenCalledTimes(2)
    // The checkbox is a cell too; a key button is in the form as well.
    screen.getByTestId('property:active').focus()
    await user.keyboard('{Meta>}z{/Meta}')
    expect(editor.undo).toHaveBeenCalledTimes(2)
    // Inside an open text field the chord is the field's own draft undo.
    await user.click(screen.getByTestId('property:threat'))
    await user.keyboard('{Control>}z{/Control}')
    expect(editor.undo).toHaveBeenCalledTimes(2)
  })

  it('asks the index for suggestions once per set of text keys, not per change', async () => {
    const { propertyValues, rerender } = setup()
    await waitFor(() => expect(propertyValues).toHaveBeenCalledTimes(1))
    // A value changes (an edit, a peer): the same keys, no second ask.
    await rerender({ text: BLOCK.replace('threat: direct', 'threat: adjacent') })
    await flushEffects()
    expect(propertyValues).toHaveBeenCalledTimes(1)
    // A new text key appears: asked again, for both.
    await rerender({ text: BLOCK.replace('threat: direct', 'threat: direct\nowner: Ana') })
    await waitFor(() => expect(propertyValues).toHaveBeenCalledTimes(3))
  })

  it('follows the block when the document changes under it', async () => {
    const { rerender } = setup()
    await rerender({ text: BLOCK.replace('threat: direct', 'threat: adjacent') })
    expect(screen.getByTestId('property:threat')).toHaveTextContent('adjacent')
  })

  it('refuses, and says why, when the text has gone outside the flat subset since it was drawn', async () => {
    const { apply, flash, editor } = setup()
    // A peer nests the block between the draw and the edit.
    ;(editor as { text: () => string }).text = () => '---\nthreat:\n  nested: true\n---\n'
    const user = userEvent.setup()
    await user.click(screen.getByTestId('property:threat'))
    await user.type(screen.getByTestId('property:threat:input'), 'x{Enter}')
    expect(apply).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', path: 'Competitors/Ingredifind.md' }))
  })
})
