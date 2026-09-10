/**
 * Merge extra attributes onto a Melt element value without losing its
 * `action`. Melt hides `action` from spreads (a Proxy filters it out of
 * `ownKeys`) so `{...$trigger}` only carries attributes; a plain object
 * spread would drop the action and `use:melt` would then have nothing to
 * run. This keeps the same shape: attributes enumerable, `action` reachable.
 */
export function withAttrs<T extends object>(value: T, extra: Record<string, unknown>): T {
  const merged: Record<PropertyKey, unknown> = { ...value, ...extra }
  const action = (value as { action?: unknown }).action
  return new Proxy(merged, {
    get: (target, key) => (key === 'action' ? action : Reflect.get(target, key)),
  }) as T
}
