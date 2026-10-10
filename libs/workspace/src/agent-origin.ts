/**
 * The in-app agent as a second writer on the live doc (writing-harness
 * shaping B3/B7, Spike S14): its transactions carry an `AgentOrigin` OBJECT
 * as the Yjs transaction origin, and that one fact gives three things:
 *
 *  1. **Attribution.** `MountSession.noteDocChange` sees the origin and logs
 *     `doc.changed` with `actor: { kind: 'agent', name }` — the app IS the
 *     writer, so no journal correlation is needed (events.ts › ActorKind).
 *  2. **The human's Ctrl+Z ignores it.** The binding's `Y.UndoManager`
 *     tracks only its own origins (`null` and y-codemirror's sync config),
 *     and an object it was never given is not one of them (S14 Q1).
 *  3. **"Undo the agent's edit" is scoped.** One `Y.UndoManager` per run
 *     per doc, `trackedOrigins: new Set([origin])`, captures exactly that
 *     run's transactions; undoing it removes the agent's items and only
 *     those, even after a human typed inside them (S14 Q2).
 *
 * `Y.UndoManager` matches origins by IDENTITY, so a run needs ONE origin
 * object however many times its record is read back out of a Y.Map (where it
 * is plain JSON): `AgentRuns.origin` hands out that canonical object.
 *
 * Engine-coupled (it holds `Y.UndoManager`s) — the same sanctioned exception
 * as `anchors.ts`. No time, no timers (golden rule 5): `captureTimeout` is
 * irrelevant here because an undo takes the whole run.
 */
import * as Y from 'yjs'

/**
 * Who wrote: the transaction origin of every agent write. The seam's one
 * home — `@ohhi/harness` re-exports it (libs/harness/src/types.ts).
 */
export interface AgentOrigin {
  kind: 'agent'
  runId: string
  sessionId: string
  /** The skill's name, or the agent's — what the log and the readout say. */
  name: string
  threadId?: string
}

/** Is this transaction origin the agent's? Structural, so a record's JSON origin answers too. */
export function isAgentOrigin(origin: unknown): origin is AgentOrigin {
  if (!origin || typeof origin !== 'object') return false
  const o = origin as Partial<AgentOrigin>
  return o.kind === 'agent' && typeof o.runId === 'string' && typeof o.name === 'string'
}

/**
 * The runs this mount has seen: the canonical origin per run, and each run's
 * undo managers (one per doc it touched). Owned by a `MountSession`.
 */
export class AgentRuns {
  private readonly origins = new Map<string, AgentOrigin>()
  private readonly managers = new Map<string, Map<Y.Text, Y.UndoManager>>()
  /** Runs in the order they last wrote, newest last. */
  private order: string[] = []

  /**
   * The ONE origin object for `o.runId` — what every transaction of that run
   * must carry, so its undo manager recognises it. Frozen: it is shared.
   */
  origin(o: AgentOrigin): AgentOrigin {
    const known = this.origins.get(o.runId)
    if (known) return known
    const canonical: AgentOrigin = Object.freeze({
      kind: 'agent',
      runId: o.runId,
      sessionId: o.sessionId,
      name: o.name,
      ...(o.threadId !== undefined ? { threadId: o.threadId } : {}),
    }) as AgentOrigin
    this.origins.set(o.runId, canonical)
    return canonical
  }

  /**
   * Make sure the run's undo manager over `ytext` exists — call it BEFORE the
   * run's first transaction on that text, or that transaction is not
   * captured — and note the run as the newest writer.
   */
  track(o: AgentOrigin, ytext: Y.Text): AgentOrigin {
    const origin = this.origin(o)
    let byText = this.managers.get(origin.runId)
    if (!byText) {
      byText = new Map()
      this.managers.set(origin.runId, byText)
    }
    if (!byText.has(ytext)) {
      byText.set(ytext, new Y.UndoManager(ytext, { trackedOrigins: new Set<unknown>([origin]), captureTimeout: 0 }))
    }
    this.order = [...this.order.filter((id) => id !== origin.runId), origin.runId]
    return origin
  }

  /**
   * Undo everything run `runId` wrote, in every doc it touched. False when
   * the run wrote nothing this session (or was already undone).
   */
  undo(runId: string): boolean {
    const byText = this.managers.get(runId)
    if (!byText) return false
    let any = false
    for (const um of byText.values()) {
      while (um.undoStack.length > 0) {
        um.undo()
        any = true
      }
    }
    if (any) this.order = this.order.filter((id) => id !== runId)
    return any
  }

  /** The newest undo step run `runId` holds over `ytext` (an opaque handle), or null. */
  lastStep(runId: string, ytext: Y.Text): unknown {
    const um = this.managers.get(runId)?.get(ytext)
    return um && um.undoStack.length > 0 ? um.undoStack[um.undoStack.length - 1] : null
  }

  /**
   * Forget one undo step (a handle from `lastStep`) without undoing it: the
   * change it recorded was taken back another way, and undoing it later
   * would redo what a peer already did.
   */
  dropStep(runId: string, ytext: Y.Text, step: unknown): void {
    const um = this.managers.get(runId)?.get(ytext)
    if (!um || step === null) return
    const i = um.undoStack.indexOf(step as (typeof um.undoStack)[number])
    if (i !== -1) um.undoStack.splice(i, 1)
  }

  /** The run that wrote most recently and has something left to undo, or null. */
  lastRun(): string | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const id = this.order[i]!
      for (const um of this.managers.get(id)?.values() ?? []) if (um.undoStack.length > 0) return id
    }
    return null
  }

  /** Drop the managers bound to `ytext` (its doc is being destroyed). */
  forgetText(ytext: Y.Text): void {
    for (const byText of this.managers.values()) {
      byText.get(ytext)?.destroy()
      byText.delete(ytext)
    }
  }

  destroy(): void {
    for (const byText of this.managers.values()) for (const um of byText.values()) um.destroy()
    this.managers.clear()
    this.origins.clear()
    this.order = []
  }
}
