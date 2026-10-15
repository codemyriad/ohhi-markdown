/**
 * A wikilink under a finger (QA round 1, 2026-10-15). Chris, on a phone: "I
 * keep accidentally opening the note it links to." A rendered link follows on
 * a plain click (R2.4) — right for a mouse, which lands where it is aimed,
 * wrong for a thumb, which lands on whatever is near and is also how you put
 * the caret into text to edit it.
 *
 * So on a COARSE pointer (a touch or a pen — the pointer that pressed, not
 * the width of the window), a tap on a rendered wikilink places the caret
 * where it landed — the brackets come back, as for any link being edited —
 * and shows the LINK CARD over it: one button, *Open “Name”* (*Create “Name”*
 * for a link to nothing). The note opens from the card, or from a second tap
 * on the link while the card is up. Typing, or moving the caret off the link,
 * takes the card down. A mouse is unchanged: a click on a rendered link
 * follows it, Mod-click a raw one.
 *
 * The card is a CM6 tooltip like the table hint (`table-hint.ts`), styled in
 * libs/editor's theme (`.cm-link-card`); its copy arrives through
 * `readHost`'s labels.
 */
import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { FALLBACK_LINK_CARD_LABELS, readHost } from '../read-host.js'
import { wikiLinkHost } from '../wikilink-view.js'
import { icon } from './icons.js'
import { claim } from './widgets.js'

/** The link the card is about: its whole `[[…]]` range and the target it names. */
export interface TappedLink {
  from: number
  to: number
  target: string
}

interface Card extends TappedLink {
  tooltip: Tooltip
}

/** Show the card over a link, or (null) take it down. */
export const showLinkCard = StateEffect.define<TappedLink | null>({
  map: (link, changes) =>
    link && { ...link, from: changes.mapPos(link.from, 1), to: changes.mapPos(link.to, -1) },
})

/** The open card, or null. Kept as the same object while it stays up, so CM6 never rebuilds its DOM. */
export const linkCard = StateField.define<Card | null>({
  create: () => null,
  update(card, tr) {
    for (const effect of tr.effects) {
      if (effect.is(showLinkCard)) return effect.value ? cardFor(effect.value) : null
    }
    if (!card) return null
    // Typing takes it down; so does the caret leaving the link.
    if (tr.docChanged) return null
    if (tr.selection && !caretOn(tr.state, card)) return null
    return card
  },
  provide: (field) => showTooltip.from(field, (card) => card?.tooltip ?? null),
})

function caretOn(state: EditorState, link: TappedLink): boolean {
  const { main } = state.selection
  return state.selection.ranges.length === 1 && main.from >= link.from && main.to <= link.to
}

/** Is the card up over the link starting at `from`? (The second tap's test.) */
export function cardOpenOn(state: EditorState, from: number): boolean {
  return state.field(linkCard, false)?.from === from
}

function cardFor(link: TappedLink): Card {
  return {
    ...link,
    tooltip: { pos: link.from, above: true, create: (view) => createCard(view, link.target) },
  }
}

function createCard(view: EditorView, target: string): { dom: HTMLElement } {
  const t = view.state.facet(readHost).labels.linkCard ?? FALLBACK_LINK_CARD_LABELS
  const resolved = view.state.facet(wikiLinkHost).resolve(target) !== null
  const dom = document.createElement('div')
  dom.className = 'cm-link-card'
  dom.setAttribute('role', 'group')
  dom.setAttribute('aria-label', t.label)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'cm-link-card-open'
  button.dataset.testid = 'link-card-open'
  button.appendChild(icon(resolved ? 'file' : 'file-plus'))
  button.append(resolved ? t.open(target) : t.create(target))
  // Claimed: a press keeps the editor's selection; the click opens.
  claim(button, () => openTapped(view, target))
  dom.appendChild(button)
  return { dom }
}

/** Open the link's note (or create it), taking the card down first. */
export function openTapped(view: EditorView, target: string): void {
  view.dispatch({ effects: showLinkCard.of(null) })
  const host = view.state.facet(wikiLinkHost)
  const path = host.resolve(target)
  if (path) host.open(path)
  else host.create(target)
}

/** The first tap: the caret where the finger landed (inside the link), and the card over it. */
export function tapLink(view: EditorView, at: number, link: TappedLink): void {
  const anchor = Math.min(Math.max(at, link.from + 2), link.to - 2)
  view.dispatch({
    selection: { anchor },
    effects: showLinkCard.of(link),
    userEvent: 'select.pointer',
    scrollIntoView: true,
  })
  view.focus()
}

// ---- which pointer pressed ----

/** The pointer type of each view's last `pointerdown` (it always precedes the mouse event it becomes). */
const lastPointer = new WeakMap<EditorView, string>()

/** Records the pressing pointer's type; install beside the click handlers. */
export const pointerKind = EditorView.domEventHandlers({
  pointerdown(event, view) {
    lastPointer.set(view, event.pointerType)
    return false
  },
})

/**
 * Was this press a finger or a pen? By the `pointerdown` that preceded it;
 * an engine that sent none falls back to the device's primary pointer.
 */
export function coarsePress(view: EditorView): boolean {
  const kind = lastPointer.get(view)
  if (kind) return kind === 'touch' || kind === 'pen'
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
