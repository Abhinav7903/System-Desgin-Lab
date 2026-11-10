// Abstract base for every simulated component. Each node owns one or more
// Machines (instances), a bounded request queue, and implements handle().
// Adding a node type must never require changing the simulator core.

import type { Machine } from '../machine/machine'
import type { NodeCounters, NodeKind, NodePhase, Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface BaseNodeConfig {
  label: string
  instanceId: string
  /** Bounded queue depth (backpressure). */
  queueSize: number
}

export abstract class BaseNode<C extends BaseNodeConfig = BaseNodeConfig> {
  readonly id: string
  readonly kind: NodeKind
  config: C
  protected ctx: SimContext
  machines: Machine[] = []

  // Runtime stats.
  counters: NodeCounters = { in: 0, ok: 0, rejected: 0, timeout: 0, dropped: 0, throttled: 0, errors: 0 }
  queue: Request[] = []
  /** Set by the simulator after construction. */
  onSnapshot?: () => void

  constructor(id: string, kind: NodeKind, config: C, ctx: SimContext) {
    this.id = id
    this.kind = kind
    this.config = config
    this.ctx = ctx
  }

  get label(): string {
    return this.config.label
  }

  get phase(): NodePhase {
    // Aggregate: down if ALL machines down; degraded if any degraded/down; else healthy.
    if (this.machines.length === 0) return 'healthy'
    const anyUp = this.machines.some((m) => m.phase === 'healthy' || m.phase === 'recovering')
    const anyDown = this.machines.some((m) => m.phase === 'down' || m.phase === 'booting')
    if (!anyUp) return 'down'
    if (anyDown) return 'degraded'
    return 'healthy'
  }

  get queueFill(): number {
    return this.queueDepth() / Math.max(1, this.config.queueSize)
  }

  /** How many requests are waiting (or in-flight) at this node. */
  queueDepth(): number {
    return this.queue.length
  }

  /** How many machines are currently serving. */
  get healthyMachines(): Machine[] {
    return this.machines.filter((m) => m.accepting)
  }

  /** Redraw hook for the UI snapshot pump. */
  markDirty(): void {
    this.onSnapshot?.()
  }

  /**
   * Process one incoming request and ALWAYS call onResult exactly once:
   * either after doing the work, or immediately with a rejection fate.
   * Nodes that forward downstream pass their own continuation.
   */
  abstract handle(req: Request, onResult: (res: SendResult) => void): void

  /** Traffic generators override this to schedule arrivals. */
  pump?(_horizonMs: number): void {}

  /**
   * Per-window tick (called every metrics window): deadline sweeps,
   * autoscaling decisions, leak ticks. Cheaper than per-request timers.
   */
  tick?(_dtSec: number): void {}

  /** Called when a machine on this node was killed/restarted. */
  onMachineChanged(): void {
    this.markDirty()
  }

  /** Called when the node's config changes (e.g., instanceId, instances, etc.). */
  onConfigChange(_key: string, _oldValue: unknown, _newValue: unknown): void {
    // Override in subclasses to handle config changes (e.g., rebuild machines)
  }

  addRequest(req: Request): boolean {
    this.counters.in++
    if (this.queue.length >= this.config.queueSize) {
      this.counters.rejected++
      return false
    }
    this.queue.push(req)
    return true
  }

  nextRequest(): Request | undefined {
    return this.queue.shift()
  }
}
