/**
 * Shared test fixtures for the readouts and views over the event log
 * (duplication review #27): one `AppEvent` builder in place of the copies
 * the Log view, log-view and Drawer tests each kept, and a recording
 * `ViewShell` a component test injects with `viewShellContext(shell)` —
 * the one verb surface every readout and view opens things through.
 */
import { MemoryIndex } from '@ohhi/index'
import type { AppEvent, EventLevel } from '@ohhi/workspace'
import { vi } from 'vitest'
import type { ViewShell } from './views.js'

/** A logged notice (`mount_error`, text `msg <id>`) — the shape most log tests need. */
export function notice(
  id: string,
  at: number,
  level: EventLevel = 'warn',
  scope: AppEvent['scope'] = {},
  count = 1
): AppEvent {
  return {
    id,
    at,
    level,
    kind: 'notice',
    scope,
    actor: { kind: 'app' },
    count,
    payload: { code: 'mount_error', params: { message: `msg ${id}` } },
  }
}

let seq = 0
/** Any event: the kind and time given, the rest an app-made, unscoped info row unless overridden. */
export function event(p: Partial<AppEvent> & Pick<AppEvent, 'kind' | 'at'>): AppEvent {
  return { id: `r:${++seq}`, level: 'info', scope: {}, actor: { kind: 'app' }, count: 1, payload: {}, ...p } as AppEvent
}

/** A recording `ViewShell`: every verb a `vi.fn()`, the clock pinned at `now`. */
export function fakeViewShell(now = 0, over: Partial<ViewShell> = {}): ViewShell {
  const index = new MemoryIndex()
  return {
    index: () => index,
    indexRevision: () => 0,
    clock: { now: () => now, schedule: () => () => {} },
    openPath: vi.fn(),
    openView: vi.fn(),
    runCommand: vi.fn(),
    commandKeys: () => '',
    revealSuggestion: vi.fn(async () => true),
    createFromLink: vi.fn(),
    renameNote: vi.fn(async (path: string) => path),
    pin: vi.fn(),
    openSettings: vi.fn(),
    shareFolder: vi.fn(),
    addSharedFolder: vi.fn(),
    linkDevice: vi.fn(),
    revealFolder: vi.fn(),
    relayUrl: () => '',
    secret: () => '',
    relayKnown: () => false,
    revision: () => 0,
    inSyncByRoom: () => ({}),
    membership: { isMember: () => false, watch: () => () => {}, invalidate: () => {}, renamed: () => {} },
    ...over,
  }
}
