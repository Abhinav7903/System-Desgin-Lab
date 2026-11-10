// Timestamped causal event log: node state changes, circuit breaker trips,
// pool exhaustion, queue overflow, failover, OOM, backlog full...

import type { NodePhase } from '../core/types'

export type EventSeverity = 'info' | 'warn' | 'error' | 'fatal'

export interface SimLogEvent {
  atMs: number
  nodeId: string
  kind: string
  msg: string
  severity: EventSeverity
}

export class EventLog {
  private events: SimLogEvent[] = []
  private listeners: ((e: SimLogEvent) => void)[] = []
  /** Ring buffer: keep the most recent 4000 events. */
  private cap = 4000

  emit(atMs: number, nodeId: string, kind: string, msg: string, severity: EventSeverity = 'info'): void {
    const e: SimLogEvent = { atMs, nodeId, kind, msg, severity }
    this.events.push(e)
    if (this.events.length > this.cap) this.events.splice(0, this.events.length - this.cap)
    for (const l of this.listeners) l(e)
  }

  nodePhase(atMs: number, nodeId: string, label: string, from: NodePhase, to: NodePhase): void {
    const sev: EventSeverity = to === 'down' ? 'fatal' : to === 'degraded' ? 'warn' : 'info'
    this.emit(atMs, nodeId, 'phase', `${label}: ${from} -> ${to}`, sev)
  }

  all(): readonly SimLogEvent[] {
    return this.events
  }

  since(atMs: number): SimLogEvent[] {
    return this.events.filter((e) => e.atMs >= atMs)
  }

  reset(): void {
    this.events = []
  }
}
