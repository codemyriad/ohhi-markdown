import { describe, expect, it, vi } from 'vitest'
import { guideHref, openGuide, type GuideOpeners } from './guide.js'

function openers(desktop: boolean) {
  return {
    desktop: () => desktop,
    openTab: vi.fn<GuideOpeners['openTab']>(),
    openWindow: vi.fn<GuideOpeners['openWindow']>(async () => {}),
  }
}

describe('openGuide', () => {
  it('opens a new tab in a browser', async () => {
    const o = openers(false)
    await openGuide('start', { openers: o })
    expect(o.openTab).toHaveBeenCalledWith('/guide/start.html')
    expect(o.openWindow).not.toHaveBeenCalled()
  })

  it('opens one window per page on the desktop, on the bundled copy', async () => {
    const o = openers(true)
    await openGuide('recovery', { openers: o })
    expect(o.openWindow).toHaveBeenCalledWith('guide-recovery', guideHref('recovery'), 'Oh hi markdown guide')
    expect(o.openTab).not.toHaveBeenCalled()
  })

  it('reads the team host’s copy when asked (the update toast’s What changed)', async () => {
    const o = openers(true)
    await openGuide('changes', { host: 'ohhi.example.ts.net', openers: o })
    expect(o.openWindow.mock.calls[0]![1]).toBe('https://ohhi.example.ts.net/guide/changes.html')
  })

  it('a window that cannot open is logged, not thrown', async () => {
    const o = openers(true)
    o.openWindow.mockRejectedValueOnce(new Error('not allowed'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await expect(openGuide('start', { openers: o })).resolves.toBeUndefined()
    expect(info).toHaveBeenCalled()
    info.mockRestore()
  })
})
