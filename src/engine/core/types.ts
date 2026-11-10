// Core type vocabulary for the simulation engine.
// PURE TypeScript: no React, no DOM, no timers. Everything runs on a virtual clock.

export type NodeKind =
  | 'client'
  | 'loadbalancer'
  | 'api'
  | 'redis'
  | 'postgres'
  | 'mongo'
  | 'kafka'
  | 'queue'
  | 'cdn'
  | 'ratelimiter'

/** Lifecycle of a process/machine, per AGENTS.md. */
export type NodePhase = 'booting' | 'healthy' | 'degraded' | 'down' | 'recovering'

/** Every request ends in exactly ONE fate. Invariant: sent = sum(fates) + in_flight. */
export type RequestFate =
  | 'served'
  | 'served_slow' // served but over the latency target
  | 'rejected_queue_full'
  | 'rejected_pool_exhausted'
  | 'timeout'
  | 'dropped_node_down'
  | 'dropped_no_buffer' // LOST: no queue/Kafka in front of a down/full consumer
  | 'throttled'
  | 'stale_read'
  | 'retried_ok'
  | 'in_flight'

export const FINAL_FATES: readonly RequestFate[] = [
  'served',
  'served_slow',
  'rejected_queue_full',
  'rejected_pool_exhausted',
  'timeout',
  'dropped_node_down',
  'dropped_no_buffer',
  'throttled',
  'stale_read',
  'retried_ok',
] as const

/** Per-operation resource cost vector. Service time = time to acquire these resources. */
export interface ResourceCost {
  cpuMs: number
  memKb: number
  diskReads: number
  diskWrites: number
  fsync: number // durable-write fsyncs
  netBytesIn: number
  netBytesOut: number
}

export const ZERO_COST: Readonly<ResourceCost> = {
  cpuMs: 0,
  memKb: 0,
  diskReads: 0,
  diskWrites: 0,
  fsync: 0,
  netBytesIn: 0,
  netBytesOut: 0,
}

export type OpKind = 'read' | 'write'

/** A single simulated request. Never batched into averages. */
export interface Request {
  id: number
  op: OpKind
  key: string
  payloadBytes: number
  sentAt: number // virtual ms
  deadlineAt: number // virtual ms; client gives up after this
  attempts: number
  retried: boolean
  /** Set when the request has received its single final fate. */
  done?: boolean
  /** Node ids visited, for the causal event log. */
  path: string[]
}

/** A scheduled callback on the virtual timeline. */
export interface SimEvent {
  at: number // virtual ms
  seq: number // tie-breaker: FIFO for equal times
  run: () => void
}

/** Snapshot of one node's observable state, posted to the UI. */
export interface NodeSnapshot {
  id: string
  kind: NodeKind
  label: string
  phase: NodePhase
  /** 0..1 utilization ring. */
  cpuUtil: number
  memUsedMb: number
  memTotalMb: number
  queueDepth: number
  queueCap: number
  inFlight: number
  threadsBusy: number
  threadsTotal: number
  connOpen: number
  connMax: number
  counters: NodeCounters
}

export interface NodeCounters {
  in: number
  ok: number
  rejected: number
  timeout: number
  dropped: number
  throttled: number
  errors: number
}

export interface FateCounts {
  served: number
  servedSlow: number
  rejectedQueueFull: number
  rejectedPoolExhausted: number
  timeout: number
  droppedNodeDown: number
  droppedNoBuffer: number
  throttled: number
  staleRead: number
  retriedOk: number
  inFlight: number
}

export interface GlobalSnapshot {
  at: number // virtual ms
  rps: number
  fates: FateCounts
  p50: number
  p95: number
  p99: number
  latencyTargetMs: number
  errorRate: number
  sloViolated: boolean
}

export type FailureAction =
  | { type: 'kill'; nodeId: string; machineIndex?: number }
  | { type: 'restart'; nodeId: string; machineIndex?: number }
  | { type: 'slow'; nodeId: string; factor: number }
  | { type: 'packetLoss'; nodeId: string; rate: number }
  | { type: 'spike'; clientId: string; factor: number; durationMs: number }
  | { type: 'hotKey'; clientId: string }
  | { type: 'fillDisk'; nodeId: string }
  | { type: 'leakMemory'; nodeId: string; on: boolean }
  | { type: 'cpuSpike'; nodeId: string; factor: number; durationMs: number }
  | { type: 'networkThrottle'; nodeId: string; mbps: number }

export interface TimelineEntry {
  atMs: number
  action: FailureAction
}
