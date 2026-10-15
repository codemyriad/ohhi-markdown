/**
 * The selection handle's items (selection explorations, shape B), the pure
 * half of `SelectionBar.svelte`: the layout's `bars.selection` as the
 * command ids the handle draws, in order.
 *
 * An item that cannot run now is LEFT OUT, not disabled: `ai.ask-selection`
 * without a provider (nothing AI-shaped without one), a format command in
 * Reading. `"|"` entries are dropped — the handle draws a thin divider
 * between every two items itself — and a repeated id is drawn once.
 */
import { SEPARATOR } from './layout-spec.js'

export function selectionItems(ids: readonly string[], available: (id: string) => boolean): string[] {
  const out: string[] = []
  for (const id of ids) if (id !== SEPARATOR && !out.includes(id) && available(id)) out.push(id)
  return out
}
