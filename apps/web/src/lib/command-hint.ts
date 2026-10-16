/**
 * What a bar button's tooltip says (Chris, 2026-10-15: "Formatting options
 * should have a little tooltip if I hover them"): the command's title and,
 * when it has one, its key as bound now in the readable keycap form the
 * registry formats (`registry.binding`, the one the comments' empty state
 * names) — "Bold · Ctrl+B". The button's accessible name stays the title.
 */
import { getLL } from '@ohhi/i18n'

export function commandHint(title: string, binding: string): string {
  return binding ? getLL().web.toolbar.hint({ title, binding }) : title
}
