// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import Wordmark from './Wordmark.svelte'

afterEach(cleanup)

const LL = getLL()

describe('Wordmark', () => {
  it('draws "Oh Hi" on the highlighter and "markdown" with "mark" leaning, read whole as the app name', () => {
    render(Wordmark, { testid: 'wm' })
    const mark = screen.getByRole('img', { name: LL.common.app_name() })
    expect(mark).toBe(screen.getByTestId('wm'))
    expect(mark.tagName).toBe('SPAN')
    expect(mark).toHaveTextContent(LL.common.app_name())
    expect(mark.querySelector('.ed-wordmark-hi')).toHaveTextContent(LL.common.wordmark.hi())
    expect(mark.querySelector('.ed-wordmark-rest')).toHaveTextContent('markdown')
    expect(mark.querySelector('em.ed-wordmark-mark')).toHaveTextContent(LL.common.wordmark.mark())
    expect(mark).toHaveClass('text-sm', 'font-semibold')
  })

  it('as a heading it is the heading, named by the app name, at the size asked for', () => {
    render(Wordmark, { as: 'h1', size: 'title' })
    const heading = screen.getByRole('heading', { level: 1, name: LL.common.app_name() })
    expect(heading).not.toHaveAttribute('role')
    expect(heading).toHaveClass('text-3xl')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
