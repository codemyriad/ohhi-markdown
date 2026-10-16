/**
 * The link popover's CM6 half (editor-usability E1): the `[[` completion
 * source over `link-completion.ts`'s pure rules, its rows (icon, name with
 * the match bold, folder dim on the right), its group headers, its footer of
 * key hints, and Tab-to-accept.
 *
 * The host arrives as a getter rather than an import of `wikiLinkHost`, so
 * this module and `wikilink-view.ts` (which owns the facet) do not import
 * each other. Every colour is styled in libs/editor's theme.ts, the one owner
 * of the CM6 surface's look (golden rule 7); this file only names classes.
 */
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
} from '@codemirror/autocomplete'
import { Prec, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import {
  createFolder,
  exactMatch,
  linkEdit,
  linkQueryAt,
  linkTarget,
  rankHeadings,
  rankNotes,
  scopeNotes,
  type LinkHeading,
  type LinkMount,
} from './link-completion.js'
import { icon as lucide } from './preview/icons.js'
import { FALLBACK_LINK_LABELS, type LinkPopoverLabels } from './read-host.js'
import type { WikiLinkHost } from './wikilink-view.js'

/** What the link host knows about where the caret's note sits (fork A2). */
export interface LinkContext {
  /** The note being edited, or null before one is open. */
  path: string | null
  /** Every shared folder in the vault (carved, joined, adopted), never the root. */
  mounts: readonly LinkMount[]
  /** Recently opened notes, newest first — the empty query's order. */
  recents: readonly string[]
}

type RowKind = 'note' | 'create' | 'heading'

interface LinkOption extends Completion {
  ohhi: { kind: RowKind; match: [number, number] | null }
}

const isLinkOption = (c: Completion | undefined): c is LinkOption =>
  !!c && typeof (c as Partial<LinkOption>).ohhi === 'object'

// ---- group headers ---------------------------------------------------------
// Section names are ids, never copy: CM6 keys sections by name, and a custom
// `header` draws the words. Ranks fix the order — share, others, create.

function header(text: string, title?: string, extra = ''): HTMLElement {
  const el = document.createElement('completion-section')
  el.className = `cm-link-section ${extra}`.trim()
  el.textContent = text
  if (title) el.title = title
  return el
}

function sections(labels: LinkPopoverLabels, mount: LinkMount | null): Record<string, CompletionSection> {
  return {
    scope: { name: 'link:scope', rank: 0, header: () => header(labels.scope(mount?.name ?? '')) },
    all: { name: 'link:all', rank: 0, header: () => header('', undefined, 'cm-link-section-bare') },
    other: {
      name: 'link:other',
      rank: 1,
      header: () => header(labels.others, labels.othersTitle, 'cm-link-section-divided'),
    },
    create: { name: 'link:create', rank: 2, header: () => header('', undefined, 'cm-link-section-rule') },
    headings: { name: 'link:headings', rank: 0, header: () => header('', undefined, 'cm-link-section-bare') },
  }
}

// ---- applying a pick ---------------------------------------------------------

/**
 * Dispatch one `linkEdit`: the pure rule decides the text and the caret, this
 * only translates line offsets to document ones. `then` runs after the edit
 * (the create row's note creation).
 */
function applyLink(text: string, kind: 'target' | 'heading', then?: () => void) {
  return (view: EditorView, completion: Completion, from: number): void => {
    const caret = view.state.selection.main.head
    const line = view.state.doc.lineAt(from)
    const edit = linkEdit(line.text, from - line.from, caret - line.from, text, kind)
    view.dispatch({
      changes: { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert },
      selection: { anchor: line.from + edit.cursor },
      annotations: pickedCompletion.of(completion),
      userEvent: 'input.complete',
      scrollIntoView: true,
    })
    then?.()
  }
}

// ---- the source ----------------------------------------------------------------

const NO_CONTEXT: LinkContext = { path: null, mounts: [], recents: [] }

/**
 * `[[` completion: synchronous for notes (the path list is in memory, and an
 * await would make the popup flicker in behind a keystroke), async only for
 * `[[Note#` headings, which come from the index.
 */
export function linkCompletions(hostOf: (state: EditorState) => WikiLinkHost) {
  return (context: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null => {
    const line = context.state.doc.lineAt(context.pos)
    const q = linkQueryAt(line.text, context.pos - line.from)
    if (!q) return null
    const host = hostOf(context.state)
    const labels = host.labels ?? FALLBACK_LINK_LABELS
    const ctx = host.context?.() ?? NO_CONTEXT

    if (q.heading) return headingCompletions(host, ctx, q.target, q.heading, line.from, labels)

    const paths = host.candidates()
    const { mount, notes } = scopeNotes(paths, ctx.path, ctx.mounts)
    const ranked = rankNotes(q.target, notes, ctx.recents)
    const groups = sections(labels, mount)
    const typedPath = q.target.includes('/')

    const options: LinkOption[] = ranked.map((note) => ({
      label: note.name,
      detail: note.folder || undefined,
      section: groups[note.group],
      ohhi: { kind: 'note', match: note.match },
      // Computed at pick time, not per row: the shortest unique path needs a
      // pass over the vault, and only the picked row ever pays for it.
      apply: (view, completion, from) =>
        applyLink(
          linkTarget(
            note.path,
            paths,
            note.group === 'scope' && mount ? mount.path : '',
            typedPath,
            ctx.path
          ),
          'target'
        )(view, completion, from),
    }))

    const typed = q.target.trim()
    if (typed && !exactMatch(typed, paths)) {
      const folder = createFolder(typed, ctx.path)
      options.push({
        label: typed,
        displayLabel: labels.create(typed),
        detail: folder || labels.vaultRoot,
        section: groups.create,
        ohhi: { kind: 'create', match: null },
        apply: applyLink(typed, 'target', () => host.create(typed)),
      })
    }
    if (options.length === 0) return null
    return {
      from: line.from + q.open,
      to: context.pos,
      options,
      filter: false,
      getMatch: (c) => (isLinkOption(c) && c.ohhi.match ? c.ohhi.match : []),
    }
  }
}

function headingCompletions(
  host: WikiLinkHost,
  ctx: LinkContext,
  target: string,
  heading: { from: number; query: string },
  lineFrom: number,
  labels: LinkPopoverLabels
): Promise<CompletionResult | null> | null {
  if (!host.headings) return null
  // `[[#` is a heading of THIS note.
  const path = target ? host.resolve(target) : ctx.path
  if (!path) return null
  const groups = sections(labels, null)
  return host.headings(path).then((list: readonly LinkHeading[]) => {
    const options: LinkOption[] = rankHeadings(heading.query, list).map((h) => ({
      label: h.anchor,
      detail: `H${h.level}`,
      section: groups.headings,
      ohhi: { kind: 'heading', match: h.match },
      apply: applyLink(h.anchor, 'heading'),
    }))
    if (options.length === 0) return null
    return {
      from: lineFrom + heading.from,
      options,
      filter: false,
      getMatch: (c) => (isLinkOption(c) && c.ohhi.match ? c.ohhi.match : []),
    }
  })
}

// ---- the rows ------------------------------------------------------------------

const ROW_ICONS = { note: 'file', create: 'file-plus', heading: 'hash' } as const satisfies Record<RowKind, string>

function icon(kind: RowKind): HTMLElement {
  const span = document.createElement('span')
  span.className = 'cm-link-icon'
  span.setAttribute('aria-hidden', 'true')
  span.appendChild(lucide(ROW_ICONS[kind]))
  return span
}

// ---- the footer ------------------------------------------------------------------

function footer(labels: LinkPopoverLabels): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cm-link-footer'
  el.setAttribute('aria-hidden', 'true')
  const kbd = (text: string): void => {
    const k = el.appendChild(document.createElement('kbd'))
    k.textContent = text
  }
  const word = (text: string): void => {
    el.appendChild(document.createElement('span')).textContent = text
  }
  const dot = (): void => {
    const s = el.appendChild(document.createElement('span'))
    s.className = 'cm-link-footer-dot'
    s.textContent = '·'
  }
  kbd(labels.keyEnter)
  kbd(labels.keyTab)
  word(labels.hintLink)
  dot()
  kbd('#')
  word(labels.hintHeading)
  dot()
  kbd('|')
  word(labels.hintAlias)
  dot()
  kbd(labels.keyEscape)
  return el
}

/**
 * CM6 has no footer slot on the completion tooltip, so this adds one after
 * each update that leaves a link popover open. The list is a sibling CM6 may
 * replace (and re-append after the footer); the theme orders the footer last
 * with flex `order`, so DOM order does not matter.
 */
function footerPlugin(hostOf: (state: EditorState) => WikiLinkHost): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate): void {
        if (completionStatus(update.state) !== 'active') return
        update.view.requestMeasure({
          key: this,
          read: () => null,
          write: () => {
            const tip = this.view.dom.querySelector('.cm-tooltip-autocomplete.cm-link-popover')
            if (!tip || tip.querySelector(':scope > .cm-link-footer')) return
            tip.appendChild(footer(hostOf(this.view.state).labels ?? FALLBACK_LINK_LABELS))
          },
        })
      }
    }
  )
}

/**
 * Is the popover a link one (rather than `#tag`)? Decided from the document
 * — the caret inside an open `[[` — not from the open dialog's rows: CM6
 * asks for the tooltip's class while it is still building the dialog, when
 * `currentCompletions` is empty, so a class read from the rows was absent on
 * every first paint and applied a frame later. Each keystroke makes a new
 * dialog, so the rows drew at the default indent and then jumped to this
 * popover's (QA 2026-10-16, Chris's screencast). The rows check stays as the
 * fallback for a dialog kept open after the caret has left the brackets.
 */
export function linkPopoverOpen(state: EditorState): boolean {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  if (linkQueryAt(line.text, head - line.from) !== null) return true
  return isLinkOption(currentCompletions(state)[0])
}

/**
 * Everything the popover adds to the ONE `autocompletion()` config, plus the
 * extensions that ride beside it. Spread `config` into that call.
 */
export function linkPopover(hostOf: (state: EditorState) => WikiLinkHost): {
  config: {
    tooltipClass: (state: EditorState) => string
    optionClass: (completion: Completion) => string
    addToOptions: { render: (completion: Completion) => Node | null; position: number }[]
    maxRenderedOptions: number
  }
  extensions: Extension[]
} {
  return {
    config: {
      tooltipClass: (state) => (linkPopoverOpen(state) ? 'cm-link-popover' : ''),
      optionClass: (c) => (isLinkOption(c) ? `cm-link-option cm-link-${c.ohhi.kind}` : ''),
      addToOptions: [{ render: (c) => (isLinkOption(c) ? icon(c.ohhi.kind) : null), position: 20 }],
      maxRenderedOptions: 120,
    },
    extensions: [
      footerPlugin(hostOf),
      // Tab accepts like Enter while a popover is open — and only then:
      // acceptCompletion returns false with nothing open, so Tab falls
      // through to the list indent (and, off a list, to the browser). Highest
      // precedence, so it outranks `edit.indent-list` at Prec.high.
      Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    ],
  }
}
