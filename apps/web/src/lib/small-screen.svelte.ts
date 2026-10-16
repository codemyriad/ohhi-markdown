/**
 * The shell's ONE small-screen breakpoint (QA round 1, 2026-10-15): a
 * window narrower than Tailwind's `sm` (40rem, 640 px at the default font
 * size) is a phone, and the shell behaves like one there:
 *
 * - the format bar never folds into its *Format* menu — it scrolls, filling
 *   the row — and the word count shrinks to a number chip at its right end
 *   (`FormatBar`, `CornerStatus`, `EditorArea`);
 * - a tap or focus in a note closes the navigator drawer and the floating
 *   dock panel (`EditorArea`, `ShellLayout.collapseOverlays`);
 * - a device pin is kept but not honoured — each side is the drawer or dock
 *   it would be unpinned, and the pin control says pins apply on wider
 *   screens (`ShellLayout.setSmallScreen`).
 *
 * (A tap on a wikilink placing the caret instead of opening the note is
 * decided by the POINTER, not by this width: `libs/editor-lang`
 * `preview/link-tap.ts`.)
 *
 * The viewport, not a container: this is about the device in the hand, and
 * a split pane on a desktop keeps its desktop behaviour.
 */

/** The breakpoint, in rem: Tailwind's `sm`, so `max-sm:` in markup says the same thing. */
export const SMALL_SCREEN_REM = 40
/** Below the breakpoint — `max-width` rather than range syntax, so every engine the app ships in reads it. */
export const SMALL_SCREEN_QUERY = `(max-width: ${SMALL_SCREEN_REM - 0.01}rem)`

function query(): MediaQueryList | null {
  try {
    return typeof matchMedia === 'function' ? matchMedia(SMALL_SCREEN_QUERY) : null
  } catch {
    return null
  }
}

const list = query()
let small = $state(list?.matches ?? false)
list?.addEventListener?.('change', (e) => (small = e.matches))

/** Whether the window is below the small-screen breakpoint now (reactive). */
export const screen = {
  get small(): boolean {
    return small
  },
}

/** Tests only: pretend the window is (or is not) small. */
export function setSmallScreenForTest(on: boolean): void {
  small = on
}
