<script lang="ts">
  /**
   * *Manage tab group* (tab-groups B9, the fourth screenshot): the name, the
   * eight colours of the `--ed-group` band, and the verbs — new tab in group,
   * copy its links, fold, close it to the list, ungroup, delete.
   *
   * It renders as the shell's `Dialog`, not as a `DropdownMenu` anchored to
   * the chip. A menu may own nothing but menu items (ARIA, and axe enforces
   * it), and this one has a text field and a radiogroup in it; hand-rolling a
   * popover to get around that would owe the focus trap, Escape, click-outside
   * and focus-return that `Dialog` already answers for (chrome U1).
   *
   * Every edit applies immediately — the name as it is typed, the colour on
   * click — because a group is device-local UI state and there is nothing to
   * save. The one exception is *Delete*, which is the only op that loses
   * anything and so asks first (B4).
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import { GROUP_SLOTS } from '@editor/ui/tokens'
  import type { GroupShell } from '../group-ui.svelte.js'
  import type { Group, GroupColor } from '../panes.js'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'

  interface Props {
    group: Group
    panes: PaneShell
    groups: GroupShell
    /** True for a group `group.new` just made: open with the name selected. */
    fresh: boolean
    onDelete: () => void
    onClose: () => void
  }

  let { group, panes, groups, fresh, onDelete, onClose }: Props = $props()

  const t = $derived($LL.web.groups.manage)
  const count = $derived(group.tabIds.length)
  const slots = Array.from({ length: GROUP_SLOTS }, (_, i) => (i + 1) as GroupColor)

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

<Dialog
  title={t.title()}
  description={t.description()}
  width="sm"
  showClose
  closeTestid="group-manage-close"
  testid="group-manage"
  openFocus="[data-testid='group-name']"
  {onClose}
>
  <Field name="group-name">
    <TextControl
      label={t.name()}
      testid="group-name"
      bind:value={name}
      autocomplete="off"
      spellcheck="false"
      onfocus={(e) => {
        if (fresh) e.currentTarget.select()
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter') onClose()
      }}
    />
  </Field>

  <div
    role="radiogroup"
    aria-label={t.colour()}
    data-testid="group-colours"
    class="mt-3 flex flex-wrap gap-2"
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
        class="size-6 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-primary
          {group.color === slot ? 'border-base-content' : 'border-transparent'}"
      ></button>
    {/each}
  </div>

  <div class="mt-4 flex flex-col border-t border-base-300 pt-2 text-sm">
    <button
      type="button"
      data-testid="group-new-tab"
      onclick={() => act(() => panes.newTabInGroup(group.id))}
      class="rounded px-2 py-1.5 text-left text-base-content/85 hover:bg-base-200"
    >
      {t.new_tab()}
    </button>
    <button
      type="button"
      data-testid="group-copy-links"
      disabled={count === 0}
      onclick={() => act(() => groups.copyLinks(group.id))}
      class="rounded px-2 py-1.5 text-left text-base-content/85 hover:bg-base-200 disabled:opacity-50"
    >
      {t.copy_links({ count })}
    </button>
    <button
      type="button"
      data-testid="group-fold"
      onclick={() => act(() => panes.toggleGroup(group.id))}
      class="rounded px-2 py-1.5 text-left text-base-content/85 hover:bg-base-200"
    >
      {group.collapsed ? t.unfold() : t.fold()}
    </button>
    <button
      type="button"
      data-testid="group-close"
      onclick={() => act(() => panes.closeGroup(group.id))}
      class="flex items-baseline gap-2 rounded px-2 py-1.5 text-left text-base-content/85 hover:bg-base-200"
    >
      {t.close()}
      <span class="text-[10px] text-base-content/70">{t.close_hint()}</span>
    </button>
    <button
      type="button"
      data-testid="group-ungroup"
      onclick={() => act(() => panes.ungroupGroup(group.id))}
      class="rounded px-2 py-1.5 text-left text-base-content/85 hover:bg-base-200"
    >
      {t.ungroup()}
    </button>
    <button
      type="button"
      data-testid="group-delete"
      onclick={onDelete}
      class="rounded px-2 py-1.5 text-left text-error hover:bg-error/10"
    >
      {t.delete()}
    </button>
  </div>
</Dialog>
