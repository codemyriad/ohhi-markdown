// @vitest-environment jsdom
/**
 * The embedded page's script (decision 1): one iframe of the web build in the
 * innermost `#content`, the query passed through, the nested chrome undone.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EMBED_FRAME_PATH, fillNestedContent, frameSrc, mountFrame, mountTarget } from './embed-frame.js'

const NESTED = '<div id="content" class="app-app_api"><div id="content"><p>placeholder</p></div></div>'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('embed frame', () => {
  it('passes the launch parameters (fileIds, open) to the iframe, and nothing else', () => {
    expect(frameSrc('')).toBe(EMBED_FRAME_PATH)
    expect(frameSrc('?')).toBe(EMBED_FRAME_PATH)
    expect(frameSrc('?fileIds=42&open=a%2Fb.md')).toBe(`${EMBED_FRAME_PATH}?fileIds=42&open=a%2Fb.md`)
    expect(frameSrc('fileIds=42')).toBe(`${EMBED_FRAME_PATH}?fileIds=42`)
    expect(frameSrc('?mode=memory&relay=ws%3A%2F%2Fevil&fileIds=7&x=1')).toBe(`${EMBED_FRAME_PATH}?fileIds=7`)
    expect(frameSrc('?mode=memory')).toBe(EMBED_FRAME_PATH)
  })

  it('mounts into the innermost #content and fills the outer one', () => {
    document.body.innerHTML = NESTED
    const [outer, inner] = Array.from(document.querySelectorAll<HTMLElement>('#content'))
    expect(mountTarget(document)).toBe(inner)
    const frame = mountFrame(document, '?fileIds=7')
    expect(frame.parentElement).toBe(inner)
    expect(inner!.children).toHaveLength(1) // the placeholder is gone
    expect(frame.getAttribute('src')).toBe(`${EMBED_FRAME_PATH}?fileIds=7`)
    expect(frame.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(frame.getAttribute('style')).toContain('border:0')
    expect(frame.getAttribute('style')).toContain('width:100%')
    expect(frame.getAttribute('style')).toContain('height:100%')
    expect(inner!.style.position).toBe('absolute')
    expect(inner!.style.inset).toMatch(/^0(px)?$/)
    expect(outer!.style.position).toBe('')
  })

  it('is idempotent', () => {
    document.body.innerHTML = NESTED
    const a = mountFrame(document, '')
    const b = mountFrame(document, '?x=1')
    expect(b).toBe(a)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })

  it('leaves a single #content as Nextcloud styles it, and falls back to <body>', () => {
    document.body.innerHTML = '<div id="content"></div>'
    const only = document.getElementById('content')!
    expect(fillNestedContent(document, only)).toBe(false)
    mountFrame(document, '')
    expect(only.querySelector('iframe')).not.toBeNull()
    expect(only.style.position).toBe('')

    document.body.innerHTML = ''
    const frame = mountFrame(document, '')
    expect(frame.parentElement).toBe(document.body)
  })
})
