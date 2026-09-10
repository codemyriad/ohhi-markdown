// @vitest-environment jsdom
import { FilePlus } from '@lucide/svelte'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import IconButton from './IconButton.svelte'

afterEach(cleanup)

describe('IconButton', () => {
  it('has an accessible name and shows its label on keyboard focus, not only hover', async () => {
    const user = userEvent.setup()
    render(IconButton, { label: 'New note', icon: FilePlus })
    const button = screen.getByRole('button', { name: 'New note' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    await user.tab()
    expect(button).toHaveFocus()
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('New note')
  })

  it('with a visible label, drops the tooltip and keeps the name', () => {
    render(IconButton, { label: 'New note', icon: FilePlus, showLabel: true })
    expect(screen.getByRole('button', { name: 'New note' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
