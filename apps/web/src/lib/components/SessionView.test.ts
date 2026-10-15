// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import type { HarnessAgent, ProviderConfig } from '@ohhi/harness'
import { MemoryIndex } from '@ohhi/index'
import { SimClock } from '@ohhi/testkit'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import type { UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setAiConfig } from '../ai-config.svelte.js'
import { memAppFiles } from '../harness.fixture.js'
import type { Tab } from '../panes.js'
import { fakeViewShell } from '../readouts.fixture.js'
import { mentionOf } from '../references.js'
import type { AgentFactory } from '../ai-transport.js'
import { attachHarness, harness, queueMention, requestComposerFocus, startRun } from '../sessions.svelte.js'
import { viewShellContext } from '../views.js'
import type { Workspace } from '../workspace.svelte.js'
import SessionView from './SessionView.svelte'

const t = getLL().web.ai.session

// jsdom has no layout: a focused CM6 view measures text through Range rects.
const emptyRects = (): DOMRectList => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

// The transcript's first render pulls in the markdown renderer; under a full,
// parallel suite that alone can outlast the default 1 s wait.
configure({ asyncUtilTimeout: 5000 })
const PROVIDER: ProviderConfig = { id: 'p1', name: 'Local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'mock-model', apiKey: 'k' }

/** A stub agent: plays `chunks`, and with `hold` stays open until stopped. */
function agentOf(chunks: UIMessageChunk[], hold = false): AgentFactory {
  return (() =>
    ({
      async stream(_m, { signal }) {
        return new ReadableStream<UIMessageChunk>({
          start(c) {
            for (const chunk of chunks) c.enqueue(chunk)
            if (!hold) c.close()
            signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          },
        })
      },
      lastUsage: () => undefined,
    }) satisfies HarnessAgent) as unknown as AgentFactory
}

const say = (text: string): UIMessageChunk[] => [
  { type: 'start' },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  { type: 'finish' },
]

function setup(opts: { agent?: AgentFactory; files?: Record<string, string>; viewArg?: string; note?: string } = {}) {
  const app = memAppFiles(opts.files)
  const files = app.files
  const workspace = {
    room: 'room-1',
    ui: { files: [{ path: 'plan.md', guid: 'g1', kind: 'text' }], selectedPath: opts.note ?? null },
    docForPath: () => ({ getText: () => '# Plan\n' }),
    readFileBytes: async () => null,
    journalFor: () => null,
    readAppFile: app.readAppFile,
    writeAppFile: app.writeAppFile,
    listAppDir: app.listAppDir,
    onAppFileChange: () => () => {},
    flash: vi.fn(),
    suggestionsFor: () => [],
    subscribeSuggestions: () => () => {},
  } as unknown as Workspace
  const openView = vi.fn()
  attachHarness({ workspace: () => workspace, index: new MemoryIndex(), clock: new SimClock(), openView, agentFactory: opts.agent ?? agentOf(say('Hi from the agent.')) })
  const shell = fakeViewShell(0)
  const tab = { id: 'tab-1', path: null, view: 'session', viewArg: opts.viewArg ?? 's1' } as Tab
  render(SessionView, { props: { workspace, tab }, context: viewShellContext(shell) })
  return { workspace, files, openView, shell, user: userEvent.setup() }
}

const content = (): HTMLElement => screen.getByTestId('session-composer-input')

/** Once the turn is done its runs are folded to a line: unfold each, as a person would to see the rows. */
async function unfoldRuns(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful'))
  for (const b of screen.queryAllByTestId('session-run-toggle')) if (b.getAttribute('aria-expanded') === 'false') await user.click(b)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setAiConfig({ providers: [PROVIDER] })
})
afterEach(() => {
  cleanup()
  attachHarness(null)
  harness.focusComposer = null
})

describe('SessionView', () => {
  it('without a provider, says where to add one instead of offering a composer — and opens Settings › AI', async () => {
    setAiConfig({ providers: [] })
    const { shell, user } = setup()
    expect(screen.getByTestId('session-no-provider')).toHaveTextContent(t.no_provider())
    expect(screen.queryByTestId('session-composer')).toBeNull()
    await user.click(screen.getByRole('button', { name: t.open_settings() }))
    expect(shell.openSettings).toHaveBeenCalledExactlyOnceWith('ai')
  })

  it('an empty session lists the vault’s other sessions — the note each was about, its provider — and one opens its tab', async () => {
    const header = JSON.stringify({ type: 'session', version: 1, id: 'old', created: 1, vault: 'room-1', title: 'Draft review' })
    const run = {
      type: 'run',
      id: 'e1',
      parentId: null,
      at: 2,
      run: { runId: 'r1', status: 'successful', input: { refs: [mentionOf({ kind: 'file', path: 'notes/plan.md' })], instruction: 'x' }, provider: 'p1', model: 'm' },
    }
    const { openView, user } = setup({ files: { '.ohhi/sessions/old.jsonl': `${header}\n${JSON.stringify(run)}\n` } })
    const row = await screen.findByTestId('session-recent:old')
    expect(row).toHaveTextContent('Draft review')
    expect(row).toHaveTextContent('plan.md')
    expect(row).toHaveTextContent('Local')
    // …and *Continue* is a start for the newest one.
    expect(screen.getByTestId('session-start-continue')).toHaveTextContent(t.starts.continue({ title: 'Draft review' }))
    // Not the vault's first session: the egress sentence is not repeated.
    expect(screen.queryByTestId('session-egress')).toBeNull()
    await user.click(row)
    expect(openView).toHaveBeenCalledWith('session', 'old')
  })

  it('the first screen: starts for the note you came from, the composer focused, the provider at its foot, the egress said once', async () => {
    // A person opened it (a door, a key): the composer takes the keyboard.
    requestComposerFocus('s1')
    const { user } = setup({ note: 'notes/plan.md' })
    await waitFor(() => expect(content()).toHaveFocus())
    expect(harness.focusComposer).toBeNull() // taken once
    // The vault's first session: where words go is said, under the starts.
    expect(await screen.findByTestId('session-egress')).toHaveTextContent(getLL().web.ai.providers.egress({ name: 'Local', host: 'localhost:11434' }))
    // The provider is a picker at the composer's foot, not in the header.
    expect(within(screen.getByTestId('session-header')).queryByTestId('session-provider')).toBeNull()
    expect(within(screen.getByTestId('session-composer-foot')).getByTestId('session-provider')).toHaveTextContent('Local')
    expect(screen.queryByTestId('session-start-continue')).toBeNull()
    // From the top, under the header — nothing pushes it to the foot — and the starts a quiet list, no boxes.
    expect(screen.getByTestId('session-empty')).not.toHaveClass('mt-auto')
    for (const b of within(screen.getByTestId('session-starts')).getAllByRole('button')) expect(b.className).not.toMatch(/\bborder\b/)
    // *Ask about* hands the note to the composer as a chip.
    await user.click(screen.getByRole('button', { name: t.starts.ask({ note: 'plan.md' }) }))
    expect(await screen.findByTestId('mention-chip')).toHaveTextContent('@plan.md')
    // *Run a skill…* types the `/` that opens the skills menu.
    await user.click(screen.getByRole('button', { name: t.starts.skill() }))
    await waitFor(() => expect(content()).toHaveTextContent('/'))
  })

  it('a session nobody just opened (a tab restored at startup) leaves the keyboard alone, until a door asks', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    setup({ note: 'notes/plan.md' })
    await screen.findByTestId('session-composer-input')
    await new Promise((r) => setTimeout(r, 20))
    expect(outside).toHaveFocus()
    // Another session's request is not this one's.
    requestComposerFocus('other')
    await new Promise((r) => setTimeout(r, 20))
    expect(outside).toHaveFocus()
    // A door to THIS session, while it is already on screen: now it takes the keyboard.
    requestComposerFocus('s1')
    await waitFor(() => expect(content()).toHaveFocus())
    outside.remove()
  })

  it('Summarise sends a turn of its own with the note as its reference', async () => {
    const { user } = setup({ note: 'notes/plan.md' })
    await user.click(screen.getByRole('button', { name: t.starts.summarise({ note: 'plan.md' }) }))
    const messages = await screen.findAllByTestId('session-message')
    expect(messages[0]).toHaveTextContent(t.starts.summarise_prompt())
    expect(await screen.findByTestId('session-message-refs')).toHaveTextContent('@plan.md')
  })

  it('a sent message renders as the person’s turn, then the agent’s', async () => {
    setup()
    await startRun({ sessionId: 's1', instruction: 'What does the plan say?', open: false })
    const messages = await screen.findAllByTestId('session-message')
    await waitFor(() => expect(screen.getAllByTestId('session-message')).toHaveLength(2))
    expect(messages[0]).toHaveAttribute('data-role', 'user')
    expect(messages[0]).toHaveTextContent('What does the plan say?')
    const reply = screen.getAllByTestId('session-message')[1]
    await waitFor(() => expect(within(reply).getByTestId('session-markdown')).toHaveTextContent('Hi from the agent.'))
    await waitFor(() => expect(screen.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful'))
  })

  it('a tool call renders as a card whose hits open their note', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'ohhi_search', input: { query: 'harness' } },
      {
        type: 'tool-output-available',
        toolCallId: 'c1',
        output: { schema: 'ohhi.search.v1', query: 'harness', hits: [{ path: 'plan.md', line: 3, tier: 'body', score: 1, snippets: [] }] },
      },
      { type: 'tool-input-available', toolCallId: 'c2', toolName: 'ohhi_search', input: { query: 'title' } },
      {
        type: 'tool-output-available',
        toolCallId: 'c2',
        output: { schema: 'ohhi.search.v1', query: 'title', hits: [{ path: 'roadmap.md', line: null, tier: 'title', score: 1, snippets: [] }] },
      },
      ...say('Found it.').slice(1),
    ]
    const { shell, user } = setup({ agent: agentOf(chunks) })
    await startRun({ sessionId: 's1', instruction: 'Find the harness', open: false })
    await unfoldRuns(user)
    const card = (await screen.findAllByTestId('tool-card'))[0]!
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'output-available'))
    expect(within(card).getByTestId('tool-summary')).toHaveTextContent(t.tool.search({ query: 'harness' }))
    // The hit's row is the one control: no separate Open, and its name says where it goes.
    const hits = within(card).getByTestId('tool-hits')
    expect(within(hits).queryByRole('button', { name: t.tool.open() })).toBeNull()
    const hit = within(hits).getByRole('button', { name: t.tool.open_hit({ path: 'plan.md', line: 3 }) })
    expect(hit).toHaveAttribute('data-testid', 'tool-hit')
    expect(hit).toHaveTextContent('plan.md:3')
    expect(hit.querySelector('button')).toBeNull()
    await user.click(hit)
    expect(shell.revealLine).toHaveBeenCalledWith('plan.md', 3)
    // A hit with no line (a title match) opens its note beside.
    await waitFor(() => expect(screen.getAllByTestId('tool-card')).toHaveLength(2))
    const titled = screen.getAllByTestId('tool-card')[1]!
    await waitFor(() => expect(titled).toHaveAttribute('data-state', 'output-available'))
    await user.click(within(titled).getByRole('button', { name: t.tool.open_note({ path: 'roadmap.md' }) }))
    expect(shell.openPath).toHaveBeenCalledWith('roadmap.md', { beside: true })
  })

  it('a finished run folds to one line counting its calls by kind, the failed apart; the live run is open', async () => {
    const call = (id: string, toolName: string, output: unknown, input: unknown = {}): UIMessageChunk[] => [
      { type: 'tool-input-available', toolCallId: id, toolName, input },
      { type: 'tool-output-available', toolCallId: id, output } as UIMessageChunk,
    ]
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'Look first.' },
      { type: 'reasoning-end', id: 'r1' },
      ...call('c1', 'ohhi_read', { schema: 'ohhi.read.v1', path: 'a.md', text: 'A' }, { path: 'a.md' }),
      ...call('c2', 'ohhi_search', { schema: 'ohhi.search.v1', query: 'x', hits: [] }, { query: 'x' }),
      ...call('c3', 'ohhi_read', { schema: 'ohhi.read.v1', path: 'b.md', text: 'B' }, { path: 'b.md' }),
      ...call('c4', 'ohhi_search', { schema: 'ohhi.search.v1', query: 'y', hits: [] }, { query: 'y' }),
      ...call('c5', 'ohhi_ls', { schema: 'ohhi.ls.v1', entries: [] }),
      ...call('c6', 'ohhi_read', { schema: 'ohhi.read.v1', path: 'c.md', text: 'C' }, { path: 'c.md' }),
      { type: 'tool-input-available', toolCallId: 'c7', toolName: 'ohhi_changes', input: { since: '1h' } },
      { type: 'tool-output-error', toolCallId: 'c7', errorText: 'usage: since' },
      ...call('c8', 'ohhi_patch', { schema: 'ohhi.proposal.v1', path: 'a.md', message: 'm', proposed: true, suggestionId: 'sg-1', from: 0, to: 1 }, { path: 'a.md' }),
    ]
    // Held open: the run is live, so it is unfolded to watch.
    setup({ agent: agentOf(chunks, true) })
    await startRun({ sessionId: 's1', instruction: 'Look around', open: false })
    await waitFor(() => expect(screen.getAllByTestId('tool-card')).toHaveLength(8))
    const liveToggle = screen.getByTestId('session-run-toggle')
    expect(liveToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('session-run-rows')).toBeVisible()
    cleanup()
    attachHarness(null)

    // Finished: one line, Thinking never in it; the rows behind the toggle.
    const { user } = setup({ agent: agentOf([...chunks, ...say('Done.').slice(1)]) })
    await startRun({ sessionId: 's1', instruction: 'Look around', open: false })
    await waitFor(() => expect(screen.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful'))
    const toggle = screen.getByTestId('session-run-toggle')
    const r = t.run_line
    expect(screen.getByTestId('session-run-summary')).toHaveTextContent(
      `Read 3 notes · ${r.search_twice()} · ${r.list({ count: 1 })} · ${r.proposed({ count: 1 })}`
    )
    expect(screen.getByTestId('session-run-failed')).toHaveTextContent(r.failed({ count: 1 }))
    expect(screen.getByTestId('session-run-failed')).toHaveClass('text-error')
    expect(toggle).not.toHaveTextContent(t.reasoning())
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('session-run-rows')).not.toBeVisible()
    expect(screen.queryByRole('button', { name: t.reasoning() })).toBeNull()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('session-run-rows')).toBeVisible()
    expect(screen.getByRole('button', { name: t.reasoning() })).toBeVisible()
    expect(screen.getAllByRole('button', { name: t.tool.details() })).toHaveLength(8)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('thinking and tool calls form one run of rows, each folding its own Details / Thinking by a real toggle', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'reasoning-start', id: 'r0' },
      { type: 'reasoning-end', id: 'r0' },
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', delta: 'Look at the note first.' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'ohhi_read', input: { path: 'plan.md' } },
      { type: 'tool-output-available', toolCallId: 'c1', output: { schema: 'ohhi.read.v1', path: 'plan.md', text: 'Plan' } },
      { type: 'tool-input-available', toolCallId: 'c2', toolName: 'ohhi_ls', input: {} },
      { type: 'tool-output-available', toolCallId: 'c2', output: { schema: 'ohhi.ls.v1', entries: [] } },
      ...say('Read it.').slice(1),
    ]
    const { user } = setup({ agent: agentOf(chunks) })
    await startRun({ sessionId: 's1', instruction: 'Read the plan', open: false })
    await unfoldRuns(user)
    await waitFor(() => expect(screen.getAllByTestId('tool-card')).toHaveLength(2))
    // One run: the empty reasoning draws nothing, the other a row, then both calls.
    const run = screen.getByTestId('session-tool-run')
    expect(within(run).getAllByTestId('session-reasoning')).toHaveLength(1)
    expect(within(run).getAllByTestId('tool-card')).toHaveLength(2)

    const thinking = within(run).getByRole('button', { name: getLL().web.ai.session.reasoning() })
    expect(thinking).toHaveAttribute('aria-expanded', 'false')
    expect(run).not.toHaveTextContent('Look at the note first.')
    await user.click(thinking)
    expect(thinking).toHaveAttribute('aria-expanded', 'true')
    expect(run).toHaveTextContent('Look at the note first.')

    const [read, ls] = within(run).getAllByTestId('tool-card')
    const toggle = within(read).getByRole('button', { name: t.tool.details() })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(read).queryByTestId('tool-details')).toBeNull()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(read).getByTestId('tool-details')).toHaveTextContent('"path": "plan.md"')
    // Per card: the other stays folded.
    expect(within(ls).getByRole('button', { name: t.tool.details() })).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(within(read).queryByTestId('tool-details')).toBeNull()
  })

  it('a proposal renders as “proposed an edit in <note>” with Show in note; an empty one says so', async () => {
    const proposal = (id: string, out: Record<string, unknown>): UIMessageChunk[] => [
      { type: 'tool-input-available', toolCallId: id, toolName: 'ohhi_patch', input: { path: 'plan.md', old: 'a', new: 'b' } },
      { type: 'tool-output-available', toolCallId: id, output: { schema: 'ohhi.proposal.v1', path: 'plan.md', message: 'm', ...out } },
    ]
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      ...proposal('c1', { proposed: true, suggestionId: 'sg-1', from: 0, to: 1 }),
      ...proposal('c2', { proposed: false }),
      ...say('Proposed.').slice(1),
    ]
    const { shell, user } = setup({ agent: agentOf(chunks) })
    await startRun({ sessionId: 's1', instruction: 'Fix it', open: false })
    await unfoldRuns(user)
    await waitFor(() => expect(screen.getAllByTestId('tool-card')).toHaveLength(2))
    const [made, none] = screen.getAllByTestId('tool-card')
    await waitFor(() => expect(within(made).getByTestId('tool-summary')).toHaveTextContent(t.tool.proposed({ path: 'plan.md' })))
    await waitFor(() => expect(within(none).getByTestId('tool-summary')).toHaveTextContent(getLL().web.ai.session.tool.proposal_none({ path: 'plan.md' })))
    expect(within(none).queryByTestId('tool-open')).toBeNull()
    expect(within(none).queryByTestId('proposal-actions')).toBeNull()
    // Its record is not in any open note here: it says so, and offers only Show in note.
    expect(within(made).getByTestId('proposal-status')).toHaveAttribute('data-status', 'gone')
    expect(within(made).getByTestId('proposal-status')).toHaveTextContent(t.tool.proposal_status.gone())
    expect(within(made).queryByTestId('proposal-accept')).toBeNull()
    // Show in note sits in the row, one voice with Details, right before it.
    const actions = within(made).getByTestId('proposal-actions')
    const verbs = within(actions).getAllByRole('button').map((b) => b.textContent?.trim())
    expect(verbs).toEqual([t.tool.show_in_note(), t.tool.details()])
    expect(actions).toHaveTextContent(`${t.tool.show_in_note()} · ${t.tool.details()}`)
    await user.click(within(made).getByRole('button', { name: t.tool.show_in_note() }))
    expect(shell.revealSuggestion).toHaveBeenCalledWith('plan.md', 'sg-1', { focus: true })
  })

  it('a proposal’s card reads its record: Accept reveals it in the note, then runs the registry’s accept row', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'ohhi_patch', input: { path: 'plan.md', old: 'Plan', new: 'Roadmap' } },
      {
        type: 'tool-output-available',
        toolCallId: 'c1',
        output: { schema: 'ohhi.proposal.v1', path: 'plan.md', message: 'm', proposed: true, suggestionId: 'sg-1', from: 2, to: 6 },
      },
      ...say('Proposed.').slice(1),
    ]
    const { shell, workspace, user } = setup({ agent: agentOf(chunks) })
    // The note's one record, as the workspace answers it.
    const record = { id: 'sg-1', path: 'plan.md', status: 'pending', baseText: 'Plan', proposedText: 'Roadmap' }
    Object.assign(workspace, { suggestionsFor: () => [record], subscribeSuggestions: () => () => {} })
    await startRun({ sessionId: 's1', instruction: 'Rename it', open: false })
    await unfoldRuns(user)
    const card = await screen.findByTestId('tool-card')
    await waitFor(() => expect(within(card).getByTestId('proposal-status')).toHaveAttribute('data-status', 'pending'))
    expect(within(card).getByTestId('proposal-diff')).toHaveTextContent('Plan Roadmap')
    // Live: Accept · Reject · Show in note · Details, all in the row.
    const verbs = within(within(card).getByTestId('proposal-actions')).getAllByRole('button').map((b) => b.textContent?.trim())
    expect(verbs).toEqual([t.tool.accept(), t.tool.reject(), t.tool.show_in_note(), t.tool.details()])
    await user.click(within(card).getByRole('button', { name: t.tool.accept() }))
    await waitFor(() => expect(shell.runCommand).toHaveBeenCalledWith('ai.accept-suggestion'))
    expect(shell.revealSuggestion).toHaveBeenCalledWith('plan.md', 'sg-1')
    await user.click(within(card).getByRole('button', { name: t.tool.reject() }))
    await waitFor(() => expect(shell.runCommand).toHaveBeenLastCalledWith('ai.reject-suggestion'))
  })

  it('a turn a comment asked says so, and Show thread brings the thread back in its note', async () => {
    const { shell, user } = setup()
    await startRun({
      sessionId: 's1',
      instruction: 'Which day?',
      refs: [mentionOf({ kind: 'lines', path: 'notes/plan.md', lines: { from: 1, to: 1 } })],
      threadId: 'th-1',
      open: false,
    })
    const row = await screen.findByTestId('session-message-thread')
    expect(row).toHaveTextContent(getLL().web.ai.comments.from_comment({ note: 'plan.md' }))
    await user.click(within(row).getByRole('button', { name: getLL().web.ai.comments.show_thread() }))
    expect(shell.revealThread).toHaveBeenCalledWith('notes/plan.md', 'th-1')
  })

  it('a handed-over mention becomes a chip; Backspace removes it whole', async () => {
    setup()
    queueMention('s1', mentionOf({ kind: 'file', path: 'notes/plan.md' }))
    const chip = await screen.findByTestId('mention-chip')
    expect(chip).toHaveTextContent('@plan.md')
    expect(chip).toHaveAccessibleName(getLL().web.ai.refs.chip({ label: 'plan.md' }))
    expect(harness.inbox.s1).toBeUndefined() // taken

    // The caret sits after the chip and its space: one Backspace eats the
    // space, the next the whole chip — never one character of it.
    fireEvent.keyDown(content(), { key: 'Backspace' })
    expect(screen.getByTestId('mention-chip')).toBeInTheDocument()
    fireEvent.keyDown(content(), { key: 'Backspace' })
    await waitFor(() => expect(screen.queryByTestId('mention-chip')).toBeNull())
    expect(content().querySelector('.cm-placeholder')).not.toBeNull() // the doc is empty again
  })

  it('Enter sends the composer’s text with its references', async () => {
    setup()
    queueMention('s1', mentionOf({ kind: 'file', path: 'plan.md' }))
    await screen.findByTestId('mention-chip')
    fireEvent.keyDown(content(), { key: 'Enter' })
    const user = await screen.findByTestId('session-message-refs')
    expect(user).toHaveTextContent('@plan.md')
    await waitFor(() => expect(screen.queryByTestId('mention-chip')).toBeNull()) // the composer is cleared
  })

  it('Stop cancels the run in flight', async () => {
    const { user } = setup({ agent: agentOf(say('partial').slice(0, 3), true) })
    await startRun({ sessionId: 's1', instruction: 'Go slowly', open: false })
    await waitFor(() => expect(screen.getByTestId('session-run-status').dataset.status).toBe('running'))
    const stop = await screen.findByTestId('session-stop')
    await waitFor(() => expect(screen.getByTestId('session-run-status')).toHaveAttribute('data-status', 'running'))
    await user.click(stop)
    await waitFor(() => expect(screen.getByTestId('session-run-status')).toHaveAttribute('data-status', 'cancelled'))
    expect(screen.queryByTestId('session-stop')).toBeNull()
    expect(screen.getByTestId('session-retry')).toBeInTheDocument()
  })
})
