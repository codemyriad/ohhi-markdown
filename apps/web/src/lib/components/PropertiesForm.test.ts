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

const BLOCK = '---\nthreat: direct\nactive: true\nscore: 8\nverified: 2026-06-02\ntags:\n  - a\n  - b\nlink: "[[Clusters]]"\n---'
const BODY = '\n\n# Ingredifind\n'

function setup(over: { text?: string; editable?: boolean } = {}) {
  /** The document the widget's editor sees: the form patches it, the edits land on it. */
  let doc = (over.text ?? BLOCK) + BODY
  const apply = vi.fn((changes: readonly TextChange[]) => {
    for (const c of [...changes].sort((a, b) => b.from - a.from)) doc = doc.slice(0, c.from) + c.insert + doc.slice(c.to)
    return true
  })
  const editor: PropertiesEditor = { text: () => doc, apply, enter: vi.fn() }
  const flash = vi.fn()
  const workspace = { flash } as unknown as Workspace
  const index = new MemoryIndex()
  index.rebuild(
    ['Competitors/Quiteful.md', 'Competitors/Stale.md'].map(
      (path): IndexDoc => ({ guid: path, path, text: `---\nthreat: ${path.includes('Stale') ? 'direct' : 'adjacent'}\n---\n` })
    )
  )
  const shell = fakeViewShell(Date.UTC(2026, 6, 1), { index: () => index })
  const rendered = render(PropertiesForm, {
    props: { workspace, path: 'Competitors/Ingredifind.md', text: over.text ?? BLOCK, editable: over.editable ?? true, editor },
    context: viewShellContext(shell),
  })
  return { editor, apply, flash, doc: () => doc, rerender: rendered.rerender }
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

  it('in Reading the keys are text and there is no door into the YAML — the cells still edit', async () => {
    const { doc } = setup({ editable: false })
    expect(screen.queryByRole('button', { name: /as YAML/ })).toBeNull()
    expect(screen.queryByTestId('properties-gutter')).toBeNull()
    expect(screen.getByTestId('property-key:threat').tagName).toBe('SPAN')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('property:active'))
    expect(doc()).toContain('active: false\n')
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
