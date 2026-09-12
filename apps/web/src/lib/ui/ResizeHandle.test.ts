// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResizeHandle from './ResizeHandle.svelte'

afterEach(cleanup)

// jsdom has no pointer capture, and the handle takes it on every drag.
Element.prototype.setPointerCapture = (): void => {}
Element.prototype.releasePointerCapture = (): void => {}

/** A pointer event jsdom can build — `PointerEvent` is not one of its globals. */
function pointer(type: string, clientX: number): Event {
  const e = new MouseEvent(type, { bubbles: true, clientX, clientY: 0 })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  return e
}

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

  it('collapses instead of resizing when a drag goes below the threshold, and leaves the width alone', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const onCollapse = vi.fn()
    render(ResizeHandle, {
      value: 288,
      min: 192,
      max: 640,
      label: 'Resize file navigator',
      collapseBelow: 120,
      onCollapse,
      onChange,
      onCommit,
    })
    const handle = screen.getByRole('separator', { name: 'Resize file navigator' })

    // Drag left: a resize while the unclamped width is still above 120…
    handle.dispatchEvent(pointer('pointerdown', 500))
    handle.dispatchEvent(pointer('pointermove', 350))
    expect(onChange).toHaveBeenLastCalledWith(192) // 138 unclamped, floored at min
    expect(onCollapse).not.toHaveBeenCalled()

    // …and a collapse past it, which puts the width back where the drag began.
    handle.dispatchEvent(pointer('pointermove', 320))
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(288)

    // The gesture is over: further moves and the release do nothing at all.
    handle.dispatchEvent(pointer('pointermove', 300))
    handle.dispatchEvent(pointer('pointerup', 300))
    expect(onCollapse).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(288)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('never collapses from the keyboard — Home is "as narrow as it goes", not "hide it"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onCollapse = vi.fn()
    render(ResizeHandle, {
      value: 288,
      min: 192,
      max: 640,
      label: 'Resize file navigator',
      collapseBelow: 120,
      onCollapse,
      onChange,
    })
    await user.tab()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(192)
    expect(onCollapse).not.toHaveBeenCalled()
  })
})
