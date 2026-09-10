/**
 * The pane and tab half of the command table (tab-groups B7, §Command table).
 *
 * One table, three consumers: the flat bindings the registry resolves, the
 * letters `mode.ts` maps onto command ids, and the palette/Settings rows. The
 * ids here are the ids `MODES` names — a typo shows up as a mode key that does
 * nothing, which is why `pane-commands.test.ts` asserts the two agree.
 *
 * Flat keys are Chris's own Obsidian rebinds (`Alt+-`, `Alt+=`,
 * `Ctrl+Mod+Arrows`, `Ctrl+Mod+Backspace`, `Ctrl+Mod+-`) plus Obsidian's
 * unrebound tab defaults (`Mod+T`, `Mod+W`, `Ctrl+Tab`, `Ctrl+Shift+Tab`,
 * `Mod+Shift+T`) — the ones already in his hands. Everything else ships with a
 * mode letter and a palette entry only, and R1.3's override map is how it gets
 * a key if one is ever missed.
 */
import { getLL } from '@editor/i18n'
import type { Command } from './commands.js'
import type { Dir, Side } from './panes.js'

/** The four directions in Vim's `h j k l` order — the order the bar prints. */
export const SIDES: readonly Side[] = ['left', 'down', 'up', 'right']

const ARROW: Record<Side, string> = {
  left: 'ArrowLeft',
  down: 'ArrowDown',
  up: 'ArrowUp',
  right: 'ArrowRight',
}

/** Everything the shell must be able to do for a pane/tab command to exist. */
export interface PaneActions {
  splitAuto(): void
  split(dir: Dir): void
  closePane(): void
  focus(side: Side): void
  focusNext(): void
  zoom(): void
  rotate(): void
  movePane(side: Side): void
  resizePane(side: Side): void
  equalize(): void
  closeOthers(): void
  /** The `Mod+P` leader — a command like any other, so it is rebindable. */
  enterMode(): void
  newTab(): void
  closeTab(): void
  stepTab(delta: number): void
  gotoTab(n: number): void
  moveTabTo(side: Side): void
  pinTab(): void
  reopenTab(): void
}

export function paneCommands(a: PaneActions): Command[] {
  const t = getLL().web
  const pane = t.panes.commands
  const tab = t.tabs.commands
  const gPane = t.commands.groups.pane()
  const gTab = t.commands.groups.tab()
  return [
    { id: 'workspace.split-auto', title: pane.split_auto(), group: gPane, run: a.splitAuto },
    { id: 'workspace.split-down', title: pane.split_down(), group: gPane, keys: 'Alt+-', run: () => a.split('col') },
    { id: 'workspace.split-right', title: pane.split_right(), group: gPane, keys: 'Alt+=', run: () => a.split('row') },
    { id: 'workspace.close-pane', title: pane.close_pane(), group: gPane, keys: 'Ctrl+Mod+Backspace', run: a.closePane },
    ...SIDES.map((side) => ({
      id: `workspace.focus-${side}`,
      title: pane[`focus_${side}`](),
      group: gPane,
      keys: `Ctrl+Mod+${ARROW[side]}`,
      run: () => a.focus(side),
    })),
    { id: 'workspace.focus-next', title: pane.focus_next(), group: gPane, run: a.focusNext },
    { id: 'workspace.zoom', title: pane.zoom(), group: gPane, run: a.zoom },
    { id: 'workspace.rotate', title: pane.rotate(), group: gPane, run: a.rotate },
    ...SIDES.map((side) => ({
      id: `workspace.move-${side}`,
      title: pane[`move_${side}`](),
      group: gPane,
      run: () => a.movePane(side),
    })),
    ...SIDES.map((side) => ({
      id: `workspace.resize-${side}`,
      title: pane[`resize_${side}`](),
      group: gPane,
      run: () => a.resizePane(side),
    })),
    { id: 'workspace.equalize', title: pane.equalize(), group: gPane, run: a.equalize },
    { id: 'workspace.mode', title: pane.mode(), group: gPane, keys: 'Mod+p', run: a.enterMode },
    // Close-others acts on the pane's TABS, so it reads under Tab in the
    // palette even though its verb and its key belong to the pane family.
    { id: 'workspace.close-others', title: pane.close_others(), group: gTab, keys: 'Ctrl+Mod+-', run: a.closeOthers },
    { id: 'tab.new', title: tab.new(), group: gTab, keys: 'Mod+t', run: a.newTab },
    { id: 'tab.close', title: tab.close(), group: gTab, keys: 'Mod+w', run: a.closeTab },
    { id: 'tab.prev', title: tab.prev(), group: gTab, keys: 'Ctrl+Shift+Tab', run: () => a.stepTab(-1) },
    { id: 'tab.next', title: tab.next(), group: gTab, keys: 'Ctrl+Tab', run: () => a.stepTab(1) },
    // No flat key by decision 6: the browser owns Mod+1..9 and the mode path
    // (`Mod+P t 3`) is enough.
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
      id: `tab.goto-${n}`,
      title: tab.goto_n({ n }),
      group: gTab,
      run: () => a.gotoTab(n),
    })),
    ...SIDES.map((side) => ({
      id: `tab.move-${side}`,
      title: tab[`move_${side}`](),
      group: gTab,
      run: () => a.moveTabTo(side),
    })),
    { id: 'tab.pin', title: tab.pin(), group: gTab, run: a.pinTab },
    { id: 'tab.reopen', title: tab.reopen(), group: gTab, keys: 'Mod+Shift+t', run: a.reopenTab },
  ]
}

/**
 * Everything the shell must be able to do for a `group.*` command to exist
 * (tab-groups W2). Kept apart from `PaneActions` because these are the shell's
 * group half — the popover, the clipboard and the saved list — and the pane
 * controller owns none of them on its own.
 */
export interface GroupActions {
  /** Group the active tab and open the manage popover with the name selected. */
  newFromActive(): void
  toggle(): void
  close(): void
  copyLinks(): void
  ungroup(): void
  /** False when the focused pane's active tab is in no group: the four verbs
   *  below have nothing to act on, so they are hidden and their key falls
   *  through to the editor. */
  hasGroup(): boolean
}

/**
 * The group half of the command table (§Command table, `group.*`). Registered
 * separately from `paneCommands` because it is W2's, and because the palette
 * ALSO takes one row per saved group from a provider rather than from here —
 * those ids come and go with the list (Fork 2-A).
 */
export function groupCommands(a: GroupActions): Command[] {
  const t = getLL().web.groups.commands
  const group = getLL().web.commands.groups.group()
  const needsGroup = (): boolean => a.hasGroup()
  return [
    { id: 'group.new', title: t.new(), group, keys: 'Mod+Shift+g', run: a.newFromActive },
    { id: 'group.toggle', title: t.toggle(), group, keys: 'Mod+Shift+e', when: needsGroup, run: a.toggle },
    { id: 'group.close', title: t.close(), group, when: needsGroup, run: a.close },
    { id: 'group.copy-links', title: t.copy_links(), group, when: needsGroup, run: a.copyLinks },
    { id: 'group.ungroup', title: t.ungroup(), group, when: needsGroup, run: a.ungroup },
  ]
}

/**
 * The label for an id the hint bar asks about that is NOT a command: the
 * families `h j k l` and `1–9` collapse onto, and the sub-mode rows
 * (`mode.ts` documents the five + four ids). Anything else answers '', and
 * the bar drops the row — which is how the group sub-mode stays honest until
 * W2 registers `group.*`.
 */
export function familyTitle(id: string): string {
  const t = getLL().web
  switch (id) {
    case 'workspace.focus':
      return t.panes.commands.focus()
    case 'workspace.move':
      return t.panes.commands.move()
    case 'workspace.resize':
      return t.panes.commands.resize()
    case 'tab.move':
      return t.tabs.commands.move()
    case 'tab.goto':
      return t.tabs.commands.goto()
    case 'mode.move':
      return t.mode.enter.move()
    case 'mode.resize':
      return t.mode.enter.resize()
    case 'mode.tab':
      return t.mode.enter.tab()
    case 'mode.group':
      return t.mode.enter.group()
    default:
      return ''
  }
}
