// @vitest-environment jsdom
/**
 * The tree as a DRAG SOURCE (shell-polish P1.2). Arranging files inside the
 * tree is `tree-model.ts`'s job and tested there; what is asserted here is the
 * one thing only the component knows — which rows offer themselves to a PANE.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileRow } from '../workspace.svelte.js'
import FileTree from './FileTree.svelte'

afterEach(cleanup)

const FILES: FileRow[] = [
  { path: 'notes', guid: 'g-dir', kind: 'dir' },
  { path: 'notes/welcome.md', guid: 'g-welcome', kind: 'text' },
  { path: 'notes/logo.png', guid: 'g-logo', kind: 'binary' },
]

function show(): void {
  render(FileTree, {
    files: FILES,
    records: {},
    selected: null,
    mounts: [],
    rootShared: false,
    onSelect: vi.fn(),
    onOp: vi.fn(),
    onNotice: vi.fn(),
  })
}

/** The types a row's `dragstart` puts on the transfer, in the order it set them. */
function dragTypes(row: HTMLElement): string[] {
  const types: string[] = []
  const event = new Event('dragstart', { bubbles: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: { setData: (type: string) => types.push(type), effectAllowed: '' },
  })
  row.dispatchEvent(event)
  return types
}

describe('FileTree as a drag source', () => {
  it('offers a note to a pane, and a folder or a binary only to the tree', () => {
    show()
    // `application/x-editor-path` is the discriminator a pane reads during
    // `dragover`, where the payload itself is unreadable (P1.2).
    expect(dragTypes(screen.getByTestId('file-item:notes/welcome.md'))).toEqual([
      'text/plain',
      'application/x-editor-path',
    ])
    // A folder and a binary have no doc to open: a tab for one would sit in
    // the strip under its name showing the empty launcher. They stay ordinary
    // tree drags — which is what moves them between folders.
    expect(dragTypes(screen.getByTestId('dir-item:notes'))).toEqual(['text/plain'])
    expect(dragTypes(screen.getByTestId('file-item:notes/logo.png'))).toEqual(['text/plain'])
  })
})
