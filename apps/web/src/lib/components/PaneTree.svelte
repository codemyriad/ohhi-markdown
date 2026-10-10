<script lang="ts">
  /**
   * The split tree (tab-groups B1, B11): `Split` renders as a flex row or
   * column whose children carry their percent share as `flex-grow`, with a
   * `ResizeHandle` — the shell's keyboard-drivable separator — on every
   * border. `Pane` renders the leaf.
   *
   * Recursive by self-import, keyed on **ids**: every mutation in `panes.ts`
   * returns a fresh, deep-cloned `Layout`, so object identity means nothing
   * and only ids survive an edit.
   *
   * Zoom (B12) never restructures the tree — the shell hands this the zoomed
   * pane instead of the root, so it is the only one mounted. That is what
   * makes the live-editor count drop to one while every other tab stays put.
   */
  import type { Snippet } from 'svelte'
  import type { LinkHeading, LinkMount } from '@ohhi/editor-lang'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import {
    MIN_SIZE,
    panes as panesOf,
    type Group,
    type Node,
    type Pane as PaneNode,
    type Tab,
  } from '../panes.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import ResizeHandle from '../ui/ResizeHandle.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import type { PaneChrome } from '../pane-chrome.js'
  import type { PickerRow } from './EmptyTab.svelte'
  import Pane from './Pane.svelte'
  import Self from './PaneTree.svelte'

  /** Everything a pane needs that is the same for every pane in the tree. */
  export interface PaneRender {
    /** Which chrome the layout spec gives a pane (absent → `DENSE_CHROME`). */
    chrome?: PaneChrome
    panes: PaneShell
    workspace: Workspace
    dark: boolean
    /** Typewriter scrolling — the layout's `editor.typewriter` (quiet-shell Decision 5). */
    typewriter?: boolean
    /** The note's title as an editable heading above its text — the layout's `editor.inlineTitle` (P3). */
    inlineTitle?: boolean
    search: (query: string) => Promise<PickerRow[]>
    /** The empty tab's *Recent* list: paths this vault opened lately, newest first. */
    recent: () => string[]
    /** The empty tab's *New note*: the host creates the file and fills THAT tab with it. */
    newNote: (tabId: string) => void
    /** The empty tab's *Open note…*: hand over to the quick-open palette. */
    openQuick: () => void
    /** Bindings for those two verbs, shown on the launcher when the host knows them. */
    bindings?: { newNote: string; openQuick: string }
    resolveLink: (target: string, from: string | undefined) => string | null
    createFromLink: (target: string) => void
    linkCandidates: () => string[]
    /** The link popover's scope (E1, fork A2): the vault's shares and the recent notes. */
    linkContext?: () => { mounts: LinkMount[]; recents: string[] }
    /** `[[Note#` headings, from the index. */
    linkHeadings?: (path: string) => Promise<LinkHeading[]>
    /** Read X4: a tag chip's click, and the `#` completion source. */
    searchTag: (tag: string) => void
    tags: () => string[]
    reveal: { offset: number } | null
    groupChip?: Snippet<[Group, PaneNode]>
    tabMenuGroupItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Tab]>
    moreMenuItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, PaneNode]>
  }

  interface Props {
    node: Node
    ctx: PaneRender
  }

  let { node, ctx }: Props = $props()

  /** Measured, so a pointer drag can be turned into a percentage share. */
  let width = $state(0)
  let height = $state(0)

  /**
   * Every border needs its own name: a tree of separators all called "Resize
   * panes" is a list of identical controls, and the one thing a keyboard user
   * needs to know is WHICH border they are on. So each is named by the two
   * panes it divides — the last pane on its leading side and the first on its
   * trailing side, which is what the border actually moves.
   */
  const nameOf = (child: Node): string =>
    $LL.web.panes.label({ n: ctx.panes.paneIndex(child.id) })
  const lastPaneOf = (n: Node): PaneNode => panesOf(n)[panesOf(n).length - 1]
  const firstPaneOf = (n: Node): PaneNode => panesOf(n)[0]
</script>

{#if node.kind === 'pane'}
  <Pane pane={node} focused={ctx.panes.layout.focus === node.id} {...ctx} />
{:else}
  {@const along = node.dir === 'row' ? width : height}
  <div
    bind:clientWidth={width}
    bind:clientHeight={height}
    data-testid="split:{node.id}"
    class="flex min-h-0 min-w-0 flex-1 {node.dir === 'row' ? 'flex-row' : 'flex-col'}"
  >
    {#each node.children as child, i (child.id)}
      {#if i > 0}
        {@const value = node.sizes[i - 1]}
        <ResizeHandle
          inline
          hidden={ctx.chrome?.borders === 'none'}
          orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
          {value}
          min={MIN_SIZE}
          max={value + node.sizes[i] - MIN_SIZE}
          step={2}
          perPixel={along > 0 ? 100 / along : 0}
          label={$LL.web.panes.resize_between({
            a: nameOf(lastPaneOf(node.children[i - 1])),
            b: nameOf(firstPaneOf(child)),
          })}
          valueText={$LL.web.panes.resize_value({ pct: Math.round(value) })}
          testid="pane-resize:{node.id}:{i - 1}"
          onChange={(next) => ctx.panes.resizeSplit(node.id, i - 1, next - value)}
          onCommit={() => ctx.panes.persistNow()}
        />
      {/if}
      <div class="flex min-h-0 min-w-0" style="flex: {node.sizes[i]} 1 0px">
        <Self node={child} {ctx} />
      </div>
    {/each}
  </div>
{/if}
