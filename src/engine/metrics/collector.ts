// Metrics: efficient fixed-bucket histograms (no sorting), fate counters,
// per-node and global stats. Snapshots every 100 ms of virtual time.

import type { FateCounts, NodeKind, RequestFate } from '../core/types'

const BUCKET_BOUNDS_MS: readonly number[] = [
  1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 800, 1200, 2000, 3000,
  5000, 8000, 12_000, 20_000, 30_000, 50_000, 100_000,
]

export class LatencyHistogram {
  private buckets: number[] = new Array(BUCKET_BOUNDS_MS.length).fill(0)
  private min = Infinity
  private max = 0
  count = 0

  add(ms: number): void {
    this.count++
    if (ms < this.min) this.min = ms
    if (ms > this.max) this.max = ms
    for (let i = 0; i < BUCKET_BOUNDS_MS.length; i++) {
      if (ms <= BUCKET_BOUNDS_MS[i]!) {
        this.buckets[i]!++
        return
      }
    }
    this.buckets[this.buckets.length - 1]!++
  }

  /** Percentile 0..1 via bucket interpolation. */
  percentile(p: number): number {
    if (this.count === 0) return 0
    const target = p * this.count
    let acc = 0
    for (let i = 0; i < this.buckets.length; i++) {
      const c = this.buckets[i]!
      if (acc + c >= target) {
        const lower = i === 0 ? 0 : BUCKET_BOUNDS_MS[i - 1]!
        const upper = BUCKET_BOUNDS_MS[i]!
        const frac = c > 0 ? (target - acc) / c : 0
        return lower + (upper - lower) * frac
      }
      acc += c
    }
    return this.max
  }

  merge(other: LatencyHistogram): void {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i]! += other.buckets[i]!
    this.count += other.count
    this.min = Math.min(this.min, other.min)
    this.max = Math.max(this.max, other.max)
  }

  reset(): void {
    this.buckets.fill(0)
    this.count = 0
    this.min = Infinity
    this.max = 0
  }
}

export interface NodeMetrics {
  nodeId: string
  kind: NodeKind
  label: string
  served: number
  errors: number
  rejected: number
  latency: LatencyHistogram
  cacheHits: number
  cacheMisses: number
  queueDepth: number
  utilization: number
  connections: number
}

export function emptyFates(): FateCounts {
  return {
    served: 0,
    servedSlow: 0,
    rejectedQueueFull: 0,
    rejectedPoolExhausted: 0,
    timeout: 0,
    droppedNodeDown: 0,
    droppedNoBuffer: 0,
    throttled: 0,
    staleRead: 0,
    retriedOk: 0,
    inFlight: 0,
  }
}

export class MetricsCollector {
  /** Cumulative totals since reset (used by the fate invariant). */
  private readonly fatesTotal = emptyFates()
  /** Current-window counters (reset at each closeWindow). */
  private readonly fatesWindow = emptyFates()
  private readonly globalLatency = new LatencyHistogram()
  private readonly nodeStats = new Map<string, NodeMetrics>()
  /** History of global windows for charts (bounded). */
  readonly history: {
    at: number
    rps: number
    p50: number
    p95: number
    p99: number
    served: number
    errors: number
    fates: FateCounts
  }[] = []

  node(nodeId: string, kind: NodeKind, label: string): NodeMetrics {
    let s = this.nodeStats.get(nodeId)
    if (s === undefined) {
      s = {
        nodeId,
        kind,
        label,
        served: 0,
        errors: 0,
        rejected: 0,
        latency: new LatencyHistogram(),
        cacheHits: 0,
        cacheMisses: 0,
        queueDepth: 0,
        utilization: 0,
        connections: 0,
      }
      this.nodeStats.set(nodeId, s)
    }
    return s
  }

  recordFate(fate: RequestFate): void {
    switch (fate) {
      case 'served': this.fatesWindow.served++; this.fatesTotal.served++; break
      case 'served_slow': this.fatesWindow.servedSlow++; this.fatesTotal.servedSlow++; break
      case 'rejected_queue_full': this.fatesWindow.rejectedQueueFull++; this.fatesTotal.rejectedQueueFull++; break
      case 'rejected_pool_exhausted': this.fatesWindow.rejectedPoolExhausted++; this.fatesTotal.rejectedPoolExhausted++; break
      case 'timeout': this.fatesWindow.timeout++; this.fatesTotal.timeout++; break
      case 'dropped_node_down': this.fatesWindow.droppedNodeDown++; this.fatesTotal.droppedNodeDown++; break
      case 'dropped_no_buffer': this.fatesWindow.droppedNoBuffer++; this.fatesTotal.droppedNoBuffer++; break
      case 'throttled': this.fatesWindow.throttled++; this.fatesTotal.throttled++; break
      case 'stale_read': this.fatesWindow.staleRead++; this.fatesTotal.staleRead++; break
      case 'retried_ok': this.fatesWindow.retriedOk++; this.fatesTotal.retriedOk++; break
      case 'in_flight': break
    }
  }

  setInFlight(n: number): void {
    this.fatesWindow.inFlight = n
    this.fatesTotal.inFlight = n
  }

  /** Completed request end-to-end latency (client view). */
  recordLatency(ms: number): void {
    this.globalLatency.add(ms)
  }

  /** Cumulative fate counts since reset (invariant: sent = total + inFlight). */
  snapshotFates(): FateCounts {
    return { ...this.fatesTotal }
  }

  /** Current-window fate counts (for live UI deltas). */
  windowFates(): FateCounts {
    return { ...this.fatesWindow }
  }

  get p50(): number { return this.globalLatency.percentile(0.5) }
  get p95(): number { return this.globalLatency.percentile(0.95) }
  get p99(): number { return this.globalLatency.percentile(0.99) }

  /** Close a window: compute derived rps/error rate and push history. */
  closeWindow(atMs: number, windowMs: number): void {
    const w = this.fatesWindow
    const sent =
      w.served + w.servedSlow + w.rejectedQueueFull + w.rejectedPoolExhausted + w.timeout +
      w.droppedNodeDown + w.droppedNoBuffer + w.throttled + w.staleRead + w.retriedOk
    const errors =
      w.rejectedQueueFull + w.rejectedPoolExhausted + w.timeout + w.droppedNodeDown + w.droppedNoBuffer
    this.history.push({
      at: atMs,
      rps: (sent * 1000) / Math.max(1, windowMs),
      p50: this.p50,
      p95: this.p95,
      p99: this.p99,
      served: w.served + w.servedSlow + w.retriedOk,
      errors,
      fates: { ...w },
    })
    if (this.history.length > 600) this.history.shift()
    // Reset the window counters; totals stay cumulative.
    const inflight = w.inFlight
    Object.assign(w, emptyFates())
    w.inFlight = inflight
  }

  reset(): void {
    Object.assign(this.fatesTotal, emptyFates())
    Object.assign(this.fatesWindow, emptyFates())
    this.globalLatency.reset()
    this.nodeStats.clear()
    this.history.length = 0
  }
}
