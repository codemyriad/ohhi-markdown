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

const PALETTE = ['#30bced', '#6eeb83', '#ffbc42', '#ecd444', '#ee6352', '#9ac2c9', '#8acb88', '#1be7ff']

/** Stable per-name cursor/presence colour. */
export function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}
