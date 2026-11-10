// Context passed to every node: routing, scheduling, rng, metrics, logging.
// Nodes talk to each other ONLY through ctx.send — never direct references.

import type { Request, RequestFate, NodeKind, FailureAction } from '../core/types'
import type { EventLog } from '../analysis/eventLog'
import type { MetricsCollector } from '../metrics/collector'
import type { Rng } from './rng'

export interface SendResult {
  ok: boolean
  fate?: RequestFate
  /** Elapsed ms at the receiving node (service time). */
  serviceMs: number
}

export interface SimContext {
  now(): number
  rng: Rng
  metrics: MetricsCollector
  log: EventLog
  /** Schedule a callback at virtual time (the engine's ONLY timer mechanism). */
  schedule(atMs: number, run: () => void): void
  /** Schedule a timeout (timing wheel, ~25 ms granularity, fires once). */
  timeoutAt(atMs: number, run: () => void): void
  /** Send a request from one node to a specific downstream node. */
  send(fromId: string, toId: string, req: Request, onResult: (res: SendResult) => void): void
  /** Downstream node ids reachable from `fromId` (edges), optionally filtered by kind. */
  targets(fromId: string, kind?: NodeKind): string[]
  /** All node ids of a kind (for LB style discovery). */
  nodesOfKind(kind: NodeKind): string[]
  /** Finalize a request at its origin client. */
  resolve(req: Request, fate: RequestFate, latencyMs: number): void
  /** Apply a failure action (also used by the injector). */
  applyFailure(action: FailureAction): void
  /** Global latency target used for served_slow. */
  latencyTargetMs: number
}

export function sendResultOk(serviceMs: number): SendResult {
  return { ok: true, serviceMs }
}
