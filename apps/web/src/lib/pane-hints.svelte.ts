/**
 * The pane mode's key hints (E6): `subtle` · `full` · `off`, a device
 * setting (`config.paneHints`). One reactive value for the window — the
 * corner cue, the full bar and Settings › Layout all read it, so a change in
 * Settings applies to the panes beside it at once.
 */
import { paneHints as readPaneHints, setPaneHints, type PaneHints } from './config.js'

let value = $state<PaneHints>(readPaneHints())

export const paneHints = {
  get value(): PaneHints {
    return value
  },
  set(next: PaneHints): void {
    value = next
    setPaneHints(next)
  },
  /** Re-read config (another window, a test). */
  reload(): void {
    value = readPaneHints()
  },
}
