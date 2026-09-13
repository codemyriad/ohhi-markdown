/**
 * Inline content, extracted from the syntax tree as data and then drawn.
 *
 * Only Reading's table widget needs this: everything else in the engine
 * decorates the document's own text, where CM6 draws the characters and we
 * only hide markers. A table in Reading replaces its source lines, so its cells
 * have to be built — and they are built from the SAME tree the rest of the
 * engine reads (Fork 3-A), never by parsing the text a second time.
 *
 * The split is deliberate: `extractInline` is pure and testable in node,
 * `renderInline` is the only part that needs a document.
 */
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { wikiLinkHost } from '../wikilink-view.js'
import { splitWikiLink } from '../wikilink.js'

export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'strike' | 'mark' | 'code'; children: InlinePiece[] }
  | { kind: 'link'; url: string; children: InlinePiece[] }
  | { kind: 'tag'; tag: string }
  | { kind: 'wikilink'; target: string; label: string; resolved: boolean }

/** Markers: present in the tree, never in the rendered output. */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'LinkMark',
  'StrikethroughMark',
  'HighlightMark',
  'WikiLinkMark',
  'HeaderMark',
  'QuoteMark',
  'LinkTitle',
])

const WRAPPERS: Record<string, 'strong' | 'em' | 'strike' | 'mark' | 'code'> = {
  StrongEmphasis: 'strong',
  Emphasis: 'em',
  Strikethrough: 'strike',
  Highlight: 'mark',
  InlineCode: 'code',
}

/** The inline content of `node`, as data. */
export function extractInline(state: EditorState, node: SyntaxNode): InlinePiece[] {
  const out: InlinePiece[] = []
  let pos = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) pushText(out, state, pos, child.from)
    pushNode(out, state, child)
    pos = child.to
  }
  if (pos < node.to) pushText(out, state, pos, node.to)
  return out
}

function pushText(out: InlinePiece[], state: EditorState, from: number, to: number): void {
  const text = state.doc.sliceString(from, to)
  if (text) out.push({ kind: 'text', text })
}

function pushNode(out: InlinePiece[], state: EditorState, node: SyntaxNode): void {
  const name = node.name
  if (MARKS.has(name)) return

  const wrapper = WRAPPERS[name]
  if (wrapper) {
    out.push({ kind: wrapper, children: extractInline(state, node) })
    return
  }

  if (name === 'Link') {
    const url = node.getChild('URL')
    out.push({
      kind: 'link',
      url: url ? state.doc.sliceString(url.from, url.to) : '',
      // The URL is part of the markup, not of what the cell says.
      children: extractInline(state, node).filter((p) => p.kind !== 'link'),
    })
    return
  }

  if (name === 'URL') {
    const text = state.doc.sliceString(node.from, node.to)
    out.push({ kind: 'link', url: text, children: [{ kind: 'text', text }] })
    return
  }

  if (name === 'Tag') {
    out.push({ kind: 'tag', tag: state.doc.sliceString(node.from + 1, node.to) })
    return
  }

  if (name === 'Escape') {
    // A cell escapes its own pipes (`a \| b`); what the cell SAYS is the
    // character, not the backslash that got it past the table parser.
    pushText(out, state, node.from + 1, node.to)
    return
  }

  if (name === 'WikiLink' || name === 'WikiLinkEmbed') {
    // Same reason, one node up: `[[Target\|alias]]` is how a wikilink survives
    // a table row, and the target is `Target` — with the backslash left on it
    // the link resolves to nothing and renders as a broken one.
    const inner = state.doc
      .sliceString(node.from + (name === 'WikiLink' ? 2 : 3), node.to - 2)
      .replace(/\\\|/g, '|')
    const parts = splitWikiLink(inner)
    out.push({
      kind: 'wikilink',
      target: parts.target,
      label: parts.alias ?? parts.target,
      resolved: state.facet(wikiLinkHost).resolve(parts.target) !== null,
    })
    return
  }

  // Anything else (Escape, Entity, HTMLTag, a nested paragraph): its text, and
  // its children's markers dropped, is the closest honest rendering.
  if (node.firstChild) out.push(...extractInline(state, node))
  else pushText(out, state, node.from, node.to)
}

/** Draw extracted pieces. Links and chips carry their target as data, so the
 *  view-level click handler reaches them inside a widget as well as in text. */
export function renderInline(pieces: readonly InlinePiece[]): DocumentFragment {
  const frag = document.createDocumentFragment()
  for (const piece of pieces) {
    frag.appendChild(renderPiece(piece))
  }
  return frag
}

function renderPiece(piece: InlinePiece): Node {
  switch (piece.kind) {
    case 'text':
      return document.createTextNode(piece.text)
    case 'code': {
      const el = document.createElement('code')
      el.className = 'cm-inline-code'
      el.appendChild(renderInline(piece.children))
      return el
    }
    case 'mark': {
      const el = document.createElement('mark')
      el.className = 'cm-highlight'
      el.appendChild(renderInline(piece.children))
      return el
    }
    case 'strong':
    case 'em':
    case 'strike': {
      const el = document.createElement(piece.kind === 'strong' ? 'strong' : piece.kind === 'em' ? 'em' : 's')
      el.appendChild(renderInline(piece.children))
      return el
    }
    case 'link': {
      const el = document.createElement('span')
      el.className = 'cm-md-link cm-live-link'
      el.dataset.url = piece.url
      el.appendChild(renderInline(piece.children))
      return el
    }
    case 'tag': {
      const el = document.createElement('span')
      el.className = 'cm-tag'
      el.dataset.tag = piece.tag
      el.textContent = `#${piece.tag}`
      return el
    }
    case 'wikilink': {
      const el = document.createElement('span')
      el.className = piece.resolved
        ? 'cm-wikilink cm-live-link'
        : 'cm-wikilink-unresolved cm-live-link'
      el.dataset.wikilink = piece.target
      el.textContent = piece.label
      return el
    }
  }
}
