// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResizeHandle from './ResizeHandle.svelte'

afterEach(cleanup)

describe('ResizeHandle', () => {
  it('is a valued separator the keyboard can drive, and commits after each gesture', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(ResizeHandle, {
      value: 288,
      min: 192,
      max: 640,
      step: 16,
      label: 'Resize file navigator',
      onChange,
      onCommit,
    })
    const handle = screen.getByRole('separator', { name: 'Resize file navigator' })
    expect(handle).toHaveAttribute('aria-valuenow', '288')

    await user.tab()
    expect(handle).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(304)
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(192)
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith(640)
    expect(onCommit).toHaveBeenCalledTimes(3)
  })
})
