// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/ListboxHarness.svelte'

afterEach(cleanup)

describe('Listbox', () => {
  it('is a listbox the field drives: the active option is selected and named by aria-activedescendant', async () => {
    const user = userEvent.setup()
    render(Harness)
    const field = screen.getByRole('combobox', { name: 'Field' })
    const list = screen.getByRole('listbox', { name: 'Suggestions' })
    const options = screen.getAllByRole('option')
    expect(list).toHaveAttribute('id', 'lb')
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(field).toHaveAttribute('aria-activedescendant', options[0].id)

    await user.click(field)
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(field).toHaveAttribute('aria-activedescendant', options[1].id)
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('picked')).toHaveTextContent('beta')
  })

  it('a pointer pick keeps the focus in the field', async () => {
    const user = userEvent.setup()
    render(Harness)
    const field = screen.getByRole('combobox', { name: 'Field' })
    await user.click(field)
    await user.click(screen.getByTestId('opt:gamma'))
    expect(screen.getByTestId('picked')).toHaveTextContent('gamma')
    expect(field).toHaveFocus()
  })

  it('says so when nothing matches', () => {
    render(Harness, { items: [] })
    const [only] = screen.getAllByRole('option')
    expect(only).toHaveTextContent('No matches')
    expect(only).toHaveAttribute('aria-disabled', 'true')
  })
})
