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
 * See docs/theming.md and v2-shaping (Fork 2).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { highlightTag, tagTag, wikiLinkMarkTag, wikiLinkTag } from '@ohhi/editor-lang'

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
  // --- the suggestion controls (writing-harness QA round 1) ----------------
  // The Accept / Reject pair after a proposal: a pill on the editing surface,
  // each verb in its own suggestion colour (both clear 4.5:1 on --ed-surface,
  // theme-contract.test.ts), the key a quiet hint. The current proposal's
  // pair is ringed in the proposal colour; one drawn because the pointer is
  // over it keeps the plain hairline — never faded text.
  '.ed-suggest-pair': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2px',
    marginLeft: '6px',
    padding: '1px 2px',
    verticalAlign: 'baseline',
    border: '1px solid var(--ed-popover-border)',
    borderRadius: '999px',
    backgroundColor: 'var(--ed-surface)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '11.5px',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
  '.ed-suggest-pair-current': { borderColor: 'var(--ed-suggest-add)' },
  '.ed-suggest-pair button': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    margin: '0',
    padding: '0 7px',
    border: 'none',
    borderRadius: '999px',
    backgroundColor: 'transparent',
    font: 'inherit',
    fontWeight: '500',
    cursor: 'pointer',
  },
  '.ed-suggest-pair button:hover': { backgroundColor: 'var(--ed-active-line)' },
  '.ed-suggest-pair button:focus-visible': { outline: '2px solid var(--ed-caret)', outlineOffset: '1px' },
  '.ed-suggest-pair .ed-suggest-accept': { color: 'var(--ed-suggest-add)' },
  '.ed-suggest-pair .ed-suggest-reject': { color: 'var(--ed-suggest-del)' },
  '.ed-suggest-pair kbd': {
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '10px',
    color: 'var(--ed-ink-muted)',
  },
  // A proposal's mark in the gutter: a dot, or its number among several.
  '.ed-suggest-gutter': { minWidth: '18px' },
  '.ed-suggest-marker': {
    display: 'grid',
    placeItems: 'center',
    minWidth: '14px',
    height: '14px',
    margin: '0.35em 2px 0',
    padding: '0 3px',
    border: '1px solid var(--ed-suggest-add)',
    borderRadius: '999px',
    backgroundColor: 'var(--ed-surface)',
    color: 'var(--ed-suggest-add)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '9.5px',
    fontWeight: '600',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.ed-suggest-marker:empty': { minWidth: '8px', width: '8px', height: '8px', padding: '0', margin: '0.55em 5px 0', backgroundColor: 'var(--ed-suggest-add)' },
  '.ed-suggest-marker-current': { backgroundColor: 'var(--ed-suggest-add)', color: 'var(--ed-surface)' },
  '.ed-suggest-marker:focus-visible': { outline: '2px solid var(--ed-caret)', outlineOffset: '1px' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--ed-bracket-match-bg)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search-match-bg)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ed-search-match-active-bg)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--ed-code-block-bg)',
    color: 'var(--ed-ink)',
    border: '1px solid var(--ed-code-border)',
  },
  // Every floating tooltip (the table hint, the completion popover below) is
  // dressed as the shell's Popover through --ed-popover-*.
  '.cm-tooltip': {
    backgroundColor: 'var(--ed-popover-bg)',
    color: 'var(--ed-popover-ink)',
    border: '1px solid var(--ed-popover-border)',
    borderRadius: 'var(--ed-card-radius)',
    boxShadow: 'var(--ed-popover-shadow)',
  },
  // --- the completion popover (editor-usability E1) -----------------------
  // Dressed as the shell's Popover (the card radius, a base-300 hairline, base-100,
  // shadow-xl) through --ed-popover-*, for `[[` links and `#` tags alike.
  // Compact rows: ~22px, icon · name (match bold in primary) · folder dim and
  // right-aligned on the same line. The link popover adds one-line group
  // headers and a footer of key hints (`.cm-link-*`, link-completion-view.ts).
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: 'var(--ed-popover-bg)',
    color: 'var(--ed-popover-ink)',
    border: '1px solid var(--ed-popover-border)',
    borderRadius: 'var(--ed-card-radius)',
    boxShadow: 'var(--ed-popover-shadow)',
    overflow: 'hidden',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '13px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    minWidth: '18rem',
    maxWidth: 'min(28rem, 92vw)',
    maxHeight: '17rem',
    padding: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    height: '22px',
    lineHeight: '22px',
    padding: '0 6px',
    borderRadius: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--ed-popover-selected)',
    color: 'var(--ed-popover-ink)',
  },
  '.cm-tooltip-autocomplete .cm-completionLabel': {
    flex: '0 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-tooltip-autocomplete .cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '600',
    color: 'var(--ed-popover-match)',
  },
  '.cm-tooltip-autocomplete .cm-completionDetail': {
    flex: '0 3 auto',
    minWidth: '0',
    marginLeft: 'auto',
    paddingLeft: '12px',
    fontStyle: 'normal',
    fontSize: '12px',
    color: 'var(--ed-popover-faint)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // The footer is appended after the list; CM6 may re-append a fresh list
  // after it, so the order is the stylesheet's, not the DOM's.
  '.cm-tooltip.cm-tooltip-autocomplete.cm-link-popover': {
    display: 'flex',
    flexDirection: 'column',
  },
  '.cm-link-popover .cm-completionIcon': { display: 'none' },
  '.cm-link-icon': {
    display: 'inline-flex',
    flex: 'none',
    width: '13px',
    height: '13px',
    color: 'var(--ed-popover-faint)',
  },
  '.cm-link-icon .cm-icon': { width: '100%', height: '100%' },
  '.cm-link-create .cm-link-icon, .cm-link-create .cm-completionLabel': {
    color: 'var(--ed-popover-match)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section.cm-link-section': {
    display: 'list-item',
    listStyle: 'none',
    padding: '6px 6px 2px',
    borderBottom: 'none',
    opacity: '1',
    fontSize: '10.5px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    lineHeight: '1.3',
    textTransform: 'uppercase',
    color: 'var(--ed-popover-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section.cm-link-section-divided': {
    borderTop: '1px solid var(--ed-popover-border)',
    marginTop: '4px',
    paddingTop: '8px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section.cm-link-section-bare': {
    display: 'none',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section.cm-link-section-rule': {
    height: '0',
    padding: '0',
    margin: '4px 0',
    borderTop: '1px solid var(--ed-popover-border)',
  },
  '.cm-link-footer': {
    order: '1',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    backgroundColor: 'var(--ed-popover-footer-bg)',
    borderTop: '1px solid var(--ed-popover-border)',
    color: 'var(--ed-popover-muted)',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  '.cm-link-footer kbd': {
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '10px',
    lineHeight: '14px',
    minWidth: '14px',
    padding: '0 4px',
    textAlign: 'center',
    color: 'var(--ed-popover-ink)',
    backgroundColor: 'var(--ed-popover-bg)',
    border: '1px solid var(--ed-popover-border)',
    borderRadius: '3px',
  },
  '.cm-link-footer-dot': { padding: '0 2px', color: 'var(--ed-popover-faint)' },
  '.cm-tooltip-autocomplete:not(.cm-link-popover) .cm-link-footer': { display: 'none' },

  // --- live preview (read-shaping B2) -----------------------------------
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
  // The `> ` on the caret's line (E2): still the document's own text, so the
  // caret walks through it as through any text, but out of the flow — the
  // words after it start where they start with the marker hidden — and hung
  // to the left of them, in the line's padding beside the border. Absolute
  // with no offsets keeps its static (inline) position; the transform moves
  // it back by its own width.
  '.cm-quote-hang': {
    position: 'absolute',
    transform: 'translateX(-100%)',
    whiteSpace: 'pre',
  },

  // --- code card and callouts (editor-usability E3) ------------------------
  // A fence is ONE card: every line carries the background and the side
  // hairlines, the edges the top/bottom hairline and the card radius — on the
  // header bar and the cap when they are drawn, on the fence line itself
  // (`cm-code-first` / `cm-code-last`) when the caret has made it text. Lines
  // and block widgets touch, so there is no seam between them.
  '.cm-live-code': {
    backgroundColor: 'var(--ed-code-block-bg)',
    color: 'var(--ed-code-block-fg)',
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '0.92em',
    borderLeft: '1px solid var(--ed-code-border)',
    borderRight: '1px solid var(--ed-code-border)',
  },
  '.cm-code-first': {
    borderTop: '1px solid var(--ed-code-border)',
    borderTopLeftRadius: 'var(--ed-card-radius)',
    borderTopRightRadius: 'var(--ed-card-radius)',
  },
  '.cm-code-last': {
    borderBottom: '1px solid var(--ed-code-border)',
    borderBottomLeftRadius: 'var(--ed-card-radius)',
    borderBottomRightRadius: 'var(--ed-card-radius)',
  },
  '.cm-fence-line': {
    backgroundColor: 'var(--ed-code-block-bg)',
    borderLeft: '1px solid var(--ed-code-border)',
    borderRight: '1px solid var(--ed-code-border)',
  },
  '.cm-fence-open': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    padding: '0.25rem 0.5rem 0.1rem 0.75rem',
    borderTop: '1px solid var(--ed-code-border)',
    borderTopLeftRadius: 'var(--ed-card-radius)',
    borderTopRightRadius: 'var(--ed-card-radius)',
    fontFamily: 'var(--ed-font-ui)',
  },
  '.cm-fence-cap': {
    height: '0.5rem',
    borderBottom: '1px solid var(--ed-code-border)',
    borderBottomLeftRadius: 'var(--ed-card-radius)',
    borderBottomRightRadius: 'var(--ed-card-radius)',
  },
  '.cm-fence-chip, .cm-fence-copy': {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25em',
    border: 'none',
    background: 'none',
    color: 'var(--ed-ink-muted)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.78em',
    lineHeight: '1.5',
    padding: '0.1em 0.4em',
    borderRadius: '4px',
  },
  'button.cm-fence-chip, .cm-fence-copy': { cursor: 'pointer' },
  'button.cm-fence-chip:hover, .cm-fence-copy:hover': {
    backgroundColor: 'var(--ed-code-bg)',
    color: 'var(--ed-ink)',
  },
  // The one focus ring of the buttons a widget owns (widgets.ts `claim`).
  '.cm-fence-chip:focus-visible, .cm-fence-copy:focus-visible, .cm-callout-fold:focus-visible, .cm-embed-remote-load:focus-visible':
    {
      outline: '2px solid var(--ed-focus-ring)',
      outlineOffset: '1px',
    },
  '.cm-fence-copied': { color: 'var(--ed-code-copied)' },
  '.cm-fence-lang': { textTransform: 'lowercase' },
  '.cm-fence-line .cm-icon, .cm-callout .cm-icon': {
    width: '1em',
    height: '1em',
    flex: 'none',
  },

  // Callouts: a tinted box with a hairline all round (no coloured rail), the
  // title row in the type's colour. `--cm-callout` is set per type and read
  // by the box, the border and the title alike, so a theme repaints a type
  // through its one `--ed-callout-*` token.
  // Every callout line carries a `.cm-callout-type-*` class (an unknown type
  // reads as note), so `--cm-callout` has no default here.
  '.cm-callout': {
    '--cm-callout-line': 'color-mix(in srgb, var(--cm-callout) 26%, transparent)',
    backgroundColor: 'color-mix(in srgb, var(--cm-callout) 9%, transparent)',
    borderLeft: '1px solid var(--cm-callout-line)',
    borderRight: '1px solid var(--cm-callout-line)',
    color: 'var(--ed-ink)',
    // The body is a quote to the highlighter, which paints quote text muted;
    // a callout's body is normal ink, so the token is restated in the box.
    '--ed-quote-fg': 'var(--ed-ink)',
  },
  '.cm-callout-type-note': { '--cm-callout': 'var(--ed-callout-note)' },
  '.cm-callout-type-abstract': { '--cm-callout': 'var(--ed-callout-abstract)' },
  '.cm-callout-type-info': { '--cm-callout': 'var(--ed-callout-info)' },
  '.cm-callout-type-todo': { '--cm-callout': 'var(--ed-callout-todo)' },
  '.cm-callout-type-tip': { '--cm-callout': 'var(--ed-callout-tip)' },
  '.cm-callout-type-success': { '--cm-callout': 'var(--ed-callout-success)' },
  '.cm-callout-type-question': { '--cm-callout': 'var(--ed-callout-question)' },
  '.cm-callout-type-warning': { '--cm-callout': 'var(--ed-callout-warning)' },
  '.cm-callout-type-failure': { '--cm-callout': 'var(--ed-callout-failure)' },
  '.cm-callout-type-danger': { '--cm-callout': 'var(--ed-callout-danger)' },
  '.cm-callout-type-bug': { '--cm-callout': 'var(--ed-callout-bug)' },
  '.cm-callout-type-example': { '--cm-callout': 'var(--ed-callout-example)' },
  '.cm-callout-type-quote': { '--cm-callout': 'var(--ed-callout-quote)' },
  '.cm-callout-first': {
    borderTop: '1px solid var(--cm-callout-line)',
    borderTopLeftRadius: 'var(--ed-card-radius)',
    borderTopRightRadius: 'var(--ed-card-radius)',
    paddingTop: '0.3em',
  },
  '.cm-callout-last': {
    borderBottom: '1px solid var(--cm-callout-line)',
    borderBottomLeftRadius: 'var(--ed-card-radius)',
    borderBottomRightRadius: 'var(--ed-card-radius)',
    paddingBottom: '0.3em',
  },
  '.cm-callout-head': { color: 'var(--cm-callout)', fontWeight: '600', '--ed-quote-fg': 'var(--cm-callout)' },
  // The drawn title row: the same box as a line (1rem in), on the line's own
  // height, so the caret entering it does not move the text below.
  'div.cm-callout-head': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45em',
    padding: '0.3em 1rem 0 1rem',
    lineHeight: 'var(--ed-line-height)',
  },
  'div.cm-callout-head.cm-callout-last': { paddingBottom: '0.3em' },
  '.cm-callout-icon': { display: 'inline-flex' },
  '.cm-callout-fold': {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    border: 'none',
    background: 'none',
    color: 'inherit',
    padding: '0.1em',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  '.cm-callout-fold:hover': {
    backgroundColor: 'color-mix(in srgb, var(--cm-callout) 14%, transparent)',
  },
  '.cm-callout-fold .cm-icon': { transition: 'transform 120ms ease' },
  '.cm-callout-fold[aria-expanded="false"] .cm-icon': { transform: 'rotate(-90deg)' },
  '.cm-callout-folded': { height: '0' },

  '.cm-inline-code': {
    backgroundColor: 'var(--ed-code-bg)',
    color: 'var(--ed-code-fg)',
    fontFamily: 'var(--ed-font-mono)',
    fontSize: '0.9em',
    borderRadius: '0.25em',
    padding: '0.1em 0.3em',
  },

  // Lists (Chris, 2026-10-06 — Obsidian's list, measured off its screenshot).
  // Every list line carries `--cm-list-depth` from the syntax tree; nothing is
  // measured. A tab IS one level (the vault's indent unit), so a tab stop of
  // `--ed-list-indent` makes each level that wide; the bullet's box is the same
  // width, so a child's dot sits under its parent's text. The guides are one
  // repeating gradient, `depth` columns wide, a hairline every level, centred
  // on the dot of each ancestor (line padding 1rem + the dot's centre, 0.43em:
  // its 0.25em lead plus half its 0.36em width — keep the three in step).
  // Source has no list-line class, so it keeps the four-column tabs.
  '.cm-list-line': {
    tabSize: 'var(--ed-list-indent)',
    backgroundImage:
      'repeating-linear-gradient(to right, var(--ed-list-guide) 0 1px, transparent 1px var(--ed-list-indent))',
    backgroundSize: 'calc(var(--cm-list-depth, 0) * var(--ed-list-indent)) 100%',
    backgroundPosition: 'calc(1rem + 0.43em - 0.5px) 0',
    backgroundRepeat: 'no-repeat',
  },
  // The bullet's box is a plain INLINE span on the text baseline — never an
  // inline-block. CM6 draws a caret beside a widget from the widget's client
  // rect, and an inline-block's rect is its whole line box (line-height tall),
  // while a text run's is the font's content area: the caret after the dot
  // came out taller and higher than on a paragraph line. An inline span's rect
  // is the same content area as the text beside it; the width is padding.
  '.cm-bullet': {
    display: 'inline',
    verticalAlign: 'baseline',
    lineHeight: 'inherit',
    // The rest of the column after the lead and the dot (0.25em + 0.36em):
    // about half an em to the text at the default 1.1em column.
    paddingRight: 'calc(var(--ed-list-indent) - 0.61em)',
  },
  // An empty item keeps its space as text after the dot (preview/build.ts
  // says why); the box gives that space back so the line does not move when
  // the first character replaces it. 0.243em is a space in Public Sans, the
  // app's prose face — a theme with another face is off by the difference,
  // on empty items only.
  '.cm-bullet-open': { marginRight: '-0.243em' },
  // A filled circle a little over a third of an em, centred on the x-height
  // (`vertical-align: middle` is the baseline plus half the x-height). It is
  // 0.36em tall inside a line far taller, so it never grows the line box.
  '.cm-bullet::before': {
    content: '""',
    display: 'inline-block',
    width: '0.36em',
    height: '0.36em',
    marginLeft: '0.25em',
    borderRadius: '50%',
    backgroundColor: 'var(--ed-bullet)',
    verticalAlign: 'middle',
  },
  // A lone `-` under a paragraph while the caret is on it: a bullet being
  // typed, drawn faint where the real one will sit (fork D1, setext.ts).
  '.cm-bullet-provisional::before': { opacity: '0.45' },
  // …and the paragraph above it keeps its body style: the line class resets
  // the very tokens the HighlightStyle's heading2 rule reads, so the spans it
  // emits resolve to the surrounding text (`currentColor` — a quote's ink in
  // a quote) at 1em. A real setext heading has no such class.
  '.cm-setext-provisional': {
    '--ed-h2': 'currentColor',
    '--ed-h2-size': '1em',
    '--ed-heading-weight': 'normal',
  },
  '.cm-list-num': { color: 'var(--ed-bullet)' },
  // The task box: a real <input type=checkbox> drawn with `appearance: none`
  // (the same 0.9em square in every engine), its bottom on the baseline, in
  // the bullet's column — the negative lead lines a task's text up with a
  // sibling bullet's; the right margin is 0.5em less the space after `]`.
  '.cm-task': {
    appearance: 'none',
    WebkitAppearance: 'none',
    font: 'inherit',
    boxSizing: 'border-box',
    display: 'inline-block',
    position: 'relative',
    width: '0.9em',
    height: '0.9em',
    margin: '0 0.257em 0 calc(var(--ed-list-indent) - 1.4em)',
    padding: '0',
    border: '1px solid var(--ed-checkbox)',
    borderRadius: '0.14em',
    backgroundColor: 'transparent',
    verticalAlign: 'baseline',
    cursor: 'pointer',
  },
  '.cm-task:checked': {
    backgroundColor: 'var(--ed-checkbox-done)',
    borderColor: 'var(--ed-checkbox-done)',
  },
  // The tick: two borders of a rotated box, in the surface colour.
  '.cm-task::before': {
    content: '""',
    display: 'none',
    position: 'absolute',
    left: '50%',
    top: '42%',
    boxSizing: 'border-box',
    width: '0.26em',
    height: '0.5em',
    border: 'solid var(--ed-surface)',
    borderWidth: '0 0.11em 0.11em 0',
    transform: 'translate(-50%, -50%) rotate(45deg)',
  },
  '.cm-task:checked::before': { display: 'block' },
  '.cm-task:focus-visible': { outline: '2px solid var(--ed-checkbox)', outlineOffset: '1px' },
  // A done task's text (fork C1): muted and lightly struck, both tokens.
  '.cm-task-done': {
    color: 'var(--ed-task-done-fg)',
    textDecoration: 'var(--ed-task-done-decoration)',
  },

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
  // them <iframe>, in files an agent can write (read-shaping B7).
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

  // --- images (editor-usability E5): the remote placeholder, the drop overlay ---
  '.cm-embed-remote': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5em',
    color: 'var(--ed-drop-muted)',
    border: '1px dashed var(--ed-code-border)',
    borderRadius: '0.25em',
    padding: '0.3em 0.6em',
    fontSize: '0.9em',
  },
  '.cm-embed-remote-load': {
    font: 'inherit',
    color: 'var(--ed-drop-ink)',
    background: 'transparent',
    border: '1px solid var(--ed-code-border)',
    borderRadius: '0.25em',
    padding: '0.1em 0.5em',
    cursor: 'pointer',
  },
  '.cm-drop-overlay': {
    position: 'absolute',
    inset: '6px',
    zIndex: '5',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25em',
    border: '2px dashed var(--ed-drop-border)',
    backgroundColor: 'var(--ed-drop-bg)',
    borderRadius: 'var(--ed-card-radius)',
    color: 'var(--ed-drop-ink)',
    fontFamily: 'var(--ed-font-ui)',
    pointerEvents: 'none',
  },
  '.cm-drop-overlay-title': { fontSize: '0.95rem', fontWeight: '600' },
  '.cm-drop-overlay-detail': { fontSize: '0.8rem', color: 'var(--ed-drop-muted)' },

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
  // The properties form on a row-note (bases-shaping A7): the strip's own
  // fencing, the interface font inside; the rows are the host's component.
  '.cm-properties-form': {
    backgroundColor: 'var(--ed-frontmatter-bg)',
    borderBottom: '1px solid var(--ed-frontmatter-border)',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.85em',
  },
  // An embedded collection (A6): a bordered block in the note's flow, the
  // host's table inside, never taller than a screen's worth of rows.
  '.cm-embed-collection': {
    display: 'block',
    margin: '0.5em 0',
    border: '1px solid var(--ed-table-border)',
    borderRadius: '0.25em',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.85em',
    overflow: 'hidden',
  },
  '.cm-embed-collection.cm-embed-missing': { display: 'inline-block', border: '1px dashed var(--ed-code-border)' },

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
  // The Live grid (E4): a click on a cell puts the caret in its text.
  '.cm-table-grid': { cursor: 'text' },
  // The hint bar over a table the caret is in (E4). The tooltip's own box
  // (background, border, radius, shadow) is the `.cm-tooltip` rule above —
  // the popover tokens, so it reads as the link popover does.
  '.cm-table-hint': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.15em',
    padding: '0.15em 0.3em',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.75rem',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
  },
  '.cm-table-hint-key': { color: 'var(--ed-popover-muted)', padding: '0 0.35em' },
  '.cm-table-hint-key + .cm-table-hint-key': { borderLeft: '1px solid var(--ed-popover-border)' },
  '.cm-table-hint-key + .cm-table-hint-button': { marginLeft: '0.25em' },
  '.cm-table-hint-button': {
    font: 'inherit',
    color: 'var(--ed-popover-ink)',
    background: 'none',
    border: 'none',
    borderRadius: '0.3em',
    padding: '0.05em 0.45em',
    cursor: 'pointer',
  },
  '.cm-table-hint-button:hover, .cm-table-hint-button:focus-visible': {
    backgroundColor: 'var(--ed-popover-selected)',
    outline: 'none',
  },
  '.cm-table-hint-button:focus-visible': { boxShadow: 'inset 0 0 0 1px var(--ed-popover-match)' },

  // --- the link card (QA round 1): a finger's tap on a wikilink ------------
  // One button over the link, dressed as the table hint; big enough for a
  // thumb (2.75rem tall), never wider than the editor.
  '.cm-link-card': {
    display: 'flex',
    padding: '0.2em',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.8125rem',
    lineHeight: '1.4',
    maxWidth: 'min(22rem, calc(100vw - 2rem))',
  },
  '.cm-link-card-open': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4em',
    minHeight: '2.75rem',
    minWidth: '0',
    font: 'inherit',
    color: 'var(--ed-popover-ink)',
    background: 'none',
    border: 'none',
    borderRadius: '0.3em',
    padding: '0 0.75em',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-link-card-open:hover, .cm-link-card-open:focus-visible': {
    backgroundColor: 'var(--ed-popover-selected)',
    outline: 'none',
  },
  '.cm-link-card-open:focus-visible': { boxShadow: 'inset 0 0 0 1px var(--ed-popover-match)' },
  '.cm-link-card-open .cm-icon': { flexShrink: '0' },

  // --- the selection handle (selection explorations, shape B) ---------------
  // A tooltip dressed as every other (the rule above), as a pill: the app
  // draws `bars.selection` inside it (by default Comment | Ask), placed at
  // the selection's end by `selection-bar.ts`.
  '.cm-tooltip.cm-selection-bar': {
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.75rem',
    lineHeight: '1.4',
    borderRadius: '999px',
    padding: '0.125rem',
    maxWidth: 'min(24rem, calc(100vw - 1rem))',
  },

  // --- collab (class names come from y-codemirror.next) --------------------
  // The peer COLOUR is written as an inline style from awareness, so only the
  // chrome is themeable here. Moving the colour itself onto --ed-presence-N
  // is an awareness wire-format change — see binding.ts TODO(V2).
  '.cm-ySelectionCaret': {
    borderLeftWidth: 'var(--ed-peer-caret-width)',
    borderRightWidth: 'var(--ed-peer-caret-width)',
  },
  // The ink is per label (`peer-label.ts` picks it by the fill's luminance);
  // this is the default for a fill it cannot parse.
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
  // Upright (E2): a quote is set off by its border and its ink, not slanted.
  { tag: t.quote, color: 'var(--ed-quote-fg)' },
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
