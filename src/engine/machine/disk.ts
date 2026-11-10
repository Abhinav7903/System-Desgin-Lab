// Disk model: IOPS cap, throughput cap, per-op latency, fsync cost for durable
// writes, and a fillable disk. Ops serialize FIFO at device speed; latency
// rises from the IO queue, not from a formula.

import type { SimScheduler } from './scheduler'

interface DiskOp {
  isWrite: boolean
  fsyncs: number
  bytes: number
  onComplete: (err: 'ok' | 'disk_full') => void
}

export class Disk {
  readonly iopsCap: number
  readonly throughputMbps: number
  readonly baseLatencyMs: number
  readonly fsyncMs: number
  private readonly scheduler: SimScheduler
  private queue: DiskOp[] = []
  private busyUntilMs = 0
  private busyAccumMs = 0
  private windowStartMs = 0
  private windowUtil = 0
  usedGb = 0
  totalGb: number

  constructor(
    scheduler: SimScheduler,
    iopsCap: number,
    throughputMbps: number,
    baseLatencyMs = 0.15,
    fsyncMs = 1.2,
    totalGb = 50,
  ) {
    this.scheduler = scheduler
    this.iopsCap = Math.max(10, iopsCap)
    this.throughputMbps = Math.max(1, throughputMbps)
    this.baseLatencyMs = baseLatencyMs
    this.fsyncMs = fsyncMs
    this.totalGb = totalGb
  }

  get queueDepth(): number {
    return this.queue.length
  }

  /** True when the device is fully idle (fast-path eligible). */
  get idle(): boolean {
    return this.queue.length === 0 && this.busyUntilMs <= this.scheduler.now()
  }

  /** Rolling utilization (0..1) over the last ~500 ms of virtual time. */
  get utilization(): number {
    this.rollWindow()
    return Math.min(1, this.windowUtil)
  }

  get full(): boolean {
    return this.usedGb >= this.totalGb
  }

  /**
   * Fast path: reserve the device for this op starting at startAtMs without
   * scheduling events. Returns the absolute completion time.
   */
  reserve(startAtMs: number, cost: { diskReads: number; diskWrites: number; fsync: number }): number {
    const now = this.scheduler.now()
    const ops = Math.max(0, cost.diskReads + cost.diskWrites)
    if (ops + cost.fsync === 0) return startAtMs
    const bytes = cost.diskReads * 8 * 1024 + cost.diskWrites * 16 * 1024
    const perOpMs = Math.max(this.baseLatencyMs, 1000 / this.iopsCap)
    const bytesMs = (bytes * 8) / (this.throughputMbps * 1_000_000) * 1000
    const service =
      cost.fsync > 0 ? cost.fsync * this.fsyncMs + perOpMs : perOpMs + bytesMs
    const start = Math.max(this.busyUntilMs, startAtMs, now)
    this.busyUntilMs = start + service
    this.busyAccumMs += service
    return this.busyUntilMs
  }

  /**
   * Submit a batch: `reads`+`writes` logical ops (reads ~8 KB, writes ~16 KB)
   * plus `fsyncs` durable-write flushes. Calls onComplete when it finishes.
   */
  submit(reads: number, writes: number, fsyncs: number, onComplete: (err: 'ok' | 'disk_full') => void): void {
    const ops = Math.max(0, reads + writes)
    if (ops + fsyncs === 0) {
      onComplete('ok')
      return
    }
    if (writes + fsyncs > 0 && this.full) {
      onComplete('disk_full')
      return
    }
    const bytes = reads * 8 * 1024 + writes * 16 * 1024
    this.queue.push({ isWrite: writes > 0, fsyncs, bytes, onComplete })
    if (this.queue.length === 1) this.pump()
  }

  private pump(): void {
    const op = this.queue[0]
    if (op === undefined) return
    const now = this.scheduler.now()
    if (this.busyUntilMs < now) this.busyUntilMs = now
    const perOpMs = Math.max(this.baseLatencyMs, 1000 / this.iopsCap)
    const bytesMs = (op.bytes * 8) / (this.throughputMbps * 1_000_000) * 1000
    const service = op.fsyncs > 0 ? op.fsyncs * this.fsyncMs + perOpMs : perOpMs + bytesMs
    const start = this.busyUntilMs
    this.busyUntilMs = start + service
    this.busyAccumMs += service
    this.queue.shift()
    const finishAt = this.busyUntilMs
    this.scheduler.schedule(finishAt, () => {
      if (op.isWrite) this.usedGb += op.bytes / 1024 / 1024 / 1024
      op.onComplete('ok')
      this.pump()
    })
  }

  private rollWindow(): void {
    const now = this.scheduler.now()
    const windowMs = 500
    if (now - this.windowStartMs >= windowMs) {
      const elapsed = Math.max(1, now - this.windowStartMs)
      this.windowUtil = this.busyAccumMs / elapsed
      this.busyAccumMs = Math.max(0, this.busyAccumMs - elapsed)
      this.windowStartMs = now
    }
  }
}
