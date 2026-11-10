// NIC model: bandwidth cap, packet loss, base latency per peer. When the link
// saturates, packets queue then drop — latency rises even with idle CPU.
// All randomness goes through the seeded RNG.

import type { SimScheduler } from './scheduler'
import type { Rng } from '../core/rng'

export class Nic {
  readonly bandwidthMbps: number
  private readonly scheduler: SimScheduler
  private readonly rng: Rng
  /** 0..1 chance a packet is lost (injected). */
  packetLoss = 0
  /** Bits currently waiting on the wire. */
  private backlogBits = 0
  private busyUntil = 0
  /** Throttle override in Mbps (0 = no throttle). */
  throttledMbps = 0
  /** Dropped because the link was saturated (big payload, small pipe). */
  droppedBySaturation = 0

  constructor(scheduler: SimScheduler, rng: Rng, bandwidthMbps: number) {
    this.scheduler = scheduler
    this.rng = rng
    this.bandwidthMbps = Math.max(1, bandwidthMbps)
  }

  get effectiveMbps(): number {
    return this.throttledMbps > 0 ? Math.min(this.throttledMbps, this.bandwidthMbps) : this.bandwidthMbps
  }

  get queueDepth(): number {
    return this.backlogBits > 0 ? 1 : 0
  }

  /** True when the link has nothing queued or in flight. */
  get idle(): boolean {
    return this.backlogBits === 0 && this.busyUntil <= this.scheduler.now()
  }

  /** True when the link still has queued work (used for utilization display). */
  get busy(): boolean {
    return this.busyUntil > this.scheduler.now() || this.backlogBits > 0
  }

  /**
   * Fast path: reserve the wire for `bytes` starting at startAtMs without
   * scheduling events. Returns the absolute completion time.
   */
  reserve(startAtMs: number, bytes: number): number {
    const now = this.scheduler.now()
    const transferMs = (bytes * 8) / (this.effectiveMbps * 1_000_000) * 1000
    const start = Math.max(this.busyUntil, startAtMs, now)
    this.busyUntil = start + transferMs
    return this.busyUntil
  }

  /** Small-packet fast path used when transfers are folded into CPU time. */
  reserveSmall(bytes: number): number {
    return this.reserve(this.scheduler.now(), bytes)
  }

  /**
   * Send `bytes` over the wire after `baseLatencyMs` of propagation.
   * The link serializes transfers; when the backlog exceeds `queueBits`, the
   * packet is DROPPED (real-world congestion loss), not queued forever.
   */
  send(bytes: number, baseLatencyMs: number, onDelivered: (lost: boolean, reason: 'loss' | 'congestion') => void): void {
    if (this.packetLoss > 0 && this.rng.chance(this.packetLoss)) {
      onDelivered(true, 'loss')
      return
    }
    const now = this.scheduler.now()
    const bits = bytes * 8
    const queueLimitBits = this.effectiveMbps * 1_000_000 * 0.05 // ~50 ms of buffering
    if (this.backlogBits + bits > queueLimitBits) {
      this.droppedBySaturation++
      onDelivered(true, 'congestion')
      return
    }
    const transferMs = (bits / (this.effectiveMbps * 1_000_000)) * 1000
    const start = Math.max(this.busyUntil, now)
    this.busyUntil = start + transferMs
    this.backlogBits += bits
    const arriveAt = this.busyUntil + baseLatencyMs
    this.scheduler.schedule(arriveAt, () => {
      this.backlogBits = Math.max(0, this.backlogBits - bits)
      onDelivered(false, 'loss')
    })
  }
}
