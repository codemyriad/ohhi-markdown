/**
 * What the toolbar's readouts read about the FOCUSED pane (quiet-shell F6,
 * spike S21 Q3): every readout follows `layout.focus` and that pane's active
 * tab — the same tab `ui.selectedPath` names — so a split never shows one
 * pane's words beside another pane's pill. Pure, over the pane tree and the
 * sync records, so it is tested without a DOM.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import { activeTab, findPane, focusedPane, groupOf, panes, type Group, type Layout, type Pane, type Tab } from './panes.js'
import { pillStatus, type PillStatus, type SyncRecordSnapshot } from './pill-status.js'
import { presenceFor, type Peer, type PresenceByPath } from './presence.js'

export interface Focused {
  pane: Pane
  tab: Tab | null
  /** The note the tab holds; null for an empty or a view tab. */
  path: string | null
  /** The active tab's group in that pane, if it is in one. */
  group: Group | null
}

/**
 * The focused pane and its active tab — or, given `paneId` (a per-pane
 * status bar rendering the same readouts), that pane's. An id no longer in
 * the tree falls back to the focused pane.
 */
export function focusedOf(layout: Layout, paneId?: string): Focused {
  const pane = (paneId !== undefined ? findPane(layout, paneId) : null) ?? focusedPane(layout)
  const tab = activeTab(pane)
  return { pane, tab, path: tab?.path ?? null, group: tab ? groupOf(pane, tab.id) : null }
}

/**
 * The open note's pill — `pillStatus(record)` exactly as the pane computes it
 * (golden rule 4: the readout decides nothing of its own). Null with no note
 * or no record yet.
 */
export function noteStatus(
  files: readonly { path: string; guid: string }[],
  records: Readonly<Record<string, SyncRecordSnapshot | undefined>>,
  path: string | null
): PillStatus | null {
  if (!path) return null
  const guid = files.find((f) => f.path === path)?.guid
  const record = guid ? records[guid] : undefined
  return record ? pillStatus(record) : null
}

/** While a pane is zoomed: how many others are kept but off screen. Null when nothing is zoomed. */
export function zoomedAway(layout: Layout): number | null {
  if (layout.zoom === null) return null
  return Math.max(0, panes(layout.tree).length - 1)
}

/**
 * Who else is in the focused note (sharing E1): what the `pane.lead` readout
 * says "with …" about. Empty with no note, a view tab, or nobody there (R6).
 */
export function focusedPeers(layout: Layout, presence: PresenceByPath, paneId?: string): readonly Peer[] {
  return presenceFor(presence, focusedOf(layout, paneId).path)
}

/** "Pane 2 · 3 tabs" — the lead a status bar or the `pane.lead` readout shows. */
export function leadText(index: number, tabs: number, LL: TranslationFunctions = getLL()): string {
  // The separator and the clause order are the dictionary's: a locale that
  // wants "11 tabs, Pane 2" has to be able to say so.
  return LL.web.panes.lead({ pane: LL.web.panes.label({ n: index }), tabs: LL.web.panes.tab_count({ count: tabs }) })
}
