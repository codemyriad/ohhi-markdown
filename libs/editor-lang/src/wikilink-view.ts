/**
 * The editor-side half of wikilinks: decoration, click-through, completion.
 *
 * Every host-supplied capability arrives through ONE facet rather than as
 * props. That is deliberate: the Svelte wrapper rebuilds the EditorView when
 * a tracked prop changes, so passing an inline `onOpen` closure would destroy
 * and rebuild the view — losing cursor, scroll and undo history — on every
 * parent render. A facet is read from state and reconfigured, not re-created.
 */
import { autocompletion } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { Facet, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tagCompletions } from './preview/completion.js'
import { fenceLanguageCompletions } from './preview/fence-edit.js'
import { linkCompletions, linkPopover, type LinkContext, type LinkPopoverLabels } from './link-completion-view.js'
import type { LinkHeading } from './link-completion.js'

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
  /**
   * Where the note being edited sits — its path, the vault's shared folders
   * and the recently opened notes — so the popover can put the share's own
   * notes first (fork A2). Optional: without it the list is one ungrouped,
   * unboosted group.
   */
  context?(): LinkContext
  /** One note's headings, in document order, for `[[Note#` (from the index). */
  headings?(path: string): Promise<readonly LinkHeading[]>
  /** The popover's copy; absent → the developer fallback. */
  labels?: LinkPopoverLabels
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
 * `[[` completion: the link popover (editor-usability E1). The source, its
 * ranking and its rows live in link-completion*.ts; this file only owns the
 * facet the host arrives through.
 */
const wikiLinkCompletions = linkCompletions((state) => state.facet(wikiLinkHost))
const popover = linkPopover((state) => state.facet(wikiLinkHost))

/** The whole wikilink extension set. Install once; reconfigure the facet. */
export function wikiLinkExtensions(host?: WikiLinkHost): Extension[] {
  return [
    host ? wikiLinkHost.of(host) : [],
    wikiLinkClicks,
    // ONE autocompletion() for the whole surface: two of them are a config
    // merge conflict on `override`, which CM6 throws on at startup. So the
    // Read slice's `#` source is listed here rather than in livePreview().
    autocompletion({
      override: [wikiLinkCompletions, tagCompletions, fenceLanguageCompletions],
      activateOnTyping: true,
      ...popover.config,
    }),
    ...popover.extensions,
    EditorView.theme({
      // No pointer cursor here: on a RAW link a plain click edits, and a hand
      // would promise navigation that only Mod-click delivers. A rendered one
      // gets `.cm-live-link` (and its pointer) from libs/editor's theme.
      // The decorations themselves belong to preview/build.ts — ONE owner for
      // both forms, so a rendered link is not a span inside a span.
      '.cm-wikilink': { color: 'var(--ed-wikilink)' },
      '.cm-wikilink-unresolved': {
        color: 'var(--ed-wikilink-unresolved)',
        textDecoration: 'underline dotted',
      },
    }),
  ]
}
