/**
 * The one way a host's data reaches a view: subscribe to the host, and on
 * each change dispatch `effect.of(host.current())` a microtask later.
 *
 * Never synchronously. A host's change signal often fires from inside a Yjs
 * observer or update handler — which can itself run inside an editor
 * transaction (the collab binding applies a local edit, the doc updates, the
 * host hears it) — and CM6 refuses a dispatch during an update. Pushes in
 * one tick coalesce into one dispatch of the newest value.
 */
import type { Extension, StateEffectType } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'

/** Where the data comes from: read at each push, re-pushed on `subscribe`'s signal. */
export interface PushSource<T> {
  current(): T
  /** Called whenever the data may have changed; returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}

/**
 * A view plugin pushing `source` into the view as `effect`. `initial`: push
 * once when the view is created (for a field that does not read the host
 * itself in `create`).
 */
export function hostPush<T>(
  source: PushSource<T> | ((view: EditorView) => PushSource<T> | null),
  effect: StateEffectType<T>,
  opts: { initial?: boolean } = {}
): Extension {
  return ViewPlugin.define((view) => {
    const host = typeof source === 'function' ? source(view) : source
    let dead = false
    let queued = false
    const push = (): void => {
      if (queued || dead || !host) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (dead) return
        view.dispatch({ effects: effect.of(host.current()) })
      })
    }
    const off = host?.subscribe(push) ?? (() => {})
    if (opts.initial) push()
    return {
      destroy() {
        dead = true
        off()
      },
    }
  })
}
