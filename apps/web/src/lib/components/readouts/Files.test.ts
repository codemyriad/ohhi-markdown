// @vitest-environment jsdom
/** The `files` readout (decision 8) through its component: hidden, In Files, waiting, blocked. */
import { cleanup, render, screen } from '@testing-library/svelte'
import type { CustodianState } from '@ohhi/workspace'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReadoutContext } from '../../readouts.js'
import type { Workspace } from '../../workspace.svelte.js'
import Files from './Files.svelte'

const files = [
  { path: 'a.md', guid: 'g-a', kind: 'text' as const },
  { path: 'b.md', guid: 'g-b', kind: 'text' as const },
]

const ctxWith = (custodian: CustodianState | null) =>
  ({ workspace: { ui: { custodian, files } } as unknown as Workspace }) as Pick<ReadoutContext, 'workspace'>

const c = (disk: CustodianState['disk'], blocked: CustodianState['blocked'] = {}): CustodianState => ({
  type: 'custodian',
  instance: 'i',
  disk,
  blocked,
  holds: 0,
})

afterEach(cleanup)

describe('Files readout', () => {
  it('is absent while no custodian is present', () => {
    render(Files, { ctx: ctxWith(null) })
    expect(screen.queryByTestId('files-readout')).toBeNull()
  })

  it('says In Files, N waiting, or Blocked (status)', () => {
    const { unmount } = render(Files, { ctx: ctxWith(c({ 'g-a': 'match', 'g-b': 'match' })) })
    expect(screen.getByTestId('files-readout').textContent?.trim()).toBe('In Files')
    unmount()
    const second = render(Files, { ctx: ctxWith(c({ 'g-a': 'behind', 'g-b': 'behind' })) })
    expect(screen.getByTestId('files-readout').textContent?.trim()).toBe('2 waiting')
    second.unmount()
    render(Files, { ctx: ctxWith(c({ 'g-a': 'blocked' }, { 'g-a': 423 })) })
    expect(screen.getByTestId('files-readout').textContent?.trim()).toBe('Blocked (423)')
    expect(screen.getByTestId('files-readout').dataset.state).toBe('blocked')
  })
})
