/**
 * The editor-side half of wikilinks: decoration, click-through, completion.
 *
 * Every host-supplied capability arrives through ONE facet rather than as
 * props. That is deliberate: the Svelte wrapper rebuilds the EditorView when
 * a tracked prop changes, so passing an inline `onOpen` closure would destroy
 * and rebuild the view — losing cursor, scroll and undo history — on every
 * parent render. A facet is read from state and reconfigured, not re-created.
 */
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { Facet, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { tagCompletions } from './preview/completion.js'

/** What the host lets the editor do with a link target. */
export interface WikiLinkHost {
  /** Target → workspace path, or null when nothing matches. Must be sync. */
  resolve(target: string): string | null
  /** Open a resolved path. */
  open(path: string): void
  /** Act on a target that resolves to nothing (create it, or prompt). */
  create(target: string): void
  /** Candidate paths for `[[` completion — the same list quick-open uses. */
  candidates(): string[]
}

const NOOP_HOST: WikiLinkHost = {
  resolve: () => null,
  open: () => {},
  create: () => {},
  candidates: () => [],
}

/**
 * Single-value facet so a reconfigure replaces the host outright. Defaults to
 * a no-op host, so the extension is safe to install before a vault is open.
 */
export const wikiLinkHost = Facet.define<WikiLinkHost, WikiLinkHost>({
  combine: (values) => values[values.length - 1] ?? NOOP_HOST,
})

const resolvedMark = Decoration.mark({ class: 'cm-wikilink' })
const unresolvedMark = Decoration.mark({ class: 'cm-wikilink-unresolved' })

/**
 * Mark each `[[link]]` as resolved or unresolved.
 *
 * 12% of this vault's link targets resolve to nothing, and they read as intent
 * rather than as typos — rendering them identically to resolved links would
 * hide an eighth of the link graph.
 */
const wikiLinkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate): void {
      // Also on viewportChanged: only the visible ranges are decorated.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const host = view.state.facet(wikiLinkHost)
      const marks: { from: number; to: number; resolved: boolean }[] = []
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== 'WikiLinkTarget') return
            const target = view.state.doc.sliceString(node.from, node.to).trim()
            marks.push({ from: node.from, to: node.to, resolved: host.resolve(target) !== null })
          },
        })
      }
      marks.sort((a, b) => a.from - b.from)
      return Decoration.set(
        marks.map((m) => (m.resolved ? resolvedMark : unresolvedMark).range(m.from, m.to))
      )
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * Click-through on a RAW link: Mod-click (or middle-click), never a plain one.
 *
 * Where the brackets are visible characters you edit — Source mode, or the
 * active region in Live — a plain click has to place the caret. Navigating on
 * it would make a link uneditable: every attempt to fix a typo in a target
 * would jump you away instead. The go-to-definition convention every code
 * editor already uses is the right one here.
 *
 * Where live preview has RENDERED the link, there is no markup to put a caret
 * in and a plain click follows it — that rule lives with the rest of the
 * engine, in preview/clicks.ts (read-shaping.md R2.4).
 */
const wikiLinkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const modClick = event.button === 0 && (event.metaKey || event.ctrlKey)
    const middleClick = event.button === 1
    if (!modClick && !middleClick) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    const node = syntaxTree(view.state).resolveInner(pos, 1)
    const link = node.name === 'WikiLinkTarget' ? node : node.parent
    if (!link || link.name !== 'WikiLinkTarget') return false

    const host = view.state.facet(wikiLinkHost)
    const target = view.state.doc.sliceString(link.from, link.to).trim()
    const path = host.resolve(target)
    event.preventDefault()
    if (path) host.open(path)
    else host.create(target)
    return true
  },
})

/**
 * `[[` completion over the same in-memory path list quick-open uses.
 *
 * Synchronous by construction — no await, so the popup never flickers in
 * behind a keystroke. It fires inside an unterminated `[[…` regardless of
 * whether the parser has produced a node yet, which it often has not while
 * you are still typing the opening brackets.
 */
function wikiLinkCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  const open = before.lastIndexOf('[[')
  if (open === -1) return null
  const typed = before.slice(open + 2)
  // Already closed, or spilling past the link: not a completion context.
  if (typed.includes(']')) return null

  // Complete only the TARGET segment: anything after a `#` or `|` the user has
  // already typed is theirs to keep. Replacing the whole run would silently
  // drop an anchor (`[[Design#Decisions` → `[[Design]]`).
  const stop = typed.search(/[#|]/)
  const target = (stop === -1 ? typed : typed.slice(0, stop)).trim()
  const replaceTo = line.from + open + 2 + (stop === -1 ? typed.length : stop)

  const host = context.state.facet(wikiLinkHost)
  const query = target.toLowerCase()
  const candidates = host.candidates()

  // How many notes share each basename — an ambiguous one must be applied as
  // its full path, or PathResolver picks by proximity and the user gets a
  // different note than the one they chose from the list.
  const byBase = new Map<string, number>()
  for (const path of candidates) {
    const name = path.replace(/\.md$/i, '')
    const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase()
    byBase.set(base, (byBase.get(base) ?? 0) + 1)
  }

  const options = candidates
    .filter((path) => !query || path.toLowerCase().includes(query))
    .slice(0, 50)
    .map((path) => {
      const name = path.replace(/\.md$/i, '')
      const base = name.slice(name.lastIndexOf('/') + 1)
      // Apply the full path when the basename is ambiguous, or when the user
      // is clearly typing a path (they asked for a specific folder).
      const ambiguous = (byBase.get(base.toLowerCase()) ?? 0) > 1
      const apply = ambiguous || target.includes('/') ? name : base
      return { label: base, detail: name, apply, type: 'text' }
    })
  if (options.length === 0) return null
  return { from: line.from + open + 2, to: replaceTo, options, filter: false }
}

/** The whole wikilink extension set. Install once; reconfigure the facet. */
export function wikiLinkExtensions(host?: WikiLinkHost): Extension[] {
  return [
    host ? wikiLinkHost.of(host) : [],
    wikiLinkDecorations,
    wikiLinkClicks,
    // ONE autocompletion() for the whole surface: two of them are a config
    // merge conflict on `override`, which CM6 throws on at startup. So the
    // Read slice's `#` source is listed here rather than in livePreview().
    autocompletion({ override: [wikiLinkCompletions, tagCompletions], activateOnTyping: true }),
    EditorView.theme({
      // No pointer cursor on a RAW link: a plain click edits here, and a hand
      // would promise navigation that only Mod-click delivers. A rendered one
      // gets `.cm-live-link` (and its pointer) from libs/editor's theme.
      '.cm-wikilink': { color: 'var(--ed-wikilink)' },
      '.cm-wikilink-unresolved': {
        color: 'var(--ed-wikilink-unresolved)',
        textDecoration: 'underline dotted',
      },
    }),
  ]
}
