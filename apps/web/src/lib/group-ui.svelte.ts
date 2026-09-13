/**
 * The shell's half of tab groups (tab-groups W2, B8/B9, Forks 2-A and 3-A).
 *
 * `groups.ts` is pure and knows nothing about the clipboard, the index or an
 * open dialog; `workspace-panes.svelte.ts` owns the tree and the saved list.
 * This is the thin layer between them: which overlay is open, and the two
 * actions that need something outside the tree — the clipboard (*Copy N
 * links*) and the index (*Open links of this note as a group*). Both report
 * through `notify`, so the notice lands in Activity as well as in a toast
 * (chrome U5), and neither reaches for `toast()` itself.
 *
 * The components under `components/` render this and nothing else, so there
 * is exactly one place where a group decision is made.
 */
import { basename } from '@ohhi/index'
import { getLL } from '@ohhi/i18n'
import type { Command } from './commands.js'
import { groupRows, linksOf, type GroupRow } from './groups.js'
import { groupCommands, type GroupActions } from './pane-commands.js'
import { activeTab, findPane } from './panes.js'
import type { PaneShell } from './workspace-panes.svelte.js'

/**
 * A group's name as anything on screen prints it — a group with no name yet is
 * the normal case for a keyboard create, and an empty chip says nothing. Read
 * through `getLL()` rather than `$LL` because the callers are a mix of
 * components and modules (the `tree-model.ts` / `pill-status.ts` pattern).
 */
export function groupLabel(name: string): string {
  return name || getLL().web.groups.untitled()
}

/** What the group UI needs from the rest of the shell. */
export interface GroupHost {
  /** True when more than one note in the vault carries this basename (B8). */
  ambiguousName(name: string): boolean
  /** The notes this note links out to, resolved to paths (R6's other way). */
  outgoingPaths(path: string): Promise<string[]>
  /** The session notice log — a toast now, a line in Activity after (U5). */
  notify(input: { level: 'info' | 'warn' | 'error'; text: string; path?: string }): void
  /** Clipboard writer; injected so the copy path can be driven in a test. */
  write(text: string): Promise<void>
}

export interface GroupShell {
  /**
   * The chip's manage popover: the group it is on, and whether the group is
   * fresh — one just made by `group.new`, whose name field opens selected.
   */
  readonly manage: { groupId: string; fresh: boolean } | null
  readonly showAll: boolean
  /** The delete confirm — the one destructive op in the feature (B4). */
  readonly confirming: string | null
  openManage(groupId: string, fresh?: boolean): void
  closeManage(): void
  openShowAll(): void
  closeShowAll(): void
  askDelete(groupId: string): void
  cancelDelete(): void
  confirmDelete(): void
  /** The `▾` menu's and the dialog's rows: open groups first, then the list. */
  rows(paneId: string): GroupRow[]
  /** Go to a row's group — unfolding an open one, reopening a saved one. */
  openRow(row: GroupRow, paneId: string): void
  copyLinks(groupId: string): void
  openLinksAsGroup(paneId: string): void
  /** Group a pane's active tab and open the popover on it, name selected. */
  newFromActive(paneId?: string): void
  /** The `group.*` command rows (the table) … */
  commands(): Command[]
  /** … and the one-per-saved-group palette rows, which cannot be registered
   *  because the ids come and go with the list (Fork 2-A). */
  savedCommands(): Command[]
}

export function createGroupUi(panes: PaneShell, host: GroupHost): GroupShell {
  let manage = $state.raw<{ groupId: string; fresh: boolean } | null>(null)
  let showAll = $state(false)
  let confirming = $state.raw<string | null>(null)

  const paneOr = (paneId?: string): string => paneId ?? panes.layout.focus
  const activeIn = (paneId: string): { id: string; path: string | null } | null => {
    const p = findPane(panes.layout, paneId)
    return p ? activeTab(p) : null
  }

  function newFromActive(paneId?: string): void {
    const id = paneOr(paneId)
    const tab = activeIn(id)
    if (!tab) return
    const groupId = panes.newGroup(tab.id, id)
    // A group with no name yet is the normal case for a keyboard create, so
    // the popover opens on it with the field selected rather than leaving an
    // untitled chip on the strip.
    if (groupId) manage = { groupId, fresh: true }
  }

  function copyLinks(groupId: string): void {
    const group = panes.findGroup(groupId)
    const paths = panes.groupPaths(groupId)
    if (!group || !paths.length) return
    const t = getLL().web.groups
    const name = groupLabel(group.name)
    void host
      .write(linksOf(paths, host.ambiguousName))
      .then(() => host.notify({ level: 'info', text: t.copied({ count: paths.length, name }) }))
      .catch(() => host.notify({ level: 'warn', text: t.copy_failed() }))
  }

  function openLinksAsGroup(paneId: string): void {
    const path = activeIn(paneId)?.path
    if (!path) return
    const t = getLL().web.groups
    void host.outgoingPaths(path).then((paths) => {
      if (!paths.length) {
        host.notify({ level: 'info', text: t.menu.no_links(), path })
        return
      }
      // Named after the note, so the group and the note it came from carry the
      // same label — the handoff R6 is about.
      panes.groupFromLinks(basename(path), paths, paneId)
    })
  }

  /** The four verbs act on the group holding the focused pane's active tab. */
  const actions: GroupActions = {
    newFromActive: () => newFromActive(),
    toggle: () => {
      const g = panes.activeGroup()
      if (g) panes.toggleGroup(g.id)
    },
    close: () => {
      const g = panes.activeGroup()
      if (g) panes.closeGroup(g.id)
    },
    copyLinks: () => {
      const g = panes.activeGroup()
      if (g) copyLinks(g.id)
    },
    ungroup: () => {
      const g = panes.activeGroup()
      if (g) panes.ungroupGroup(g.id)
    },
    move: (side) => {
      const g = panes.activeGroup()
      const other = panes.neighbourPane(side)
      if (g && other) panes.moveGroupToPane(g.id, other)
    },
    hasGroup: () => panes.activeGroup() !== null,
  }

  return {
    get manage() {
      return manage
    },
    get showAll() {
      return showAll
    },
    get confirming() {
      return confirming
    },
    openManage(groupId, fresh = false) {
      manage = { groupId, fresh }
    },
    closeManage() {
      manage = null
    },
    openShowAll() {
      showAll = true
    },
    closeShowAll() {
      showAll = false
    },
    askDelete(groupId) {
      // The popover steps aside: two open dialogs would be two focus traps,
      // and the confirm is the one that needs the answer.
      manage = null
      confirming = groupId
    },
    cancelDelete() {
      confirming = null
    },
    confirmDelete() {
      const id = confirming
      confirming = null
      manage = null
      if (id) panes.deleteGroup(id)
    },

    rows: (paneId) => groupRows(panes.layout, paneId, panes.savedGroups),

    openRow(row, paneId) {
      if (row.savedId) {
        panes.openSavedGroup(row.savedId, paneId)
        return
      }
      // Activating a tab already unfolds its group and focuses its pane
      // (`activateIn`), so going to an open group is one call.
      const first = row.groupId ? panes.findGroup(row.groupId)?.tabIds[0] : undefined
      if (first && row.paneId) panes.activate(row.paneId, first)
    },

    copyLinks,
    openLinksAsGroup,
    newFromActive,
    commands: () => groupCommands(actions),
    savedCommands() {
      const t = getLL().web.groups
      const group = getLL().web.commands.groups.group()
      return panes.savedGroups.map((saved) => ({
        id: `group.open:${saved.id}`,
        title: t.commands.open({ name: groupLabel(saved.name) }),
        group,
        run: () => panes.openSavedGroup(saved.id),
      }))
    },
  }
}
