// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/DialogHarness.svelte'

afterEach(cleanup)

describe('Dialog', () => {
  it('is named and described, focuses its first control, and gives focus back on Escape', async () => {
    const user = userEvent.setup()
    render(Harness)
    const opener = screen.getByTestId('opener')
    await user.click(opener)

    const dialog = await screen.findByRole('dialog', { name: 'Rename note' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Pick a new name.')
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('closes')).toHaveTextContent('1')
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(Harness)
    await user.click(screen.getByTestId('opener'))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())

    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Rename' })).toHaveFocus()
    await user.tab()
    // Wrapped, not escaped to the opener behind the scrim.
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('closes on a click outside when dismissable', async () => {
    const user = userEvent.setup()
    render(Harness)
    await user.click(screen.getByTestId('opener'))
    await screen.findByRole('dialog')

    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ignores a click outside when told to (confirms, holds)', async () => {
    const user = userEvent.setup()
    render(Harness, { closeOnOutsideClick: false })
    await user.click(screen.getByTestId('opener'))
    await screen.findByRole('dialog')

    await user.click(document.body)
    // Nothing to wait for: assert it is still there after the event settles.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('closes')).toHaveTextContent('0')
  })

  it('ignores Escape when told to (the divergence review)', async () => {
    const user = userEvent.setup()
    render(Harness, { closeOnEscape: false })
    await user.click(screen.getByTestId('opener'))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
