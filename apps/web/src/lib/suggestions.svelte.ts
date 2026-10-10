/**
 * The agent's suggestions in the shell (writing-harness B7, Fork 4-B): the
 * `@ohhi/editor` suggestions extension on every open editor, fed with its
 * note's records from the workspace facade (`MountSession` holds them), and
 * the five commands that act on them — `ai.accept-suggestion` /
 * `ai.reject-suggestion` (the one under the caret), `ai.accept-all` /
 * `ai.reject-all` (the note) and `ai.undo-agent` (the agent's last run).
 *
 * Which editor a command means: the one that last had the focus (a palette
 * row takes the focus to run, so "currently focused" would be nobody). The
 * extension reports focus and teardown through its host, so there is no
 * second registry of views to keep in step with the pane tree.
 *
 * `Mod-Enter` / `Mod-Backspace` are the editor's own keymap (they fall
 * through when the caret is in no suggestion); the commands are the same
 * acts from the palette, listed only while a provider exists (R1).
 */
import {
  suggestionAt,
  suggestions,
  suggestionsCompartment,
  suggestionsIn,
  type EditorSuggestion,
  type MarkdownEditorHandle,
  type SuggestionsHost,
} from '@ohhi/editor'
import type { SuggestionRecord as HarnessRecord } from '@ohhi/harness'
import { getLL } from '@ohhi/i18n'
import type { AppEvent, SuggestionRecord } from '@ohhi/workspace'
import type { Command } from './commands.js'
import { aiEnabled } from './config.js'
import type { FlashInput } from './notices.js'
import type { Workspace } from './workspace.svelte.js'

type EditorView = MarkdownEditorHandle['view']
/** A CM6 extension (`@codemirror/state` is libs/editor's dependency, not the shell's). */
type Extension = ReturnType<typeof suggestions>

/** What the suggestions need of the workspace facade. */
export type SuggestionWorkspace = Pick<
  Workspace,
  'suggestionSpans' | 'subscribeSuggestions' | 'acceptSuggestion' | 'rejectSuggestion' | 'undoAgent' | 'flash'
>

/** One editor's host: its note's suggestions, plus the note-wide acts the commands run. */
export interface NoteSuggestionsHost extends SuggestionsHost {
  path(): string | null
  /** Accept every pending suggestion in the note; how many landed and how many had gone stale. */
  acceptAll(): { accepted: number; stale: number }
  /** Reject every suggestion in the note (pending or stale); how many. */
  rejectAll(): number
}

/**
 * The editor that last had the focus, and its host — what the commands act
 * on. Plain module state on purpose: CM6 reports to it, nothing renders it.
 */
let active: { view: EditorView; host: NoteSuggestionsHost } | null = null
/** The workspace of the newest host, so `ai.undo-agent` works with no editor focused. */
let lastWorkspace: (() => SuggestionWorkspace | null) | null = null

/** Forget the focused editor (tests). */
export function resetSuggestionEditors(): void {
  active = null
  lastWorkspace = null
}

/**
 * The host for one pane's editor. Both getters are read lazily, at the call:
 * the pane hands the same extension to every view it builds, and a view is
 * built per note, so `path()` at subscribe time IS that view's note.
 */
export function noteSuggestionsHost(
  workspace: () => SuggestionWorkspace | null,
  path: () => string | null
): NoteSuggestionsHost {
  const ws = (): { w: SuggestionWorkspace; p: string } | null => {
    const w = workspace()
    const p = path()
    return w && p ? { w, p } : null
  }
  const accept = (id: string): SuggestionRecord | null => {
    const at = ws()
    return at ? at.w.acceptSuggestion(at.p, id) : null
  }
  const host: NoteSuggestionsHost = {
    path,
    current(): EditorSuggestion[] {
      const at = ws()
      if (!at) return []
      return at.w.suggestionSpans(at.p).flatMap((s) =>
        s.status === 'pending' || s.status === 'stale'
          ? [{ id: s.id, from: s.from, to: s.to, baseText: s.baseText, proposedText: s.proposedText, status: s.status, name: s.name }]
          : []
      )
    },
    subscribe(onChange) {
      const at = ws()
      return at ? at.w.subscribeSuggestions(at.p, onChange) : () => {}
    },
    accept(id) {
      if (accept(id)?.status === 'stale') workspace()?.flash({ level: 'info', text: getLL().web.ai.suggest.stale() })
    },
    reject(id) {
      const at = ws()
      at?.w.rejectSuggestion(at.p, id)
    },
    acceptAll() {
      let accepted = 0
      let stale = 0
      // A stale one is left on the page (to re-run), and counted: the
      // writer should hear that not everything landed.
      for (const s of host.current()) {
        if (s.status === 'pending' && accept(s.id)?.status === 'accepted') accepted++
        else stale++
      }
      return { accepted, stale }
    },
    rejectAll() {
      const at = ws()
      if (!at) return 0
      let n = 0
      for (const s of host.current()) if (at.w.rejectSuggestion(at.p, s.id)) n++
      return n
    },
    focus(view, focused) {
      lastWorkspace = workspace
      if (focused || !active) active = { view, host }
    },
    detach(view) {
      if (active?.view === view) active = null
    },
  }
  return host
}

/**
 * The extension a pane hands its editors: the suggestions drawn and keyed,
 * in `suggestionsCompartment` so it reconfigures without a rebuild.
 */
export function noteSuggestions(workspace: () => SuggestionWorkspace | null, path: () => string | null): Extension {
  return suggestionsCompartment.of(suggestions(noteSuggestionsHost(workspace, path)))
}

/** The five `ai.*` suggestion rows (writing-harness-build D §6). */
export function suggestionCommands(flash?: (input: FlashInput) => void): Command[] {
  const t = getLL().web.ai.commands
  const s = getLL().web.ai.suggest
  const group = getLL().web.commands.groups.ai()
  const say = (text: string): void => flash?.({ level: 'info', text })
  const atCaret = (act: 'accept' | 'reject'): void => {
    const target = active
    const hit = target ? suggestionAt(target.view.state, target.view.state.selection.main.head) : null
    if (!target || !hit) return say(s.none_at_caret())
    if (act === 'accept') target.host.accept(hit.id)
    else target.host.reject(hit.id)
  }
  return [
    { id: 'ai.accept-suggestion', title: t.accept_suggestion(), group, when: aiEnabled, run: () => atCaret('accept') },
    { id: 'ai.reject-suggestion', title: t.reject_suggestion(), group, when: aiEnabled, run: () => atCaret('reject') },
    {
      id: 'ai.accept-all',
      title: t.accept_all(),
      group,
      when: aiEnabled,
      run: () => {
        if (!active || suggestionsIn(active.view.state).length === 0) return say(s.none_in_note())
        const { accepted, stale } = active.host.acceptAll()
        if (accepted === 0 && stale === 0) return say(s.none_in_note())
        say(stale ? s.accepted_some({ count: accepted, stale }) : s.accepted_all({ count: accepted }))
      },
    },
    {
      id: 'ai.reject-all',
      title: t.reject_all(),
      group,
      when: aiEnabled,
      run: () => {
        const n = active?.host.rejectAll() ?? 0
        say(n ? s.rejected_all({ count: n }) : s.none_in_note())
      },
    },
    {
      id: 'ai.undo-agent',
      title: t.undo_agent(),
      group,
      when: aiEnabled,
      run: () => {
        const done = lastWorkspace?.()?.undoAgent() ?? false
        say(done ? s.undone() : s.nothing_to_undo())
      },
    },
  ]
}

/**
 * The newest edit the in-app agent made, from the event log (newest first):
 * its `doc.changed` with `actor.kind === 'agent'` — the one honest `agent`
 * source (`events.ts`). What the `last-agent-write` readout says; null when
 * the agent has written nothing this log remembers.
 */
export function lastAgentWrite(events: readonly AppEvent[]): { name: string; path: string; at: number } | null {
  for (const e of events) {
    if (e.kind !== 'doc.changed' || e.actor.kind !== 'agent' || !e.scope.path) continue
    return { name: e.actor.name ?? getLL().web.ai.session.title(), path: e.scope.path, at: e.at }
  }
  return null
}

/**
 * The workspace's records and the harness seam's are one shape: `libs/workspace`
 * cannot import `@ohhi/harness`, so it mirrors the types, and this is where a
 * drift fails to compile.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const SUGGESTIONS_AGREE: Same<SuggestionRecord, HarnessRecord> = true
