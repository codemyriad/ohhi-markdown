// @vitest-environment jsdom
/**
 * `last-agent-write` (writing-harness B7): "Tighten edited plan 3 min ago"
 * from the event log's newest agent `doc.changed`, aged on the injected
 * clock; nothing at all until the agent has written.
 */
import { getLL } from '@ohhi/i18n'
import type { AppEvent } from '@ohhi/workspace'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { event, fakeViewShell } from '../../readouts.fixture.js'
import { viewShellContext } from '../../views.js'
import type { Workspace } from '../../workspace.svelte.js'
import LastAgentWrite from './LastAgentWrite.svelte'

const NOW = 1_000_000
const t = getLL().web.ai.suggest

afterEach(() => cleanup())

function setup(events: AppEvent[], merged = false) {
  const shell = fakeViewShell(NOW)
  const ctx = { workspace: { ui: { events } } as unknown as Workspace, merged }
  render(LastAgentWrite, { props: { ctx, clock: shell.clock }, context: viewShellContext(shell) })
  return { shell, user: userEvent.setup() }
}

const agentEdit = (at: number, path = 'notes/plan.md', name = 'Tighten'): AppEvent =>
  event({ kind: 'doc.changed', at, scope: { path }, actor: { kind: 'agent', name }, payload: { guid: 'g' } })

describe('the last-agent-write readout', () => {
  it("says who edited which note how long ago, from the newest agent edit, and opens it", async () => {
    const { shell, user } = setup([
      event({ kind: 'doc.changed', at: NOW - 1_000, scope: { path: 'other.md' }, actor: { kind: 'peer', name: 'Sam' }, payload: { guid: 'h' } }),
      agentEdit(NOW - 3 * 60_000),
      agentEdit(NOW - 60 * 60_000, 'old.md', 'Old'),
    ])
    const button = screen.getByTestId('toolbar-last-agent-write')
    expect(button).toHaveTextContent(t.last_write({ name: 'Tighten', note: 'plan', ago: getLL().web.relative_time.minutes({ count: 3 }) }))
    expect(button).toHaveAttribute('title', t.last_write_title({ note: 'plan' }))
    await user.click(button)
    expect(shell.openPath).toHaveBeenCalledWith('notes/plan.md')
  })

  it('renders nothing until the agent has written', () => {
    setup([event({ kind: 'doc.changed', at: NOW, scope: { path: 'a.md' }, actor: { kind: 'disk' }, payload: { guid: 'g' } })])
    expect(screen.queryByTestId('toolbar-last-agent-write')).toBeNull()
  })

  it("carries the status bar's testid when the bars are merged", () => {
    setup([agentEdit(NOW)], true)
    expect(screen.getByTestId('last-agent-write')).toHaveTextContent(t.last_write({ name: 'Tighten', note: 'plan', ago: getLL().web.relative_time.now() }))
  })
})
