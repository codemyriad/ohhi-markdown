// @vitest-environment jsdom
/** The held-changes notice (decision 7): kinds, paths capped at three, buttons only for writers. */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HoldsNotice from './HoldsNotice.svelte'

const breaker = { id: 'b1', kind: 'breaker' as const, paths: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], since: 1 }
const review = { id: 'r1', kind: 'review' as const, paths: ['x.md'], since: 2, guid: 'g' }

afterEach(cleanup)

describe('HoldsNotice', () => {
  it('renders nothing without holds', () => {
    render(HoldsNotice, { holds: [], canResolve: true, onResolve: vi.fn() })
    expect(screen.queryByTestId('holds-notice')).toBeNull()
  })

  it('lists the first three paths and how many more, with each kind’s two answers', async () => {
    const onResolve = vi.fn()
    render(HoldsNotice, { holds: [breaker, review], canResolve: true, onResolve })
    const region = screen.getByRole('region', { name: 'Changes waiting for review' })
    expect(region).toBeTruthy()
    expect(screen.getByText('a.md')).toBeTruthy()
    expect(screen.queryByText('d.md')).toBeNull()
    expect(screen.getByTestId('hold-more:b1').textContent).toContain('2')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Apply changes' }))
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    await user.click(screen.getByRole('button', { name: 'Keep files' }))
    await user.click(screen.getByRole('button', { name: 'Keep note' }))
    expect(onResolve.mock.calls).toEqual([
      ['b1', 'confirm'],
      ['b1', 'discard'],
      ['r1', 'disk'],
      ['r1', 'doc'],
    ])
  })

  it('a reader sees the hold without buttons', () => {
    render(HoldsNotice, { holds: [breaker], canResolve: false, onResolve: vi.fn() })
    expect(screen.getByTestId('hold:b1')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.getByTestId('hold-read-only:b1')).toBeTruthy()
  })
})
