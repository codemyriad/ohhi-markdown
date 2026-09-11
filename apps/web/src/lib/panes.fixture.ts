/**
 * The pane-tree fixtures every layout suite builds on (`panes.test.ts`,
 * `groups.test.ts`, `workspace-layout.test.ts`).
 *
 * Not a `.test.ts`, so vitest's test glob leaves it alone.
 *
 * The measured tree is the natural fixture: Chris's real four panes, 21 tabs,
 * splits three deep and every border at a hand-dragged percentage, verbatim
 * from `.obsidian/workspace.json` (2026-09-10). A test that passes on a tidy
 * two-pane tree and fails on his is a test that was never about his vault.
 */
import { createLayout, normalize, openPath, panes, type Layout, type Pane } from './panes.js'

/** Deterministic ids — `panes.ts` takes every id it mints from here (rule 2). */
export function ids(prefix = 'i'): () => string {
  let n = 0
  return () => `${prefix}${n++}`
}

export const paneAt = (l: Layout, i = 0): Pane => panes(l.tree)[i]
export const pathsOf = (p: Pane): (string | null)[] => p.tabs.map((t) => t.path)
export const tabIdFor = (p: Pane, path: string): string => p.tabs.find((t) => t.path === path)!.id

// ---- Chris's saved layout, verbatim from .obsidian/workspace.json (2026-09-10)

export const TOP = [
  'Personal Development.md',
  'May 2026.md',
  'June 2026.md',
  'Edible/Edible Marketing-Sales Inbox.md',
  'Project Management OS.md',
  'Areas/CS/Networking.md',
  'Areas/CS/Offline First.md',
  'Areas/CS/CS people to follow.md',
  'TODAY.md',
  'Myriad Distribution Push.md',
  'Myriad/Do The Thing — 26 Aug 2026.md',
]
export const BOTTOM_LEFT = [
  'Content Inbox.md',
  'WIP.md',
  'WIP 2.md',
  'Edible TODO.md',
  'Edible/Edible Distribution WIP.md',
]
export const DAILIES = ['Daily/29-8-2026.md', 'Daily/25-8-2026.md']
export const RIGHT = [
  'Edible WIP.md',
  'Edible/Edible Distribution Push (Aug 2026).md',
  'Edible Follow-ups.md',
]

export function rawTab(id: string, path: string): unknown {
  return { id, path, pinned: false, cursor: null, scroll: 0, history: [path], historyAt: 0 }
}

export function rawPane(
  id: string,
  list: string[],
  opts: { active?: number; groups?: { name: string; color: number; collapsed?: boolean; at: number[] }[] } = {}
): Record<string, unknown> {
  const tabs = list.map((path, i) => rawTab(`${id}t${i}`, path))
  return {
    kind: 'pane',
    id,
    tabs,
    groups: (opts.groups ?? []).map((g, gi) => ({
      id: `${id}g${gi}`,
      name: g.name,
      color: g.color,
      collapsed: g.collapsed ?? false,
      tabIds: g.at.map((i) => `${id}t${i}`),
      lastActive: 1_700_000_000_000 + gi,
    })),
    active: `${id}t${opts.active ?? 0}`,
  }
}

/** The measured tree as it is STORED: what `normalize` has to accept. */
export function chrisRaw(): Record<string, unknown> {
  return {
    version: 1,
    tree: {
      kind: 'split',
      id: 's1',
      dir: 'col',
      sizes: [18.76, 81.24],
      children: [
        rawPane('top', TOP, {
          active: 9,
          groups: [
            { name: 'CS reading', color: 6, collapsed: true, at: [5, 6, 7] },
            { name: 'Myriad', color: 3, at: [9, 10] },
          ],
        }),
        {
          kind: 'split',
          id: 's2',
          dir: 'row',
          sizes: [56.71, 43.29],
          children: [
            {
              kind: 'split',
              id: 's3',
              dir: 'col',
              sizes: [72.47, 27.53],
              children: [
                rawPane('bl', BOTTOM_LEFT, {
                  active: 4,
                  groups: [{ name: 'Edible distribution', color: 7, at: [3, 4] }],
                }),
                rawPane('daily', DAILIES),
              ],
            },
            rawPane('right', RIGHT, { active: 1 }),
          ],
        },
      ],
    },
    focus: 'bl',
    zoom: null,
  }
}

export function chris(): Layout {
  const l = normalize(chrisRaw(), ids('n'))
  if (!l) throw new Error('the measured layout must normalize')
  return l
}

/** One pane with `list` open, in order — the shape most group tests start from. */
export function strip(...list: string[]): { l: Layout; gen: () => string } {
  const gen = ids()
  let l = createLayout(gen)
  for (const p of list) l = openPath(l, p, {}, gen)
  return { l, gen }
}
