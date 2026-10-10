// @vitest-environment jsdom
/**
 * The empty tab's launcher (shell-polish P5). What it has to get right is the
 * shape, not the matching: two verbs you can reach without knowing a hotkey, a
 * list that stays FOLDED until asked, and the same keyboard as the palette
 * once you type. The matcher itself is the index's, tested there.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@ohhi/i18n'
import EmptyTab, { type PickerRow } from './EmptyTab.svelte'

const t = getLL().web.tabs.picker
const TESTID = 'empty-tab:p1'
const PATHS = ['notes/welcome.md', 'notes/ideas.md', 'archive/old.md']

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

/** The shell's quick-open, in miniature: substring hits with their span. */
async function fakeSearch(query: string): Promise<PickerRow[]> {
  if (!query) return []
  return PATHS.filter((p) => p.includes(query)).map((p) => ({
    path: p,
    spans: [{ from: p.indexOf(query), to: p.indexOf(query) + query.length }],
  }))
}

function show(recent: string[] = ['notes/welcome.md', 'notes/ideas.md']) {
  const onPick = vi.fn()
  const onNew = vi.fn()
  const onOpenQuick = vi.fn()
  render(EmptyTab, {
    search: fakeSearch,
    recent: () => recent,
    onPick,
    onNew,
    onOpenQuick,
    bindings: { newNote: 'Ctrl+N', openQuick: 'Ctrl+O' },
    testid: TESTID,
  })
  return { onPick, onNew, onOpenQuick, input: screen.getByTestId(`${TESTID}-input`) }
}

const rows = (): HTMLElement[] => screen.queryAllByTestId(`${TESTID}-row`)

describe('EmptyTab', () => {
  it('starts folded: Recent is a disclosure, not a wall of notes', async () => {
    const user = userEvent.setup()
    show()

    const recent = screen.getByTestId(`${TESTID}-recent`)
    expect(recent).toHaveAttribute('aria-expanded', 'false')
    expect(rows()).toHaveLength(0)

    await user.click(recent)
    expect(recent).toHaveAttribute('aria-expanded', 'true')
    expect(rows()).toHaveLength(2)
    // Basename first, folder after it — the row's whole point.
    expect(rows()[0]).toHaveTextContent('welcome.md')
    expect(rows()[0]).toHaveTextContent('notes')
  })

  it('says so when there is nothing recent yet, rather than showing an empty box', async () => {
    const user = userEvent.setup()
    show([])
    await user.click(screen.getByTestId(`${TESTID}-recent`))
    expect(screen.getByText(t.recent_empty())).toBeInTheDocument()
  })

  it('swaps Recent for Results while typing, and back when the query is cleared', async () => {
    const user = userEvent.setup()
    const { input } = show()

    await user.type(input, 'ideas')
    expect(await screen.findByText(t.results())).toBeInTheDocument()
    // The disclosure is gone: one list is on screen at a time.
    expect(screen.queryByTestId(`${TESTID}-recent`)).toBeNull()
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('ideas.md')
    // The hit is marked, the way the palette marks its own.
    expect(rows()[0].querySelector('mark')?.textContent).toBe('ideas')

    await user.clear(input)
    expect(await screen.findByTestId(`${TESTID}-recent`)).toHaveAttribute('aria-expanded', 'false')
  })

  it('tells the user there is no match instead of leaving the box blank', async () => {
    const user = userEvent.setup()
    const { input } = show()
    await user.type(input, 'zzz')
    expect(await screen.findByText(t.empty())).toBeInTheDocument()
  })

  it('runs its two verbs and shows the keys that do the same thing', async () => {
    const user = userEvent.setup()
    const { onNew, onOpenQuick } = show()

    await user.click(screen.getByTestId(`${TESTID}-new`))
    expect(onNew).toHaveBeenCalledTimes(1)
    await user.click(screen.getByTestId(`${TESTID}-open`))
    expect(onOpenQuick).toHaveBeenCalledTimes(1)

    expect(screen.getByTestId(`${TESTID}-new`)).toHaveTextContent(t.new_note())
    expect(screen.getByTestId(`${TESTID}-new`)).toHaveTextContent('Ctrl+N')
    expect(screen.getByTestId(`${TESTID}-open`)).toHaveTextContent('Ctrl+O')
  })

  it('picks with the arrows and Enter, from the field', async () => {
    const user = userEvent.setup()
    const { onPick, input } = show()

    await user.type(input, 'notes')
    expect(await screen.findByText(t.results())).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toHaveAttribute('aria-current', 'true')

    await user.keyboard('{ArrowDown}')
    expect(rows()[1]).toHaveAttribute('aria-current', 'true')
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('notes/ideas.md')
  })

  it('picks from the unfolded Recent list with the same keys', async () => {
    const user = userEvent.setup()
    const { onPick, input } = show()

    await user.click(screen.getByTestId(`${TESTID}-recent`))
    input.focus()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith('notes/welcome.md')
  })
})

describe('EmptyTab — the doors to Settings (settings-shaping ST6)', () => {
  const base = { search: fakeSearch, recent: () => [], onPick: vi.fn(), onNew: vi.fn(), onOpenQuick: vi.fn(), testid: TESTID }

  it('Customise the app and Connect an agent run the host’s actions', async () => {
    const user = userEvent.setup()
    const onCustomise = vi.fn()
    const onAgents = vi.fn()
    render(EmptyTab, { ...base, onCustomise, onAgents })
    const list = screen.getByRole('list', { name: t.more() })
    expect(list).toHaveTextContent(t.customise())
    expect(list).toHaveTextContent(t.customise_hint())
    await user.click(screen.getByTestId(`${TESTID}-customise`))
    expect(onCustomise).toHaveBeenCalledOnce()
    await user.click(screen.getByTestId(`${TESTID}-agents`))
    expect(onAgents).toHaveBeenCalledOnce()
  })

  it('a door the host does not hand in is not drawn (the browser has no agent door)', () => {
    render(EmptyTab, { ...base, onCustomise: vi.fn() })
    expect(screen.getByTestId(`${TESTID}-customise`)).toBeTruthy()
    expect(screen.queryByTestId(`${TESTID}-agents`)).toBeNull()
    cleanup()
    render(EmptyTab, base)
    expect(screen.queryByRole('list', { name: t.more() })).toBeNull()
  })
})
