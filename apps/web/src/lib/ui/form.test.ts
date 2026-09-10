// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/FormHarness.svelte'

afterEach(cleanup)

describe('form field pattern', () => {
  it('stays quiet until touched, then wires the error into the control', async () => {
    const user = userEvent.setup()
    render(Harness)
    const input = screen.getByLabelText(/Share link/)
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).not.toHaveAttribute('aria-invalid')
    // Description is described-by from the start; errors only once shown.
    expect(input).toHaveAccessibleDescription('Starts with editor1:')

    await user.click(input)
    await user.tab()
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(input).toHaveAccessibleDescription('Starts with editor1: Paste a link first.')

    await user.type(input, 'editor1:abc')
    await waitFor(() => expect(input).not.toHaveAttribute('aria-invalid'))
    expect(screen.queryByText('Paste a link first.')).toBeNull()
  })

  it('submit validates everything, then hands the parsed value over', async () => {
    const user = userEvent.setup()
    render(Harness)
    await user.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() =>
      expect(screen.getByLabelText(/Share link/)).toHaveAttribute('aria-invalid', 'true')
    )
    expect(screen.getByTestId('submitted')).toHaveTextContent('')

    await user.type(screen.getByLabelText(/Share link/), '  editor1:xyz  ')
    await user.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(screen.getByTestId('submitted')).toHaveTextContent('editor1:xyz'))
  })
})
