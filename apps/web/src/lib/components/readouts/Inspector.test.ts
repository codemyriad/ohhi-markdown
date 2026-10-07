// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeViewShell } from '../../readouts.fixture.js'
import { viewShellContext } from '../../views.js'
import Inspector from './Inspector.svelte'

afterEach(cleanup)

describe('the inspector readout', () => {
  it('draws nothing while developer tools are off', () => {
    const shell = fakeViewShell()
    render(Inspector, { props: { ctx: { devtools: () => false } }, context: viewShellContext(shell) })
    expect(screen.queryByRole('button')).toBeNull()
    render(Inspector, { props: { ctx: {} }, context: viewShellContext(shell) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('opens the inspector view when they are on', async () => {
    const shell = fakeViewShell()
    render(Inspector, { props: { ctx: { devtools: () => true } }, context: viewShellContext(shell) })
    const button = screen.getByRole('button', { name: getLL().web.devtools.open() })
    await userEvent.setup().click(button)
    expect(shell.openView).toHaveBeenCalledWith('inspector')
  })
})
