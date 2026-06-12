/**
 * Injected clock/scheduler. All Editor-owned sync/reconciler code takes a
 * Clock instead of calling setTimeout/Date.now directly (golden rule 5 —
 * deterministic simulation is the foundation of the harness).
 */
export interface Clock {
  now(): number
  /** Schedule `fn` after `ms`. Returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void
}

export class RealClock implements Clock {
  now(): number {
    return Date.now()
  }
  schedule(fn: () => void, ms: number): () => void {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  }
}

interface SimTask {
  at: number
  seq: number
  fn: () => void
  cancelled: boolean
}

/** Deterministic clock: time only moves when the test advances it. */
export class SimClock implements Clock {
  private time = 0
  private seq = 0
  private tasks: SimTask[] = []

  now(): number {
    return this.time
  }

  schedule(fn: () => void, ms: number): () => void {
    const task: SimTask = { at: this.time + ms, seq: this.seq++, fn, cancelled: false }
    this.tasks.push(task)
    return () => {
      task.cancelled = true
    }
  }

  /** Advance time, running due tasks in (time, insertion) order. */
  advance(ms: number): void {
    const target = this.time + ms
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (!due) break
      this.tasks = this.tasks.filter((t) => t !== due)
      this.time = due.at
      due.fn()
    }
    this.time = target
  }

  /** Run everything that is scheduled, however far in the future. */
  flush(): void {
    while (this.tasks.some((t) => !t.cancelled)) {
      const horizon = Math.max(...this.tasks.filter((t) => !t.cancelled).map((t) => t.at))
      this.advance(horizon - this.time)
    }
  }

  pendingCount(): number {
    return this.tasks.filter((t) => !t.cancelled).length
  }
}
