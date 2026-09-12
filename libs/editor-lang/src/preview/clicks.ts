/**
 * What a click does on a rendered note (read-shaping.md B2.2, R2.4).
 *
 * The rule is "brackets visible ⇒ the click edits": where live preview has
 * rendered a link, a PLAIN click follows it, because there is no markup there
 * to put a caret in; where the markers are text — the active region, or Source
 * mode — a click places the caret and V2c's Mod-click still navigates.
 *
 * One handler for every target, because each one is the same two steps (find
 * what was clicked, ask the host): chips in the text and chips in the
 * frontmatter strip, wikilinks, markdown links, bare URLs, checkboxes.
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { EditorView } from '@codemirror/view'
import { previewMode, readHost } from '../read-host.js'
import { splitWikiLink } from '../wikilink.js'
import { wikiLinkHost } from '../wikilink-view.js'
import { isRendered } from './active-lines.js'
import { toggleTaskAt } from './commands.js'

/**
 * Only http(s) leaves the app: a note is agent-writable, and `file:`, `data:`
 * or a custom scheme handed to the OS is a hole, not a feature. A link we will
 * not open is not handled at all, so the click still places the caret rather
 * than doing nothing at all (a relative `[note](./x.md)` is the common case).
 */
function isExternal(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()
  return scheme === 'http' || scheme === 'https'
}

export const previewClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey || event.defaultPrevented) return false
    const target = event.target as HTMLElement | null
    if (!target) return false

    // Inside a widget there is no document position to resolve, so the widget
    // says what it is with data attributes (the strip's chips, a Reading
    // table's links).
    const widget = target.closest('.cm-frontmatter-strip, .cm-table-wrap')
    if (widget) return widgetClick(event, view, target, widget)

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    const host = view.state.facet(readHost)
    for (let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent) {
      const { name, from, to } = node
      if (name !== 'Tag' && name !== 'WikiLink' && name !== 'Link' && name !== 'URL') continue
      if (!isRendered(view.state, from, to)) return false
      if (name === 'Tag') {
        const tag = view.state.doc.sliceString(from + 1, to)
        return done(event, () => host.searchTag(tag))
      }
      if (name === 'WikiLink') {
        const { target: wanted } = splitWikiLink(view.state.doc.sliceString(from + 2, to - 2))
        return done(event, () => openWikiLink(view, wanted))
      }
      const urlNode = name === 'URL' ? node : node.getChild('URL')
      if (!urlNode) return false
      const url = view.state.doc.sliceString(urlNode.from, urlNode.to)
      if (!isExternal(url)) return false
      return done(event, () => host.openExternal(url))
    }
    return false
  },

  click(event, view) {
    const box = (event.target as HTMLElement | null)?.closest?.('input.cm-task')
    if (!box) return false
    // preventDefault reverts the browser's own toggle: the document is what
    // says whether the task is done, and the widget redraws from it.
    event.preventDefault()
    return toggleTaskAt(view, view.posAtDOM(box))
  },
})

/** Open a wikilink target, or offer to create it — V2c's rule, unchanged. */
function openWikiLink(view: EditorView, target: string): void {
  const host = view.state.facet(wikiLinkHost)
  const path = host.resolve(target)
  if (path) host.open(path)
  else host.create(target)
}

function widgetClick(
  event: MouseEvent,
  view: EditorView,
  target: HTMLElement,
  widget: Element
): boolean {
  const host = view.state.facet(readHost)
  const tag = target.closest<HTMLElement>('[data-tag]')?.dataset.tag
  if (tag) return done(event, () => host.searchTag(tag))

  const wanted = target.closest<HTMLElement>('[data-wikilink]')?.dataset.wikilink
  if (wanted) return done(event, () => openWikiLink(view, wanted))

  const url = target.closest<HTMLElement>('[data-url]')?.dataset.url
  if (url && isExternal(url)) return done(event, () => host.openExternal(url))

  if (widget.classList.contains('cm-frontmatter-strip')) {
    // Reading has no caret to hand back.
    if (view.state.facet(previewMode) === 'reading') return false
    // Into the block, on the first line of YAML: the strip is only a way back
    // to the text (R4.1.1), and `---\n` is four characters.
    const at = Math.min(view.posAtDOM(widget) + 4, view.state.doc.length)
    return done(event, () => {
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
      view.focus()
    })
  }
  return false
}

function done(event: MouseEvent, run: () => void): boolean {
  event.preventDefault()
  run()
  return true
}
