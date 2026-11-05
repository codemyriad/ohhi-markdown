// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Toaster from './Toaster.svelte'
import { toast, toaster } from './toaster.js'

afterEach(() => {
  for (const t of [...toasterList()]) toaster.helpers.removeToast(t.id)
  cleanup()
})

function toasterList(): { id: string }[] {
  let list: { id: string }[] = []
  toaster.states.toasts.subscribe((v) => (list = v))()
  return list
}

describe('Toaster', () => {
  it.each(['error', 'warn', 'info'] as const)(
    'a %s notice sits on the opaque surface, never a translucent tint',
    async (level) => {
      render(Toaster)
      toast({ level, title: 'Something to say' })
      const box = await screen.findByTestId('toast')
      expect(box).toHaveAttribute('data-level', level)
      const classes = box.className.split(/\s+/)
      expect(classes).toContain('bg-base-100')
      // No fill utility with an alpha (`bg-error/10`): that is what read as see-through.
      expect(classes.filter((c) => c.startsWith('bg-') && c.includes('/'))).toEqual([])
    },
  )

  it('the tone is carried by the border', async () => {
    render(Toaster)
    toast({ level: 'error', title: 'It failed' })
    const box = await screen.findByTestId('toast')
    expect(box.className.split(/\s+/)).toContain('border-error')
  })
})
