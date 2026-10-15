/**
 * The agent's suggestions in the shell: the `@ohhi/editor` suggestions
 * extension on every open editor, fed with its note's records from the
 * workspace facade (`MountSession` holds them), and the five commands that
 * act on them — `ai.accept-suggestion` / `ai.reject-suggestion` (the one
 * under the caret), `ai.accept-all` / `ai.reject-all` (the note) and
 * `ai.undo-agent` (the agent's last run).
 *
 * Which editor a command means is `focused-editor.svelte.ts`'s answer: the
 * one whose pane last had the focus.
 *
 * `Mod-Enter` / `Mod-Backspace` are the editor's own keymap (they fall
 * through when the caret is in no suggestion); the two caret rows carry the
 * same keys, guarded on the caret being in a suggestion, so the Keys table
 * shows them and the registry never takes the key from the editor
 * otherwise. Every row is listed only while a provider exists (R1).
 */
import {
  suggestionAt,
  suggestions,
  suggestionsCompartment,
  suggestionsIn,
  type EditorSuggestion,
  type SuggestionsHost,
} from '@ohhi/editor'
import { getLL } from '@ohhi/i18n'
import type { AppEvent, SuggestionRecord } from '@ohhi/workspace'
import type { Command } from './commands.js'
import { aiEnabled } from './ai-config.svelte.js'
import { focusedEditor } from './focused-editor.svelte.js'
import type { FlashInput } from './notices.js'
import { harnessWorkspace } from './sessions.svelte.js'
import type { Workspace } from './workspace.svelte.js'

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

/**
 * The five `ai.*` suggestion rows, over the focused editor's note.
 * `workspace` is the open vault's facade (the harness's by default).
 */
export function suggestionCommands(
  flash?: (input: FlashInput) => void,
  workspace: () => SuggestionWorkspace | null = harnessWorkspace
): Command[] {
  const t = getLL().web.ai.commands
  const s = getLL().web.ai.suggest
  const group = getLL().web.commands.groups.ai()
  const say = (text: string): void => flash?.({ level: 'info', text })
  /** The focused editor and the acts on its note. */
  const target = () => {
    const e = focusedEditor()
    return e ? { view: e.view, host: noteSuggestionsHost(workspace, () => e.path) } : null
  }
  const atCaret = (act: 'accept' | 'reject'): void => {
    const at = target()
    const hit = at ? suggestionAt(at.view.state, at.view.state.selection.main.head) : null
    if (!at || !hit) return say(s.none_at_caret())
    if (act === 'accept') at.host.accept(hit.id)
    else at.host.reject(hit.id)
  }
  /**
   * The focused editor's caret is in a suggestion: the one case the two
   * keys are these rows' and not CodeMirror's (`Mod-Enter` is its
   * `insertBlankLine`). Guarded, the registry skips them otherwise, so the
   * key falls through to the editor (`CommandRegistry.match`) — and the
   * Keys table and the palette can at last SHOW the keys (Chris,
   * 2026-10-15: "it was not obvious").
   */
  const caretInSuggestion = (): boolean => {
    const e = focusedEditor()
    return !!e && suggestionAt(e.view.state, e.view.state.selection.main.head) !== null
  }
  const onSuggestion = (): boolean => aiEnabled() && caretInSuggestion()
  return [
    { id: 'ai.accept-suggestion', title: t.accept_suggestion(), group, keys: 'Mod+Enter', when: onSuggestion, run: () => atCaret('accept') },
    { id: 'ai.reject-suggestion', title: t.reject_suggestion(), group, keys: 'Mod+Backspace', when: onSuggestion, run: () => atCaret('reject') },
    {
      id: 'ai.accept-all',
      title: t.accept_all(),
      group,
      when: aiEnabled,
      run: () => {
        const at = target()
        if (!at || suggestionsIn(at.view.state).length === 0) return say(s.none_in_note())
        const { accepted, stale } = at.host.acceptAll()
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
        const n = target()?.host.rejectAll() ?? 0
        say(n ? s.rejected_all({ count: n }) : s.none_in_note())
      },
    },
    {
      id: 'ai.undo-agent',
      title: t.undo_agent(),
      group,
      when: aiEnabled,
      run: () => {
        const done = workspace()?.undoAgent() ?? false
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
