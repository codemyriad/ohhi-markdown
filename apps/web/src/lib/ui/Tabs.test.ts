// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './test-harness/TabsHarness.svelte'

afterEach(cleanup)

describe('Tabs', () => {
  it('arrow keys move between tabs and switch the panel; the binding follows', async () => {
    const user = userEvent.setup()
    render(Harness)
    const list = screen.getByRole('tablist', { name: 'Settings sections' })
    expect(list).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('general panel')

    await user.tab()
    expect(tabs[0]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('sync panel')
    expect(screen.getByTestId('value')).toHaveTextContent('sync')

    // One tab stop for the list: Tab leaves it for the panel, not the next tab.
    await user.tab()
    expect(screen.getByRole('tabpanel')).toHaveFocus()
  })

  it('collapse: a select holds the same choices, and it and the tabs stay in step (Settings in a narrow pane)', async () => {
    const user = userEvent.setup()
    render(Harness, { orientation: 'vertical', collapse: true })
    // jsdom has no container queries: both are in the DOM; CSS shows one.
    const select = screen.getByTestId('tabs-select') as HTMLSelectElement
    expect(select).toHaveAccessibleName('Settings sections')
    expect([...select.options].map((o) => o.value)).toEqual(['general', 'sync', 'dev'])
    expect(select.value).toBe('general')

    await user.selectOptions(select, 'sync')
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent('sync panel'))
    expect(screen.getByTestId('value')).toHaveTextContent('sync')
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getAllByRole('tab')[2]!)
    await waitFor(() => expect(select.value).toBe('dev'))
  })

  it('draws no select without collapse', () => {
    render(Harness, { orientation: 'vertical' })
    expect(screen.queryByTestId('tabs-select')).toBeNull()
  })
})
