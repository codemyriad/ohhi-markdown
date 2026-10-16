/**
 * What a click does on a rendered note (read-shaping B2.2, R2.4).
 *
 * The rule is "brackets visible ⇒ the click edits": where live preview has
 * rendered a link, a PLAIN click follows it, because there is no markup there
 * to put a caret in; where the markers are text — the active region, or Source
 * mode — a click places the caret and V2c's Mod-click still navigates.
 *
 * One handler for every target, because each one is the same two steps (find
 * what was clicked, ask the host): chips in the text and chips in the
 * frontmatter strip, wikilinks, markdown links, bare URLs, checkboxes.
 *
 * QA round 1: the press must land ON the link's drawn text (`onLinkText`),
 * and a finger's tap on a rendered wikilink in Live shows the link card
 * rather than opening the note (`link-tap.ts`).
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { EditorView } from '@codemirror/view'
import { previewMode, readHost } from '../read-host.js'
import { splitWikiLink } from '../wikilink.js'
import { wikiLinkHost } from '../wikilink-view.js'
import { isRendered } from './active-lines.js'
import * as cls from './classes.js'
import { toggleTaskAt } from './commands.js'
import { cardOpenOn, coarsePress, openTapped, tapLink } from './link-tap.js'
import { cellPosition } from './table-commands.js'

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

    // A checkbox toggles on MOUSEDOWN, not on click, and claims the event so
    // the caret does not move: moving it changes the active region, which
    // re-renders the line, which destroys the very element the mouseup needed
    // to land on — and a browser fires no `click` when that happens. (The
    // click handler below still cancels the browser's own toggle: what the
    // box shows is the document, never the last thing the pointer did.)
    const box = target.closest('input.cm-task')
    if (box) return done(event, () => toggleTaskAt(view, view.posAtDOM(box)))

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
      if (name !== 'Tag' && name !== 'WikiLink' && name !== 'Link' && name !== 'URL' && name !== 'Image') continue
      // A drawn picture is not a link; only a remote image left as one is (E5).
      if (name === 'Image' && target.closest('.cm-embed')) return false
      // The surface is the link's own text (QA round 1). `posAtCoords` snaps
      // to the NEAREST position, so a press on the empty rest of a line that
      // ends in a link, or below the last one, resolved into the link's hidden
      // `]]` and followed it; only a press on the drawn link counts.
      if (!onLinkText(target, name)) return false
      if (name === 'WikiLink') {
        const { target: wanted } = splitWikiLink(view.state.doc.sliceString(from + 2, to - 2))
        // A finger's second tap on a link whose card is up opens it (link-tap.ts).
        if (cardOpenOn(view.state, from) && coarsePress(view)) return done(event, () => openTapped(view, wanted))
        if (!isRendered(view.state, from, to)) return false
        // A finger's first tap: the caret and the card, never a jump (QA round 1).
        if (coarsePress(view) && view.state.facet(previewMode) === 'live') {
          return done(event, () => tapLink(view, pos, { from, to, target: wanted }))
        }
        return done(event, () => openWikiLink(view, wanted))
      }
      if (!isRendered(view.state, from, to)) return false
      if (name === 'Tag') {
        const tag = view.state.doc.sliceString(from + 1, to)
        return done(event, () => host.searchTag(tag))
      }
      const urlNode = name === 'URL' ? node : node.getChild('URL')
      if (!urlNode) return false
      const url = view.state.doc.sliceString(urlNode.from, urlNode.to)
      if (!isExternal(url)) return false
      return done(event, () => host.openExternal(url))
    }
    return false
  },

  click(event) {
    // The edit already happened on mousedown; this only reverts the browser's
    // own toggle, so the box always shows what the document says.
    if (!(event.target as HTMLElement | null)?.closest?.('input.cm-task')) return false
    event.preventDefault()
    return true
  },
})

/** The drawn text each kind of link marks itself with (`classes.ts`). */
const LINK_TEXT: Record<string, string> = {
  WikiLink: '.cm-wikilink, .cm-wikilink-unresolved',
  Tag: `.${cls.TAG}`,
  Link: '.cm-live-link',
  URL: '.cm-live-link',
  Image: '.cm-live-link',
}

/** Did the press land on the link's own drawn text, not just near it? */
export function onLinkText(target: Element, node: string): boolean {
  const selector = LINK_TEXT[node]
  return !!selector && target.closest(selector) !== null
}

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

  // The Live grid (E4): a click on a cell puts the caret at the end of that
  // cell's text, which makes the table active and shows its source. The
  // widget's own position is the table's first line; the cell says the rest.
  if (widget.classList.contains('cm-table-grid')) {
    const cell = target.closest<HTMLElement>('[data-row][data-col]')
    const at = view.posAtDOM(widget)
    const pos = cell
      ? cellPosition(view.state, at, Number(cell.dataset.row), Number(cell.dataset.col))
      : at
    if (pos === null) return false
    return done(event, () => {
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, userEvent: 'select.pointer' })
      view.focus()
    })
  }

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
