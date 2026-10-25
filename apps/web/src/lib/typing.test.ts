// @vitest-environment jsdom
/**
 * The typing aids on a real CM6 view: Settings › Editor's three switches
 * land on the content element as `spellcheck`, `autocorrect` and
 * `autocapitalize`, and a change reaches an open note in place (the same
 * view, the same content element — never a reopen).
 */
import { createMarkdownEditor, type MarkdownEditorHandle } from '@ohhi/editor'
import { afterEach, describe, expect, it } from 'vitest'
import { docWith } from './harness.fixture.js'
import { setTypingAid, typingState } from './typing.svelte.js'

let handle: MarkdownEditorHandle | null = null
afterEach(() => {
  handle?.destroy()
  handle = null
  document.body.replaceChildren()
  for (const key of ['spellcheck', 'autocorrect', 'autocapitalize'] as const) setTypingAid(key, true)
})

function mount(): MarkdownEditorHandle {
  const parent = document.createElement('div')
  document.body.append(parent)
  handle = createMarkdownEditor(parent, {
    doc: docWith('Some text'),
    awareness: null,
    user: { name: 'Tester', color: '#000' },
    typing: typingState.aids,
  })
  return handle
}

const attrs = (h: MarkdownEditorHandle): (string | null)[] =>
  ['spellcheck', 'autocorrect', 'autocapitalize'].map((a) => h.view.contentDOM.getAttribute(a))

describe('typing aids on the editor', () => {
  it('are on by default: spelling, autocorrect, sentence capitals', () => {
    expect(attrs(mount())).toEqual(['true', 'on', 'sentences'])
  })

  it('a change in Settings reaches the open view in place', () => {
    const h = mount()
    const content = h.view.contentDOM
    setTypingAid('spellcheck', false)
    h.setTyping(typingState.aids)
    expect(attrs(h)).toEqual(['false', 'on', 'sentences'])
    setTypingAid('autocorrect', false)
    setTypingAid('autocapitalize', false)
    h.setTyping(typingState.aids)
    expect(attrs(h)).toEqual(['false', 'off', 'off'])
    expect(h.view.contentDOM).toBe(content)
  })
})
