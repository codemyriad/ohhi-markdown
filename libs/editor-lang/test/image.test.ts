/**
 * `![alt](src)` in Live and Reading (editor-usability E5): a local picture is
 * the `![[ ]]` widget with its alt text; a remote one is never fetched on open
 * — a click-to-load placeholder, or a link when the host cannot load it.
 */
import { describe, expect, it } from 'vitest'
import { buildBlockPreview, buildInlinePreview } from '../src/preview/build.js'
import { imageHost, imageSource, RemoteImageWidget } from '../src/preview/image.js'
import type { EmbedWidget } from '../src/preview/widgets.js'
import { decorations, makeState, testHost } from './support.js'

const loader = testHost({ loadRemoteImage: async () => null })

describe('imageSource', () => {
  it.each([
    ['shot.png', 'local'],
    ['Attachments/My%20shot.JPG', 'local'],
    ['<my shot.png>', 'local'],
    ['../img/x.webp?v=2', 'local'],
    ['https://example.com/a.png', 'remote'],
    ['http://example.com/a', 'remote'],
    ['data:image/png;base64,AAAA', 'none'],
    ['file:///etc/x.png', 'none'],
    ['//cdn.example.com/x.png', 'none'],
    ['paper.pdf', 'none'],
    ['', 'none'],
  ])('%s → %s', (src, kind) => {
    expect(imageSource(src)).toBe(kind)
  })

  it('names the host of a remote picture', () => {
    expect(imageHost('https://i.imgur.com/x.png')).toBe('i.imgur.com')
    expect(imageHost('not a url')).toBe('')
  })
})

describe('a local ![alt](src)', () => {
  it('on a line of its own is the embed block, with the alt text and the markdown form', () => {
    const decos = decorations(makeState('text\n\n![A chart](img/chart.png)\n', { at: 0 }))
    const embed = decos.find((d) => d.value === 'EmbedWidget')
    expect(embed?.kind).toBe('block-widget')
    const widget = embed?.widget as EmbedWidget
    expect(widget.name).toBe('img/chart.png')
    expect(widget.alt).toBe('A chart')
    expect(widget.form).toBe('markdown')
  })

  it('inside a sentence stays inline', () => {
    const decos = decorations(makeState('see ![x](x.png) here\n\nnext', { at: 30 }))
    expect(decos.find((d) => d.value === 'EmbedWidget')?.kind).toBe('widget')
  })

  it('is the raw text with the caret on it, and in Source', () => {
    const doc = '![x](x.png)\n\nnext'
    expect(decorations(makeState(doc, { at: 3 })).some((d) => d.value === 'EmbedWidget')).toBe(false)
    expect(decorations(makeState(doc, { at: 15, mode: 'source' })).some((d) => d.value === 'EmbedWidget')).toBe(false)
  })

  it('the block walk and the inline walk agree (the split is exhaustive)', () => {
    const state = makeState('a\n\n![x](x.png)\n\nb ![y](y.gif) c\n', { at: 0 })
    const blocks: string[] = []
    buildBlockPreview(state).decorations.between(0, state.doc.length, (_f, _t, d) => {
      blocks.push((d.spec as { widget?: object }).widget?.constructor.name ?? '')
    })
    const inline: string[] = []
    buildInlinePreview(state, [{ from: 0, to: state.doc.length }]).decorations.between(0, state.doc.length, (_f, _t, d) => {
      inline.push((d.spec as { widget?: object }).widget?.constructor.name ?? '')
    })
    expect(blocks).toEqual(['EmbedWidget'])
    expect(inline).toContain('EmbedWidget')
  })

  it('leaves a non-picture and a data: URL as the text they are', () => {
    for (const doc of ['![paper](paper.pdf)\n\nx', '![d](data:image/png;base64,AAAA)\n\nx']) {
      const decos = decorations(makeState(doc, { at: doc.length }))
      expect(decos.some((d) => d.value === 'EmbedWidget' || d.value === 'RemoteImageWidget')).toBe(false)
    }
  })
})

describe('a remote ![alt](https://…)', () => {
  it('is a click-to-load placeholder when the host can load it — never an embed', () => {
    const decos = decorations(makeState('![logo](https://example.com/logo.png)\n\nx', { at: 45, host: loader }))
    const remote = decos.find((d) => d.value === 'RemoteImageWidget')
    expect(remote?.kind).toBe('block-widget')
    expect((remote?.widget as RemoteImageWidget).src).toBe('https://example.com/logo.png')
    expect(decos.some((d) => d.value === 'EmbedWidget')).toBe(false)
  })

  it('stays a link, saying it was not loaded, when the host cannot load remote images', () => {
    const doc = 'see ![logo](https://example.com/logo.png) here\n\nx'
    const state = makeState(doc, { at: doc.length })
    const decos = decorations(state)
    expect(decos.some((d) => d.value === 'RemoteImageWidget')).toBe(false)
    const link = decos.find((d) => d.kind === 'mark' && d.value.includes('cm-md-link'))
    expect(link?.text).toBe('logo')
    expect(decos.filter((d) => d.kind === 'hide').map((d) => d.text)).toEqual(['![', '](https://example.com/logo.png)'])
  })

  it('never asks the host for anything while building', () => {
    let asked = 0
    const host = testHost({
      loadRemoteImage: async () => {
        asked++
        return null
      },
      readAttachment: async () => {
        asked++
        return null
      },
    })
    decorations(makeState('![a](https://example.com/a.png)\n\nx', { at: 40, host }))
    expect(asked).toBe(0)
  })
})
