// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/MenuHarness.svelte'

afterEach(cleanup)

describe('DropdownMenu', () => {
  it('is a keyboard menu: arrows move, Enter picks, focus returns to the trigger', async () => {
    const user = userEvent.setup()
    render(Harness)
    const trigger = screen.getByTestId('trigger')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    // Named by its trigger, as a menu button is.
    const menu = await screen.findByRole('menu', { name: 'Vault' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Alpha',
      'Beta',
      'Blocked Not on this vault',
    ])
    await waitFor(() => expect(items[0]).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('picked')).toHaveTextContent('beta')
    await waitFor(() => expect(menu).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('renders a disabled item with its reason, and Escape closes', async () => {
    const user = userEvent.setup()
    render(Harness)
    await user.click(screen.getByTestId('trigger'))
    await screen.findByRole('menu')

    const blocked = screen.getByRole('menuitem', { name: /Blocked/ })
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(blocked).toHaveTextContent('Not on this vault')
    await user.click(blocked)
    expect(screen.getByTestId('picked')).toHaveTextContent('')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})
