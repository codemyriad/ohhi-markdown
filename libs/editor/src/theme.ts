/**
 * CM6 theming, driven entirely by --ed-* custom properties.
 *
 * THE RULE: no literal colour in this file.
 *
 * EditorView.theme() hands its spec to StyleModule, which injects ONE global,
 * unscoped stylesheet into <head> with generated class names. It has no idea
 * [data-theme] exists and will never re-run on a theme change. So a literal
 * colour here would freeze that colour for every theme and every view.
 *
 * Every value is var(--ed-*) instead: the stylesheet is a constant, the
 * browser re-resolves the custom properties on repaint, and flipping
 * data-theme on <html> restyles CodeMirror for free — no dispatch, no view
 * recreation, no Y.Text rebind. The same trick makes ONE HighlightStyle serve
 * all four themes.
 *
 * Exactly one thing still needs JS: EditorView.darkTheme, a boolean facet
 * selecting CM6's own &dark/&light base rules (scroller, panels, tooltip
 * chrome). It lives in a Compartment and is reconfigured with one dispatch.
 *
 * See docs/theming.md and plans/v2-shaping.md (Fork 2).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { highlightTag, tagTag, wikiLinkMarkTag, wikiLinkTag } from '@editor/editor-lang'

/** Reconfigured on theme change; nothing else about the view moves. */
export const themeModeCompartment = new Compartment()

/**
 * Built ONCE at module scope. StyleModule dedupes by spec-object identity, so
 * constructing this inside the factory would inject a fresh stylesheet per
 * open document — dozens of duplicate rule sets in <head> in a real session.
 */
const editorBaseTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ed-ink)',
    backgroundColor: 'var(--ed-surface)',
    fontFamily: 'var(--ed-font-prose)',
    fontSize: 'var(--ed-font-size)',
  },
  '&.cm-focused': { outline: 'none' },

  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'var(--ed-line-height)' },
  '.cm-content': {
    caretColor: 'var(--ed-caret)',
    padding: '1.5rem 0',
    maxWidth: 'var(--ed-measure)',
    margin: '0 auto',
  },
  '.cm-line': { padding: '0 1rem' },

  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--ed-caret)',
    borderLeftWidth: '2px',
  },

  // Two different mechanisms: with drawSelection() off CM6 uses the native
  // selection, with it on a drawn layer. Style both, or the selection
  // vanishes the day someone adds drawSelection() for multi-cursor.
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ed-selection)',
  },
  '&:not(.cm-focused) .cm-selectionBackground': {
    backgroundColor: 'var(--ed-selection-blur)',
  },

  '.cm-activeLine': { backgroundColor: 'var(--ed-active-line)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ed-gutter-bg)',
    color: 'var(--ed-gutter-fg)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--ed-active-line)',
    color: 'var(--ed-gutter-active-fg)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--ed-bracket-match-bg)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search-match-bg)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ed-search-match-active-bg)',
  },
  '.cm-panels, .cm-tooltip': {
    backgroundColor: 'var(--ed-code-block-bg)',
    color: 'var(--ed-ink)',
    border: '1px solid var(--ed-code-border)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--ed-selection)',
    color: 'var(--ed-ink)',
  },

  // --- live preview (read-shaping.md B2) -----------------------------------
  // Every class the reveal engine emits is styled HERE, and only here: the
  // engine sets class names and never a colour, so one token layer paints the
  // Svelte chrome and the CM6 surface alike (golden rule 7).
  //
  // Headings are the exception that proves it: their SIZE comes from the
  // HighlightStyle below, not from the line class, because both would be `em`
  // and 1.9em inside 1.9em is 3.6em.
  '.cm-live-h1, .cm-live-h2, .cm-live-h3': { paddingTop: '0.6em' },
  '.cm-live-h4, .cm-live-h5, .cm-live-h6': { paddingTop: '0.4em' },

  '.cm-live-quote': {
    borderLeft: '3px solid var(--ed-quote-border)',
    color: 'var(--ed-quote-fg)',
  },

  '.cm-live-code': {
    backgroundColor: 'var(--ed-code-block-bg)',
    color: 'var(--ed-code-block-fg)',
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '0.92em',
  },
  '.cm-fence-line': {
    backgroundColor: 'var(--ed-code-block-bg)',
    borderTop: '1px solid var(--ed-code-border)',
    minHeight: '0.5em',
  },
  '.cm-fence-cap': { borderTop: 'none', borderBottom: '1px solid var(--ed-code-border)' },
  '.cm-fence-lang': {
    color: 'var(--ed-ink-muted)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.75em',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    padding: '0 1rem',
  },

  '.cm-inline-code': {
    backgroundColor: 'var(--ed-code-bg)',
    color: 'var(--ed-code-fg)',
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '0.9em',
    borderRadius: '0.25em',
    padding: '0.1em 0.3em',
  },

  '.cm-bullet': { color: 'var(--ed-bullet)' },
  '.cm-list-num': { color: 'var(--ed-bullet)' },
  '.cm-task': {
    accentColor: 'var(--ed-checkbox)',
    verticalAlign: 'middle',
    marginRight: '0.15em',
    cursor: 'pointer',
  },
  '.cm-task:checked': { accentColor: 'var(--ed-checkbox-done)' },

  '.cm-live-rule hr': {
    border: 'none',
    borderTop: '1px solid var(--ed-hr)',
    margin: '0.6em 0',
  },

  // The pointer belongs to `.cm-live-link`, which the engine adds only where a
  // link is actually RENDERED — on a raw link a click still places the caret,
  // and a hand there would promise something only Mod-click delivers.
  '.cm-md-link': { color: 'var(--ed-link)' },
  '.cm-url': { color: 'var(--ed-url)', textDecoration: 'underline' },
  '.cm-live-link': { cursor: 'pointer' },
  '.cm-live-link:hover': { color: 'var(--ed-link-hover)' },

  '.cm-tag': {
    color: 'var(--ed-tag-fg)',
    backgroundColor: 'var(--ed-tag-bg)',
    borderRadius: 'var(--ed-tag-radius)',
    padding: '0.05em 0.4em',
  },
  '.cm-tag:hover': { backgroundColor: 'var(--ed-tag-bg-hover)' },
  '.cm-highlight': { backgroundColor: 'var(--ed-mark-bg)', color: 'var(--ed-mark-fg)' },

  // HTML is styled as code and never rendered: 24 elements in 13 files, 10 of
  // them <iframe>, in files an agent can write (read-shaping.md B7).
  '.cm-html': { color: 'var(--ed-ink-muted)', fontFamily: 'var(--ed-font-mono)' },
  '.cm-block-id': { color: 'var(--ed-ink-faint)', fontSize: '0.85em' },

  '.cm-embed img': { maxWidth: '100%', borderRadius: '0.25em' },
  '.cm-embed-missing': {
    display: 'inline-block',
    color: 'var(--ed-ink-muted)',
    border: '1px dashed var(--ed-code-border)',
    borderRadius: '0.25em',
    padding: '0.4em 0.6em',
    fontSize: '0.9em',
  },

  '.cm-live-frontmatter': {
    backgroundColor: 'var(--ed-frontmatter-bg)',
    borderLeft: '3px solid var(--ed-frontmatter-border)',
    color: 'var(--ed-frontmatter-fg)',
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '0.9em',
  },
  '.cm-frontmatter-strip': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.4em',
    padding: '0.35em 1rem',
    backgroundColor: 'var(--ed-frontmatter-bg)',
    borderBottom: '1px solid var(--ed-frontmatter-border)',
  },
  '.cm-frontmatter-strip .cm-tag': { cursor: 'pointer' },
  '.cm-frontmatter-count': {
    color: 'var(--ed-ink-muted)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.8em',
  },
  '.cm-frontmatter-badge': {
    color: 'var(--ed-ink-muted)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.8em',
    border: '1px dashed var(--ed-frontmatter-border)',
    borderRadius: '0.25em',
    padding: '0 0.4em',
  },

  '.cm-table-pipe': { color: 'var(--ed-marker)' },
  '.cm-table-head': { fontWeight: '600' },
  '.cm-table-wrap': { overflowX: 'auto', padding: '0.3em 1rem' },
  '.cm-table': { borderCollapse: 'collapse', fontSize: '0.95em' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--ed-table-border)',
    padding: '0.25em 0.6em',
    textAlign: 'left',
  },
  '.cm-table th': { backgroundColor: 'var(--ed-table-header-bg)' },
  '.cm-table tbody tr:nth-child(even)': { backgroundColor: 'var(--ed-table-row-alt-bg)' },

  // --- collab (class names come from y-codemirror.next) --------------------
  // The peer COLOUR is written as an inline style from awareness, so only the
  // chrome is themeable here. Moving the colour itself onto --ed-presence-N
  // is an awareness wire-format change — see binding.ts TODO(V2).
  '.cm-ySelectionCaret': {
    borderLeftWidth: 'var(--ed-peer-caret-width)',
    borderRightWidth: 'var(--ed-peer-caret-width)',
  },
  '.cm-ySelectionInfo': {
    color: 'var(--ed-peer-label-fg)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: 'var(--ed-peer-label-font-size)',
    fontStyle: 'normal',
    fontWeight: '600',
    borderRadius: 'var(--ed-peer-label-radius)',
    padding: '2px 5px',
    opacity: '1',
  },
})

/**
 * One HighlightStyle for every theme — the values are custom properties, so
 * the palette flips with [data-theme] and this never needs a dark variant.
 */
export const editorHighlightStyle = HighlightStyle.define([
  // --- markdown structure ---
  { tag: t.heading1, color: 'var(--ed-h1)', fontSize: 'var(--ed-h1-size)', fontWeight: 'var(--ed-heading-weight)' },
  { tag: t.heading2, color: 'var(--ed-h2)', fontSize: 'var(--ed-h2-size)', fontWeight: 'var(--ed-heading-weight)' },
  { tag: t.heading3, color: 'var(--ed-h3)', fontSize: 'var(--ed-h3-size)', fontWeight: 'var(--ed-heading-weight)' },
  { tag: t.heading4, color: 'var(--ed-h4)', fontSize: 'var(--ed-h4-size)', fontWeight: 'var(--ed-heading-weight)' },
  { tag: t.heading5, color: 'var(--ed-h5)', fontSize: 'var(--ed-h5-size)', fontWeight: 'var(--ed-heading-weight)' },
  { tag: t.heading6, color: 'var(--ed-h6)', fontSize: 'var(--ed-h6-size)', fontWeight: 'var(--ed-heading-weight)' },

  { tag: t.strong, color: 'var(--ed-bold)', fontWeight: '600' },
  { tag: t.emphasis, color: 'var(--ed-italic)', fontStyle: 'italic' },
  { tag: t.strikethrough, color: 'var(--ed-strike)', textDecoration: 'line-through' },

  { tag: t.link, color: 'var(--ed-link)' },
  { tag: t.url, color: 'var(--ed-url)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--ed-code-fg)', fontFamily: 'var(--ed-font-mono)' },
  { tag: t.quote, color: 'var(--ed-quote-fg)', fontStyle: 'italic' },
  { tag: t.contentSeparator, color: 'var(--ed-hr)', fontWeight: '700' },
  // NO rule for t.list: @lezer/markdown tags it as `BulletList/...`, i.e.
  // every descendant, so colouring it tints the whole list's TEXT rather than
  // its bullets. The bullets are ListMark, which is processingInstruction
  // below. (--ed-bullet is for live preview's rendered bullets, V2e.)

  // The literal `#`, `*`, `>`, `-` marks. Dimming them is most of what makes
  // source mode readable.
  { tag: t.processingInstruction, color: 'var(--ed-marker)' },
  // Our own derived tags win over the base tag they were defined from.
  { tag: wikiLinkTag, color: 'var(--ed-wikilink)' },
  { tag: wikiLinkMarkTag, color: 'var(--ed-wikilink-punct)' },
  { tag: tagTag, color: 'var(--ed-tag-fg)' },
  { tag: highlightTag, backgroundColor: 'var(--ed-mark-bg)', color: 'var(--ed-mark-fg)' },
  { tag: t.meta, color: 'var(--ed-frontmatter-fg)' },

  // --- nested fenced-code languages ---
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.definitionKeyword], color: 'var(--ed-syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--ed-syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--ed-syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--ed-syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--ed-syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--ed-syn-type)' },
  { tag: [t.variableName, t.propertyName, t.attributeName, t.labelName], color: 'var(--ed-syn-variable)' },
  { tag: [t.operator, t.punctuation, t.derefOperator, t.separator], color: 'var(--ed-syn-operator)' },
  { tag: t.invalid, color: 'var(--ed-syn-invalid)' },
])

/** The full theme bundle. `dark` drives ONLY CM6's own base-theme selection. */
export function editorTheme(dark: boolean): Extension {
  return [
    editorBaseTheme,
    themeModeCompartment.of(EditorView.darkTheme.of(dark)),
    syntaxHighlighting(editorHighlightStyle),
  ]
}
