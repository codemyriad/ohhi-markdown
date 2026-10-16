// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Clock } from '@ohhi/vault'
import BootSplash, { SPLASH_DELAY_MS, SPLASH_ESCAPE_MS } from './BootSplash.svelte'

/** A clock the test advances by hand: `advance(ms)` runs whatever came due. */
function manualClock(): Clock & { advance(ms: number): void } {
  let now = 0
  let timers: { at: number; fn: () => void }[] = []
  return {
    now: () => now,
    schedule(fn, ms) {
      const timer = { at: now + ms, fn }
      timers.push(timer)
      return () => (timers = timers.filter((t) => t !== timer))
    },
    advance(ms) {
      now += ms
      const due = timers.filter((t) => t.at <= now)
      timers = timers.filter((t) => t.at > now)
      due.forEach((t) => t.fn())
      flushSync()
    },
  }
}

afterEach(() => cleanup())

describe('BootSplash', () => {
  it('draws nothing for a fast open, then the app name and one line', () => {
    const clock = manualClock()
    render(BootSplash, { clock, onCancel: () => {} })
    // A fast open never flashes it.
    expect(screen.getByTestId('connecting')).toBeEmptyDOMElement()
    clock.advance(SPLASH_DELAY_MS - 1)
    expect(screen.queryByRole('status')).toBeNull()

    clock.advance(1)
    // The landing site's wordmark: "Oh Hi" on the highlighter, then "markdown" — the name, read whole.
    const wordmark = screen.getByTestId('boot-wordmark')
    expect(wordmark).toHaveTextContent('Oh Hi markdown')
    expect(wordmark.querySelector('.ed-wordmark-hi')).toHaveTextContent('Oh Hi')
    expect(wordmark.querySelector('.ed-wordmark-rest')).toHaveTextContent('markdown')
    expect(wordmark.querySelector('.ed-wordmark-mark')).toHaveTextContent('mark')
    expect(screen.getByRole('status')).toHaveTextContent('Opening your notes…')
    // Never "connecting": the relay is not what an open waits for.
    expect(screen.getByTestId('connecting')).not.toHaveTextContent(/connecting/i)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers the way back to the vault list only when the open is slow', async () => {
    const clock = manualClock()
    const onCancel = vi.fn()
    render(BootSplash, { clock, onCancel })
    clock.advance(SPLASH_ESCAPE_MS - 1)
    expect(screen.queryByRole('button')).toBeNull()
    clock.advance(1)
    await userEvent.click(screen.getByRole('button', { name: 'Back to your vaults' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('without a vault list to go back to, never offers one', () => {
    const clock = manualClock()
    render(BootSplash, { clock })
    clock.advance(SPLASH_ESCAPE_MS)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
