<script lang="ts">
  /**
   * *Manage tab group* (tab-groups B9, redesigned by shell-polish P1.3): the
   * name, the eight colours of the `--ed-group` band, and the verbs — new tab
   * in group, copy its links, fold, close it to the list, ungroup, delete.
   *
   * It renders through the shell's `Popover`, anchored to the chip it is
   * about. It was a centred `Dialog`: a title line, a description sentence and
   * a column of text rows in the middle of the screen, which is what Chris
   * read as "a jumble of info". The surface now says what it is by WHERE it is
   * — hierarchy from the header row, one accent (the selected swatch) and one
   * icon per verb, rather than from another paragraph.
   *
   * Every edit applies immediately — the name as it is typed, the colour on
   * click — because a group is device-local UI state and there is nothing to
   * save. The one exception is *Delete*, which is the only op that loses
   * anything and so asks first (B4).
   */
  import {
    Archive,
    ChevronsDownUp,
    ChevronsUpDown,
    Link2,
    Plus,
    Trash2,
    Ungroup,
    X,
    type LucideIcon,
  } from '@lucide/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { basename } from '@editor/index'
  import { GROUP_SLOTS } from '@editor/ui/tokens'
  import type { GroupShell } from '../group-ui.svelte.js'
  import { activeTab, findGroup, panes as panesOf, type Group, type GroupColor } from '../panes.js'
  import Field from '../ui/Field.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuSection from '../ui/MenuSection.svelte'
  import Popover from '../ui/Popover.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import GroupDot from './GroupDot.svelte'

  interface Props {
    group: Group
    panes: PaneShell
    groups: GroupShell
    /** What the popover hangs off: the group's chip, or a stand-in (P1.3). */
    anchor: HTMLElement | null
    /** True for a group `group.new` just made: open with the name selected. */
    fresh: boolean
    onDelete: () => void
    onClose: () => void
  }

  let { group, panes, groups, anchor, fresh, onDelete, onClose }: Props = $props()

  const t = $derived($LL.web.groups.manage)
  const count = $derived(group.tabIds.length)
  const slots = Array.from({ length: GROUP_SLOTS }, (_, i) => (i + 1) as GroupColor)

  /**
   * Where this group could go. A chip drag is the pointer gesture; this and
   * the `group.move-*` commands are its keyboard and menu equivalents, so no
   * way of rearranging the layout is drag-only (R8).
   */
  const home = $derived(findGroup(panes.layout, group.id)?.pane.id ?? null)
  const elsewhere = $derived(
    panesOf(panes.layout.tree)
      .filter((p) => p.id !== home)
      .map((p) => {
        const held = activeTab(p)
        return { id: p.id, index: panes.paneIndex(p.id), note: held?.path ? basename(held.path) : '' }
      })
  )

  // svelte-ignore state_referenced_locally -- the field SEEDS from the group
  // and then drives it (the live rename below); a two-way sync would fight it.
  let name = $state(group.name)

  // Live rename (the mock's `oninput`): the chip in the strip follows the
  // field, so the name you are typing is the name you can see.
  $effect(() => {
    if (name !== group.name) panes.renameGroup(group.id, name)
  })

  /** Arrows move AND select, which is what a radio group does (the APG). */
  function onSwatchKey(e: KeyboardEvent, slot: GroupColor): void {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = ((slot - 1 + delta + GROUP_SLOTS) % GROUP_SLOTS) + 1
    panes.recolorGroup(group.id, next as GroupColor)
    const el = e.currentTarget as HTMLElement
    el.parentElement?.querySelector<HTMLElement>(`[data-testid="group-colour:${next}"]`)?.focus()
  }

  function act(run: () => void): void {
    run()
    onClose()
  }
</script>

{#snippet verb(
  icon: LucideIcon,
  label: string,
  testid: string,
  run: () => void,
  opts: { hint?: string; disabled?: boolean; danger?: boolean } = {}
)}
  {@const Icon = icon}
  <button
    type="button"
    data-testid={testid}
    disabled={opts.disabled}
    onclick={run}
    class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs leading-5 disabled:opacity-50
      {opts.danger ? 'text-error hover:bg-error/10' : 'text-base-content hover:bg-base-200'}"
  >
    <Icon
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      class="mt-px shrink-0 {opts.danger ? '' : 'text-base-content/70'}"
    />
    <span class="min-w-0 flex-1">
      {label}
      {#if opts.hint}
        <span class="block text-[11px] leading-4 text-base-content/70">{opts.hint}</span>
      {/if}
    </span>
  </button>
{/snippet}

<Popover {anchor} title={t.title()} testid="group-manage" openFocus="[data-testid='group-name']" {onClose}>
  <div class="w-64 p-2">
    <!-- The header IS the title: the group's dot, its name (editable in
         place) and the way out. A heading line above it only repeated what
         the field already says. -->
    <div class="flex items-center gap-2 px-1">
      <GroupDot color={group.color} size="md" />
      <Field name="group-name" class="min-w-0 flex-1">
        <TextControl
          label={t.name()}
          hideLabel
          testid="group-name"
          bind:value={name}
          autocomplete="off"
          spellcheck="false"
          class="mt-0! border-0! bg-transparent! px-1! py-0.5! font-medium focus:ring-2 focus:ring-primary"
          onfocus={(e) => {
            if (fresh) e.currentTarget.select()
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') onClose()
          }}
        />
      </Field>
      <IconButton
        label={$LL.common.close()}
        icon={X}
        testid="group-manage-close"
        onclick={onClose}
      />
    </div>

    <div
      role="radiogroup"
      aria-label={t.colour()}
      data-testid="group-colours"
      class="mt-2 flex gap-1.5 px-1"
    >
      {#each slots as slot (slot)}
        <button
          type="button"
          role="radio"
          aria-checked={group.color === slot}
          aria-label={t.colour_n({ n: slot })}
          data-testid="group-colour:{slot}"
          tabindex={group.color === slot ? 0 : -1}
          onclick={() => panes.recolorGroup(group.id, slot)}
          onkeydown={(e) => onSwatchKey(e, slot)}
          style="background: var(--ed-group-{slot})"
          class="size-5 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-primary
            {group.color === slot ? 'border-base-content' : 'border-transparent'}"
        ></button>
      {/each}
    </div>

    <div class="mt-2 flex flex-col border-t border-base-300 pt-1.5">
      {@render verb(Plus, t.new_tab(), 'group-new-tab', () =>
        act(() => panes.newTabInGroup(group.id))
      )}
      {@render verb(
        Link2,
        t.copy_links({ count }),
        'group-copy-links',
        () => act(() => groups.copyLinks(group.id)),
        { disabled: count === 0 }
      )}
      {@render verb(
        group.collapsed ? ChevronsUpDown : ChevronsDownUp,
        group.collapsed ? t.unfold() : t.fold(),
        'group-fold',
        () => act(() => panes.toggleGroup(group.id))
      )}
      {@render verb(Archive, t.close(), 'group-close', () => act(() => panes.closeGroup(group.id)), {
        hint: t.close_hint(),
      })}
      {@render verb(Ungroup, t.ungroup(), 'group-ungroup', () =>
        act(() => panes.ungroupGroup(group.id))
      )}

      {#if elsewhere.length > 0}
        <MenuSection label={$LL.web.panes.move_to()}>
          {#each elsewhere as other (other.id)}
            <button
              type="button"
              data-testid="group-move:{other.id}"
              onclick={() => act(() => panes.moveGroupToPane(group.id, other.id))}
              class="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-xs leading-5 text-base-content hover:bg-base-200"
            >
              <span>{$LL.web.panes.label({ n: other.index })}</span>
              {#if other.note}
                <span class="min-w-0 flex-1 truncate text-right text-base-content/70">
                  {other.note}
                </span>
              {/if}
            </button>
          {/each}
        </MenuSection>
      {/if}
    </div>

    <div class="mt-1.5 border-t border-base-300 pt-1.5">
      {@render verb(Trash2, t.delete(), 'group-delete', onDelete, { danger: true })}
    </div>
  </div>
</Popover>
