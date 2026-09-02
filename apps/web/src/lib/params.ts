import { presenceColor, PRESENCE_SLOTS } from '@editor/ui/tokens'

/**
 * URL-param modes — the contract Playwright L2 drives:
 *   ?mode=memory&role=seed&relay=ws://localhost:PORT&room=FOLDERGUID&token=TOK&user=Alice
 *   ?mode=memory&role=join&...
 * No params → landing screen.
 */

export interface MemoryModeConfig {
  mode: 'memory'
  role: 'seed' | 'join'
  relay: string
  room: string
  token: string
  user: string
}

export type AppConfig =
  | { kind: 'landing' }
  | { kind: 'error'; message: string }
  | ({ kind: 'memory' } & MemoryModeConfig)

export function parseAppConfig(params: URLSearchParams): AppConfig {
  const mode = params.get('mode')
  if (mode === null) return { kind: 'landing' }
  if (mode !== 'memory') {
    return { kind: 'error', message: `unsupported mode "${mode}" (V1 dev shell supports mode=memory)` }
  }
  const role = params.get('role') ?? 'seed'
  if (role !== 'seed' && role !== 'join') {
    return { kind: 'error', message: `role must be "seed" or "join", got "${role}"` }
  }
  const relay = params.get('relay')
  const room = params.get('room')
  if (!relay || !room) {
    return { kind: 'error', message: 'mode=memory requires relay=ws://… and room=FOLDERGUID params' }
  }
  return {
    kind: 'memory',
    mode: 'memory',
    role,
    relay,
    room,
    token: params.get('token') ?? '',
    user: params.get('user') ?? 'Anonymous',
  }
}

/**
 * Stable per-name presence slot (0..PRESENCE_SLOTS-1). The COLOUR for a slot
 * is a theme token, not a constant: a palette tuned for a white page vibrates
 * on #2e3440, and one of the old hardcoded values sat close enough to the
 * diverged red to be mistakable for a conflict marker.
 */
export function colorSlot(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % PRESENCE_SLOTS
}

/**
 * Stable per-name cursor/presence colour, read from the ACTIVE theme.
 *
 * NOTE (V2): y-codemirror.next writes this as an inline style from the
 * awareness `user.color` field, so a peer already on screen keeps the colour
 * their own client published. Making every viewer resolve peers against their
 * own theme means sending a slot index rather than a hex — an awareness
 * WIRE-FORMAT change that needs a version-tolerant reader, sequenced with the
 * y-codemirror.next vendoring already flagged as TODO(V2) in binding.ts.
 */
export function colorFor(name: string): string {
  return presenceColor(colorSlot(name))
}
