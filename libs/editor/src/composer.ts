/**
 * The Session view's composer (writing-harness-shaping B4,
 * `plans/research/harness-chat-ui.md` §Composer): a second, tiny CM6 view
 * built from this package's pieces — plain text, no markdown language, no
 * Y.Text — whose one special power is the mention chip.
 *
 * A chip is the literal text `@<label>` in the document, covered by a
 * `Decoration.replace` widget and returned from `EditorView.atomicRanges`,
 * so the caret steps over it and Backspace removes it whole (CM6's deletion
 * commands move by atomic ranges). The chip ranges live in a `StateField`
 * mapped through every change; a range that collapses is gone. What the
 * chip MEANS (a `Mention`) is the host's: the field only carries its id.
 *
 * Completion is the host's too, and deliberately not `@codemirror/autocomplete`
 * (not a dependency here, and its tooltip would be an overlay outside the
 * shell's `lib/ui` primitives — the axe gate's concern). The composer reports
 * a TRIGGER — `@query` after a space or at a line start, `/query` at a line
 * start — and, while the host says its menu is open, hands it the arrow keys,
 * Enter, Tab and Escape. Enter otherwise sends; Shift+Enter is a newline.
 *
 * Colour comes from `--ed-*` only (the theme.ts rule: no literal colour in a
 * CM6 theme object).
 *
 * The caret is DRAWN (`drawSelection()`), not the browser's. An empty
 * composer's one line holds no text — only CM6's widget-buffer `<img>` and the
 * `contenteditable=false` placeholder — so a native caret has no glyph to
 * measure and each engine guesses (Chromium draws it the full line box tall;
 * others at the line's edge or above the text, in the padding). The
 * drawn caret comes from `coordsAtPos`, which the placeholder widget answers
 * with its own first text rect: where the first typed character lands, and
 * that character's height.
 */
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  placeholder as placeholderExt,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'

/** A chip as the host names it. */
export interface ComposerChip {
  id: string
  label: string
  /** What the chip's text starts with: `@` for a reference (default), `/` for a skill. */
  sigil?: '@' | '/'
}

/** A chip and where it sits in the composer's text. */
export interface ChipRange extends ComposerChip {
  from: number
  to: number
}

/** What the person is typing a completion for: `@pla` or `/sum`, and where. */
export interface ComposerTrigger {
  kind: '@' | '/'
  query: string
  /** The range the trigger covers, sigil included — what a pick replaces. */
  from: number
  to: number
}

export type ComposerMenuKey = 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Tab' | 'Escape'

export interface ComposerOptions {
  parent: HTMLElement
  /** The draft to start from (text + its chips' ranges). */
  doc?: string
  chips?: ChipRange[]
  /** The content's accessible name. */
  ariaLabel: string
  placeholder?: string
  /** The chip's static DOM (no Svelte inside CodeMirror — a widget is rebuilt on `eq`). */
  renderChip(chip: ComposerChip): HTMLElement
  /** Enter with no menu open. */
  onSubmit(): void
  /** Every text, chip or caret change. */
  onChange(state: { text: string; chips: ChipRange[]; trigger: ComposerTrigger | null }): void
  /** The host's menu is open and wants this key; true = consumed. */
  onMenuKey(key: ComposerMenuKey): boolean
  /** Extra attributes for the content element (the combobox wiring). */
  contentAttributes?: Record<string, string>
}

export interface ComposerHandle {
  view: EditorView
  /** Insert a chip over `at` (a trigger's range) or at the caret, followed by a space. */
  insertChip(chip: ComposerChip, at?: { from: number; to: number }): void
  /** Replace `at` (or the selection) with plain text. */
  insertText(text: string, at?: { from: number; to: number }): void
  chips(): ChipRange[]
  text(): string
  /** Empty the composer (after a send). */
  clear(): void
  focus(): void
  /** Re-label the content (aria-activedescendant while the menu is open). */
  setContentAttributes(attrs: Record<string, string>): void
  destroy(): void
}

class ChipWidget extends WidgetType {
  constructor(
    readonly chip: ComposerChip,
    readonly render: (chip: ComposerChip) => HTMLElement
  ) {
    super()
  }
  eq(other: ChipWidget): boolean {
    return other.chip.id === this.chip.id && other.chip.label === this.chip.label && other.chip.sigil === this.chip.sigil
  }
  toDOM(): HTMLElement {
    return this.render(this.chip)
  }
  ignoreEvent(): boolean {
    return false
  }
}

const addChip = StateEffect.define<ChipRange>({
  map: (c, mapping) => ({ ...c, from: mapping.mapPos(c.from, 1), to: mapping.mapPos(c.to, -1) }),
})

/** The chips' text: what the composer's plain text says where a chip sits. */
export function chipText(chip: ComposerChip): string {
  return `${chip.sigil ?? '@'}${chip.label}`
}

function chipField(render: (chip: ComposerChip) => HTMLElement): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(set, tr) {
      let next = set.map(tr.changes)
      const added = tr.effects.filter((e) => e.is(addChip)).map((e) => e.value as ChipRange)
      if (added.length) {
        next = next.update({
          add: added
            .filter((c) => c.to > c.from)
            .sort((a, b) => a.from - b.from)
            .map((c) =>
              Decoration.replace({
                widget: new ChipWidget({ id: c.id, label: c.label, ...(c.sigil ? { sigil: c.sigil } : {}) }, render),
              }).range(c.from, c.to)
            ),
          sort: true,
        })
      }
      return next
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
  })
}

function rangesOf(set: DecorationSet): ChipRange[] {
  const out: ChipRange[] = []
  const cursor = set.iter()
  while (cursor.value) {
    const widget = cursor.value.spec.widget as ChipWidget | undefined
    if (widget && cursor.to > cursor.from) out.push({ ...widget.chip, from: cursor.from, to: cursor.to })
    cursor.next()
  }
  return out
}

/** The trigger at an empty caret, unless it starts inside a chip. Pure over the state. */
export function triggerAt(state: EditorState, chips: readonly ChipRange[]): ComposerTrigger | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const head = sel.head
  const line = state.doc.lineAt(head)
  const before = state.sliceDoc(line.from, head)
  const slash = /^\/([\w-]*)$/.exec(before)
  if (slash) return { kind: '/', query: slash[1], from: line.from, to: head }
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (!at) return null
  const from = head - at[1].length - 1
  if (chips.some((c) => from >= c.from && from < c.to)) return null
  return { kind: '@', query: at[1], from, to: head }
}

const composerTheme = EditorView.theme({
  '&': {
    color: 'var(--ed-ink)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--ed-font-ui)',
    fontSize: '0.875rem',
    maxHeight: '12rem',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.5', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--ed-caret)', padding: '0.5rem 0', minHeight: '2.5rem' },
  '.cm-line': { padding: '0 0.75rem' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ed-caret)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ed-selection)',
  },
  // One line, however long the hint: a wrapping placeholder would make the
  // empty field taller than its first typed line, and the caret would jump
  // when the field shrinks (the composer is anchored at the pane's foot).
  // `contain: inline-size` keeps the hint from widening CM's content box
  // (a flex item that never shrinks below its content), which would make
  // the scroller scroll sideways — axe's scrollable-region-focusable.
  '.cm-placeholder': {
    color: 'var(--ed-ink-muted)',
    display: 'inline-block',
    width: '100%',
    contain: 'inline-size',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    verticalAlign: 'top',
  },
  '.ohhi-chip': {
    display: 'inline',
    padding: '0 0.35em',
    margin: '0 0.05em',
    borderRadius: 'var(--ed-tag-radius)',
    backgroundColor: 'var(--ed-tag-bg)',
    color: 'var(--ed-tag-fg)',
    whiteSpace: 'nowrap',
  },
  '.ohhi-chip[data-changed]': { textDecoration: 'underline dotted' },
})

export function createComposer(opts: ComposerOptions): ComposerHandle {
  const field = chipField(opts.renderChip)
  const report = (state: EditorState): void => {
    const chips = rangesOf(state.field(field))
    opts.onChange({ text: state.doc.toString(), chips, trigger: triggerAt(state, chips) })
  }
  const menuKey = (key: ComposerMenuKey) => (): boolean => opts.onMenuKey(key)
  const keys: Extension = Prec.highest(
    keymap.of([
      { key: 'ArrowUp', run: menuKey('ArrowUp') },
      { key: 'ArrowDown', run: menuKey('ArrowDown') },
      { key: 'Tab', run: menuKey('Tab') },
      { key: 'Escape', run: menuKey('Escape') },
      {
        key: 'Enter',
        run: () => {
          if (opts.onMenuKey('Enter')) return true
          opts.onSubmit()
          return true
        },
        shift: insertNewline,
      },
    ])
  )
  const baseAttrs = { 'aria-label': opts.ariaLabel, 'aria-multiline': 'true', ...opts.contentAttributes }
  const attrsEffect = StateEffect.define<Record<string, string>>()
  const attrsField = StateField.define<Record<string, string>>({
    create: () => baseAttrs,
    update: (v, tr) => tr.effects.find((e) => e.is(attrsEffect))?.value ?? v,
    provide: (f) => EditorView.contentAttributes.from(f),
  })

  const state = EditorState.create({
    doc: opts.doc ?? '',
    extensions: [
      keys,
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      drawSelection(),
      composerTheme,
      attrsField,
      field,
      ...(opts.placeholder ? [placeholderExt(opts.placeholder)] : []),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(addChip)))) report(u.state)
      }),
    ],
  })
  const view = new EditorView({ state, parent: opts.parent })
  const docLen = view.state.doc.length
  const restored = (opts.chips ?? []).filter((c) => c.from >= 0 && c.to <= docLen && c.to > c.from)
  if (restored.length) view.dispatch({ effects: restored.map((c) => addChip.of(c)) })

  const insertChip = (chip: ComposerChip, at?: { from: number; to: number }): void => {
    const range = at ?? view.state.selection.main
    const text = chipText(chip)
    const from = range.from
    const after = view.state.sliceDoc(range.to, range.to + 1)
    const insert = after === ' ' ? text : `${text} `
    view.dispatch({
      changes: { from, to: range.to, insert },
      selection: { anchor: from + insert.length + (after === ' ' ? 1 : 0) },
      effects: addChip.of({ ...chip, from, to: from + text.length }),
      scrollIntoView: true,
    })
  }

  return {
    view,
    insertChip,
    insertText(text, at) {
      const range = at ?? view.state.selection.main
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length },
      })
    },
    chips: () => rangesOf(view.state.field(field)),
    text: () => view.state.doc.toString(),
    clear() {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
    },
    focus: () => view.focus(),
    setContentAttributes(next) {
      view.dispatch({ effects: attrsEffect.of({ ...baseAttrs, ...next }) })
    },
    destroy: () => view.destroy(),
  }
}

/**
 * The selection of the editor mounted inside `root` — the note text and the
 * main range — for capturing a reference (`ai.add-selection`). Read through
 * `EditorView.findFromDOM`, like `selectedTextIn`: the host never holds a
 * view. Null when there is no editor there or nothing is selected.
 */
export function selectionIn(root: ParentNode | null | undefined): { text: string; from: number; to: number } | null {
  const dom = root?.querySelector<HTMLElement>('.cm-editor')
  if (!dom) return null
  const view = EditorView.findFromDOM(dom)
  if (!view) return null
  const { from, to } = view.state.selection.main
  if (from === to) return null
  return { text: view.state.doc.toString(), from, to }
}
