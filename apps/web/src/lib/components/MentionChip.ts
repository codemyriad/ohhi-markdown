/**
 * A mention chip's DOM (writing-harness-shaping B4): what the composer's
 * `Decoration.replace` widget draws over the chip's `@label` (or, for a
 * skill, `/name`) text. Static DOM built on every `toDOM`, never a Svelte
 * component — a CM6 widget is rebuilt whenever its `eq` says it differs (the
 * live-preview widget rule, `.claude/skills/ui-development`). Styled by the
 * composer theme's `.ohhi-chip` rule, from the `--ed-tag-*` tokens.
 *
 * `changed` marks a reference whose text moved since it was captured (B5's
 * badge): a dotted underline, and the reason in the accessible name.
 */
import { getLL } from '@ohhi/i18n'
import type { ComposerChip } from '@ohhi/editor/src/composer.js'

export function renderMentionChip(chip: ComposerChip, opts: { changed?: boolean } = {}): HTMLElement {
  const t = getLL().web.ai.refs
  const el = document.createElement('span')
  el.className = 'ohhi-chip'
  el.dataset.testid = 'mention-chip'
  el.dataset.mention = chip.id
  el.setAttribute('role', 'img')
  const label = { label: chip.label }
  el.setAttribute(
    'aria-label',
    chip.sigil === '/' ? t.skill_chip(label) : opts.changed ? t.chip_changed(label) : t.chip(label)
  )
  if (opts.changed) el.dataset.changed = ''
  el.textContent = `${chip.sigil ?? '@'}${chip.label}`
  return el
}
