<script lang="ts" module>
  /** What a send carries: the words, the references (chips), the skill (a `/` chip). */
  export interface ComposerSend {
    text: string
    refs: import('@ohhi/harness').Mention[]
    skill?: import('@ohhi/harness').SkillMeta
  }

  /** The draft per session, in `sessionStorage`: the tab's own, gone with it. */
  interface Draft {
    text: string
    chips: import('@ohhi/editor/src/composer.js').ChipRange[]
    mentions: Record<string, import('@ohhi/harness').Mention>
    skills: Record<string, import('@ohhi/harness').SkillMeta>
  }

  export const draftKey = (sessionId: string): string => `ohhi.session-draft:${sessionId}`

  function readDraft(sessionId: string): Draft | null {
    try {
      const raw = sessionStorage.getItem(draftKey(sessionId))
      return raw ? (JSON.parse(raw) as Draft) : null
    } catch {
      return null
    }
  }

  function writeDraft(sessionId: string, draft: Draft | null): void {
    try {
      if (!draft || (!draft.text && draft.chips.length === 0)) sessionStorage.removeItem(draftKey(sessionId))
      else sessionStorage.setItem(draftKey(sessionId), JSON.stringify(draft))
    } catch {
      // Storage refused (private mode, quota): the draft lives as long as the view.
    }
  }
</script>

<script lang="ts">
  /**
   * The composer: a second CM6 instance from
   * `libs/editor`'s `createComposer` — plain text, Enter sends, Shift+Enter
   * is a newline — with references as atomic chips.
   *
   * `@` opens the mention menu (`composer-mentions.ts`: the selection you came
   * from, that note's headings, notes by the quick-open ranking, folders); `/`
   * at a line start opens the skills. The menu is the `ui/Listbox` primitive,
   * driven from the composer's keys (arrows, Enter/Tab picks, Escape closes)
   * and wired to the content with `aria-controls` / `aria-activedescendant`.
   * It is deliberately NOT CodeMirror's autocomplete tooltip: that would be an
   * overlay outside `lib/ui` and `@codemirror/autocomplete` is not a
   * dependency of the shell.
   *
   * A picked reference becomes a `Mention` held here by chip id; a `lines`
   * pick captures the selection NOW (snapshot + hash). The draft (text,
   * chips, their mentions) is kept per session in `sessionStorage`.
   *
   * Its foot (QA round 1, Explorations S1 / Fork 6): the provider the NEXT
   * run goes to, as a picker — always shown, the egress promise made
   * visible; re-resolved from settings every run (Cassini's rule), this
   * only chooses which — beside the key hint. `autofocus` takes the
   * keyboard once the view exists; `begin(text)` types a start into it.
   */
  import { ChevronDown, SendHorizontal, Sparkles } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import type { ProviderView } from '@ohhi/harness'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { createComposer, type ChipRange, type ComposerHandle, type ComposerTrigger } from '@ohhi/editor/src/composer.js'
  import type { Mention, SkillMeta } from '@ohhi/harness'
  import { untrack } from 'svelte'
  import { mentionOptions, skillOptions, type MentionOption, type MentionSources } from '../composer-mentions.js'
  import { segments } from '../highlight.js'
  import { mentionOf } from '../references.js'
  import IconButton from '../ui/IconButton.svelte'
  import Listbox, { optionId } from '../ui/Listbox.svelte'
  import { renderMentionChip } from './MentionChip.js'

  interface Props {
    sessionId: string
    /** A turn is in flight: Enter does not send. */
    busy?: boolean
    sources: MentionSources
    /** Capture the live selection as a `lines` mention (the `@` menu's first row). */
    captureLines(): Promise<Mention | null>
    /** Mentions handed over from outside (`ai.add-selection`); taken as chips. */
    incoming?: Mention[]
    onTaken?(): void
    /** Which chips' references moved since capture. */
    checkChanged?(refs: Mention[]): Promise<Set<string>>
    /** Send; resolve false to keep the draft (nothing was started). */
    onSend(send: ComposerSend): Promise<boolean> | boolean
    /** The providers, and the one the next run goes to: the picker at the foot. */
    providers?: ProviderView[]
    providerId?: string
    onProvider?(id: string): void
    /** *Manage providers…*: Settings › AI. */
    onManageProviders?(): void
    /** Take the keyboard once the composer exists (a new session's first screen). */
    autofocus?: boolean
  }

  let {
    sessionId,
    busy = false,
    sources,
    captureLines,
    incoming = [],
    onTaken,
    checkChanged,
    onSend,
    providers = [],
    providerId = '',
    onProvider,
    onManageProviders,
    autofocus = false,
  }: Props = $props()

  const provider = $derived(providers.find((p) => p.id === providerId) ?? providers[0] ?? null)

  /** Type `text` at the caret and take the keyboard: a start (`/` opens the skills). */
  export function begin(text: string): void {
    if (!composer) return
    composer.focus()
    if (text) composer.insertText(text)
  }

  const t = $derived($LL.web.ai.composer)
  const uid = $props.id()
  const listId = `${uid}-mentions`

  let host = $state<HTMLDivElement>()
  let composer = $state.raw<ComposerHandle | null>(null)
  let text = $state('')
  let chips = $state.raw<ChipRange[]>([])
  let trigger = $state.raw<ComposerTrigger | null>(null)
  /** A trigger the person closed with Escape stays closed until it moves. */
  let dismissed = $state<number | null>(null)
  let options = $state.raw<MentionOption[]>([])
  let activeIndex = $state(0)
  let changed = $state.raw<Set<string>>(new Set())

  /** Chip id → what it means. */
  const mentions = new Map<string, Mention>()
  const skills = new Map<string, SkillMeta>()

  const menuOpen = $derived(trigger !== null && dismissed !== trigger.from)

  function persist(): void {
    if (!composer) return
    writeDraft(sessionId, {
      text,
      chips,
      mentions: Object.fromEntries(chips.flatMap((c) => (mentions.has(c.id) ? [[c.id, mentions.get(c.id)!]] : []))),
      skills: Object.fromEntries(chips.flatMap((c) => (skills.has(c.id) ? [[c.id, skills.get(c.id)!]] : []))),
    })
  }

  // The view: created once per session id, destroyed with the component.
  // Only `host` and `sessionId` are tracked; the rest runs under `untrack`.
  // Restoring a draft's chips dispatches synchronously inside
  // `createComposer`, so `onChange` — and `persist`, which reads `text`,
  // `chips` and `composer` — runs INSIDE this effect. Tracked, those reads
  // would make the effect depend on the very state it writes below, and
  // Svelte stops it (`effect_update_depth_exceeded`) the moment a session is
  // reopened with a chip in its draft, taking the shell's effects with it.
  $effect(() => {
    const parent = host
    const id = sessionId
    if (!parent) return
    return untrack(() => {
      const draft = readDraft(id)
      mentions.clear()
      skills.clear()
      for (const [k, v] of Object.entries(draft?.mentions ?? {})) mentions.set(k, v)
      for (const [k, v] of Object.entries(draft?.skills ?? {})) skills.set(k, v)
      const handle = createComposer({
        parent,
        doc: draft?.text ?? '',
        chips: (draft?.chips ?? []).filter((c) => mentions.has(c.id) || skills.has(c.id)),
        ariaLabel: $LL.web.ai.composer.label(),
        placeholder: $LL.web.ai.composer.placeholder(),
        contentAttributes: { 'data-testid': 'session-composer-input' },
        // Drawn by CodeMirror during any dispatch, other effects' included: `changed` stays untracked there.
        renderChip: (chip) => renderMentionChip(chip, { changed: untrack(() => changed.has(chip.id)) }),
        onSubmit: () => void send(),
        onChange: (s) => {
          text = s.text
          chips = s.chips
          trigger = s.trigger
          if (dismissed !== null && dismissed !== s.trigger?.from) dismissed = null
          persist()
        },
        onMenuKey: (key) => menuKey(key),
      })
      composer = handle
      text = handle.text()
      chips = handle.chips()
      if (autofocus) handle.focus()
      return () => {
        handle.destroy()
        composer = null
      }
    })
  })

  // Mentions handed over by a command become chips at the caret.
  $effect(() => {
    if (!composer || incoming.length === 0) return
    const waiting = incoming
    untrack(() => {
      for (const m of waiting) insertMention(m)
      onTaken?.()
      composer?.focus()
    })
  })

  // The menu's rows, for the trigger as it stands.
  $effect(() => {
    const tr = trigger
    if (!tr || dismissed === tr.from) {
      options = []
      return
    }
    let stale = false
    const load = tr.kind === '/' ? skillOptions(tr.query, sources) : mentionOptions(tr.query, sources)
    void load.then((rows) => {
      if (stale) return
      options = rows
      activeIndex = 0
    })
    return () => {
      stale = true
    }
  })

  // The *changed* badges: re-checked whenever the set of chips changes.
  $effect(() => {
    const refs = chips.flatMap((c) => (mentions.has(c.id) ? [mentions.get(c.id)!] : []))
    if (!checkChanged || refs.length === 0) return
    let stale = false
    void checkChanged(refs).then((next) => {
      if (!stale && [...next].join() !== [...changed].join()) changed = next
    })
    return () => {
      stale = true
    }
  })

  // The content points at the menu (and its active option) only while it is
  // open — never a dangling IDREF.
  $effect(() => {
    const attrs: Record<string, string> = menuOpen
      ? { 'aria-controls': listId, ...(options.length ? { 'aria-activedescendant': optionId(listId, activeIndex) } : {}) }
      : {}
    composer?.setContentAttributes(attrs)
  })

  function insertMention(m: Mention, at?: { from: number; to: number }): void {
    if (!composer) return
    mentions.set(m.id, m)
    composer.insertChip({ id: m.id, label: m.label }, at)
  }

  async function pick(option: MentionOption): Promise<void> {
    const tr = trigger
    if (!composer || !tr) return
    const at = { from: tr.from, to: tr.to }
    if (option.kind === 'skill') {
      const id = `skill-${option.skill.name}`
      skills.set(id, option.skill)
      composer.insertChip({ id, label: option.skill.name, sigil: '/' }, at)
    } else if (option.kind === 'lines') {
      const m = await captureLines()
      if (m) insertMention(m, at)
    } else {
      insertMention(mentionOf(option.ref), at)
    }
    composer.focus()
  }

  function menuKey(key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Tab' | 'Escape'): boolean {
    if (!menuOpen) return false
    if (key === 'Escape') {
      dismissed = trigger?.from ?? null
      return true
    }
    if (options.length === 0) return false
    if (key === 'ArrowDown') activeIndex = (activeIndex + 1) % options.length
    else if (key === 'ArrowUp') activeIndex = (activeIndex - 1 + options.length) % options.length
    else void pick(options[activeIndex])
    return true
  }

  async function send(): Promise<void> {
    if (!composer || busy) return
    const current = composer.chips()
    const skillChip = current.find((c) => skills.has(c.id))
    const skill = skillChip ? skills.get(skillChip.id) : undefined
    // The skill chip names the skill; it is not part of what was asked.
    let words = composer.text()
    for (const c of [...current].filter((c) => skills.has(c.id)).sort((a, b) => b.from - a.from)) {
      words = words.slice(0, c.from) + words.slice(c.to)
    }
    words = words.trim()
    if (!words && !skill) return
    const refs = current.flatMap((c) => (mentions.has(c.id) ? [mentions.get(c.id)!] : []))
    const started = await onSend({ text: words || `/${skill!.name}`, refs, ...(skill ? { skill } : {}) })
    if (started === false) return
    composer.clear()
    mentions.clear()
    skills.clear()
    writeDraft(sessionId, null)
  }

  const canSend = $derived(!busy && text.trim().length > 0)
</script>

<div data-testid="session-composer" class="flex flex-col gap-1 border-t border-base-200 px-3 pt-2 pb-2">
  {#if menuOpen}
    <Listbox
      id={listId}
      {options}
      active={activeIndex}
      label={t.menu()}
      testid="mention-menu"
      key={(o) => o.id}
      empty={t.no_matches()}
      optionAttrs={(o) => ({ 'data-testid': 'mention-option', 'data-kind': o.kind })}
      onPick={(o) => void pick(o)}
    >
      {#snippet option(o)}
        <span class="shrink-0 text-[10px] tracking-wide text-base-content/70 uppercase">{t.kind[o.kind]()}</span>
        <span class="min-w-0 truncate">
          {#each segments(o.title, o.spans) as seg, k (k)}
            {#if seg.hit}<mark class="bg-transparent font-semibold text-base-content">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
        {#if o.subtitle}
          <span class="ml-auto min-w-0 shrink truncate text-[11px] text-base-content/70">{o.subtitle}</span>
        {/if}
      {/snippet}
    </Listbox>
  {/if}
  <div class="flex items-end gap-1 rounded-lg border border-base-300 bg-base-100 focus-within:border-primary">
    <div bind:this={host} class="min-w-0 flex-1"></div>
    <IconButton
      icon={SendHorizontal}
      label={t.send()}
      testid="session-send"
      disabled={!canSend}
      onclick={() => void send()}
      class="m-1"
    />
  </div>
  <div class="flex min-w-0 items-center gap-2 text-[11px] text-base-content/70" data-testid="session-composer-foot">
    {#if provider}
      <DropdownMenu testid="session-provider-menu" placement="top-start">
        {#snippet trigger(attrs)}
          <button
            use:melt={attrs}
            type="button"
            data-testid="session-provider"
            aria-label={t.provider_label({ name: provider.name, model: provider.model })}
            class="inline-flex min-w-0 items-center gap-1 rounded border border-base-300 px-1.5 py-0.5 text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Sparkles size={12} aria-hidden="true" />
            <span class="truncate">{provider.name}</span>
            <span class="truncate font-ed-mono text-[10.5px] text-base-content/70">{provider.model}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        {/snippet}
        {#snippet children({ item, separator })}
          {#each providers as p (p.id)}
            <MenuItem {item} testid="session-provider:{p.id}" checked={p.id === provider.id} onSelect={() => onProvider?.(p.id)}>
              {$LL.web.ai.session.provider_option({ name: p.name, model: p.model })}
            </MenuItem>
          {/each}
          {#if onManageProviders}
            <MenuSeparator {separator} />
            <MenuItem {item} testid="session-provider-manage" onSelect={onManageProviders}>{t.manage_providers()}</MenuItem>
          {/if}
        {/snippet}
      </DropdownMenu>
    {/if}
    <p class="m-0 ml-auto min-w-0 truncate">{t.hint()}</p>
  </div>
</div>
