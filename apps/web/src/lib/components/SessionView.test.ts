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
import { attachHarness, harness, queueMention, startRun } from '../sessions.svelte.js'
import { viewShellContext } from '../views.js'
import type { Workspace } from '../workspace.svelte.js'
import SessionView from './SessionView.svelte'

const t = getLL().web.ai.session

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

function setup(opts: { agent?: AgentFactory; files?: Record<string, string>; viewArg?: string } = {}) {
  const app = memAppFiles(opts.files)
  const files = app.files
  const workspace = {
    room: 'room-1',
    ui: { files: [{ path: 'plan.md', guid: 'g1', kind: 'text' }], selectedPath: null },
    docForPath: () => ({ getText: () => '# Plan\n' }),
    readFileBytes: async () => null,
    journalFor: () => null,
    readAppFile: app.readAppFile,
    writeAppFile: app.writeAppFile,
    listAppDir: app.listAppDir,
    onAppFileChange: () => () => {},
    flash: vi.fn(),
  } as unknown as Workspace
  const openView = vi.fn()
  attachHarness({ workspace: () => workspace, index: new MemoryIndex(), clock: new SimClock(), openView, agentFactory: opts.agent ?? agentOf(say('Hi from the agent.')) })
  const shell = fakeViewShell(0)
  const tab = { id: 'tab-1', path: null, view: 'session', viewArg: opts.viewArg ?? 's1' } as Tab
  render(SessionView, { props: { workspace, tab }, context: viewShellContext(shell) })
  return { workspace, files, openView, shell, user: userEvent.setup() }
}

const content = (): HTMLElement => screen.getByTestId('session-composer-input')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setAiConfig({ providers: [PROVIDER] })
})
afterEach(() => {
  cleanup()
  attachHarness(null)
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

  it('an empty session lists the vault’s other sessions, and one opens its tab', async () => {
    const header = JSON.stringify({ type: 'session', version: 1, id: 'old', created: 1, vault: 'room-1', title: 'Draft review' })
    const { openView, user } = setup({ files: { '.ohhi/sessions/old.jsonl': `${header}\n` } })
    expect(screen.getByTestId('session-empty')).toHaveTextContent(t.empty())
    const row = await screen.findByTestId('session-recent:old')
    expect(row).toHaveTextContent('Draft review')
    await user.click(row)
    expect(openView).toHaveBeenCalledWith('session', 'old')
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
      ...say('Found it.').slice(1),
    ]
    const { shell, user } = setup({ agent: agentOf(chunks) })
    await startRun({ sessionId: 's1', instruction: 'Find the harness', open: false })
    const card = await screen.findByTestId('tool-card')
    await waitFor(() => expect(card).toHaveAttribute('data-state', 'output-available'))
    expect(within(card).getByTestId('tool-summary')).toHaveTextContent(t.tool.search({ query: 'harness' }))
    await user.click(within(within(card).getByTestId('tool-hits')).getByRole('button', { name: t.tool.open() }))
    expect(shell.openPath).toHaveBeenCalledWith('plan.md', { beside: true })
  })

  it('a proposal renders as “proposed an edit in <note>” whose Open opens the note; an empty one says so', async () => {
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
    await waitFor(() => expect(screen.getAllByTestId('tool-card')).toHaveLength(2))
    const [made, none] = screen.getAllByTestId('tool-card')
    await waitFor(() => expect(within(made).getByTestId('tool-summary')).toHaveTextContent(t.tool.proposed({ path: 'plan.md' })))
    await waitFor(() => expect(within(none).getByTestId('tool-summary')).toHaveTextContent(getLL().web.ai.session.tool.proposal_none({ path: 'plan.md' })))
    expect(within(none).queryByTestId('tool-open')).toBeNull()
    await user.click(within(made).getByTestId('tool-open'))
    expect(shell.openPath).toHaveBeenCalledWith('plan.md', { beside: true })
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
