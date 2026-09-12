// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/PopoverHarness.svelte'

afterEach(cleanup)

describe('Popover', () => {
  it('is a named dialog, focuses its first control, and gives focus back on Escape', async () => {
    const user = userEvent.setup()
    render(Harness)
    const opener = screen.getByTestId('opener')
    await user.click(opener)

    // Named for assistive tech only: the surface renders no heading line.
    const pop = await screen.findByRole('dialog', { name: 'Manage group' })
    expect(pop).toHaveTextContent('Fold')
    await waitFor(() => expect(screen.getByLabelText('Group name')).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('closes')).toHaveTextContent('1')
    // Back to the thing the popover was about, not to <body>.
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('traps Tab inside, and closes on a click outside', async () => {
    const user = userEvent.setup()
    render(Harness)
    await user.click(screen.getByTestId('opener'))
    await waitFor(() => expect(screen.getByLabelText('Group name')).toHaveFocus())

    await user.tab()
    expect(screen.getByRole('button', { name: 'Fold' })).toHaveFocus()
    await user.tab()
    expect(screen.getByLabelText('Group name')).toHaveFocus()

    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('closes')).toHaveTextContent('1')
  })

  it('focuses the first control inside by default, not the anchor stub', async () => {
    // Melt hands a popover's `openFocus` the TRIGGER, not the content: the
    // default has to resolve against the surface itself or focus lands on the
    // zero-size, `aria-hidden` element the popover hangs off.
    const user = userEvent.setup()
    render(Harness, { openFocus: null })
    await user.click(screen.getByTestId('opener'))
    await screen.findByRole('dialog', { name: 'Manage group' })
    await waitFor(() => expect(screen.getByLabelText('Group name')).toHaveFocus())
  })

  it('opens without an anchor rather than not at all', async () => {
    const user = userEvent.setup()
    render(Harness, { anchored: false })
    await user.click(screen.getByTestId('opener'))
    // A group whose chip is off screen still has a popover to manage it.
    expect(await screen.findByRole('dialog', { name: 'Manage group' })).toBeInTheDocument()
  })
})
