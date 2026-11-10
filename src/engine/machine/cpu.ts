// CPU model: N cores as parallel servers over a shared run queue.
// When all cores are busy, work waits in the run queue -> latency grows as
// a consequence of queueing, never a formula. Context-switch overhead kicks
// in once active threads exceed cores (oversubscription).

import type { SimScheduler } from './scheduler'

interface CpuWork {
  remainingMs: number
  onComplete: () => void
}

const CONTEXT_SWITCH_MS = 0.05
const OVERSUB_PENALTY_MS = 0.15

export class Cpu {
  readonly cores: number
  private readonly speedFactor: number
  private readonly scheduler: SimScheduler
  private runQueue: CpuWork[] = []
  private busyCores = 0
  /** Bookkeeping for the fast path: reserved until this virtual time. */
  private busyUntilMs = 0
  /** Rolling utilization accounting (both paths). */
  private busyAccumMs = 0
  private windowStartMs = 0
  private windowUtil = 0
  /** External CPU load (noisy neighbor, injected cpu spike): fraction of all cores. */
  externalLoad = 0

  constructor(scheduler: SimScheduler, cores: number, speedFactor = 1) {
    this.scheduler = scheduler
    this.cores = Math.max(1, cores)
    this.speedFactor = Math.max(0.05, speedFactor)
  }

  get queueDepth(): number {
    return this.runQueue.length
  }

  /** True when nothing is running or queued (fast-path eligible). */
  get idle(): boolean {
    return this.runQueue.length === 0 && this.busyCores === 0 && this.busyUntilMs <= this.scheduler.now()
  }

  /** Rolling utilization (0..1) over the last ~500 ms of virtual time. */
  get utilization(): number {
    this.rollWindow()
    const ext = Math.min(1, this.externalLoad)
    return Math.min(1, this.windowUtil * (1 - ext) + ext)
  }

  /** Submit cpuMs of work through the real run queue (staged path). */
  submit(cpuMs: number, onComplete: () => void): void {
    if (cpuMs <= 0) {
      onComplete()
      return
    }
    this.runQueue.push({ remainingMs: cpuMs, onComplete })
    this.pump()
  }

  /** Effective core speed: shared/steal load consumes a fraction of cores. */
  private effSpeed(): number {
    const steal = Math.min(0.999, Math.max(0, this.externalLoad))
    return Math.max(0.001, this.speedFactor * (1 - steal))
  }

  /**
   * Fast path: reserve a core for cpuMs starting at startAtMs without
   * scheduling events. Returns the absolute completion time.
   */
  reserve(startAtMs: number, cpuMs: number): number {
    const now = this.scheduler.now()
    const start = Math.max(this.busyUntilMs, startAtMs, now)
    const service = cpuMs / this.effSpeed() + CONTEXT_SWITCH_MS
    this.busyUntilMs = start + service
    this.busyAccumMs += service
    return this.busyUntilMs
  }

  private pump(): void {
    while (this.runQueue.length > 0 && this.busyCores < this.cores) {
      const work = this.runQueue.shift()!
      this.busyCores++
      const active = this.busyCores + this.runQueue.length
      const oversub = active > this.cores * 2 ? OVERSUB_PENALTY_MS : CONTEXT_SWITCH_MS
      const service = work.remainingMs / this.effSpeed() + oversub
      this.busyUntilMs = Math.max(this.busyUntilMs, this.scheduler.now() + service)
      this.busyAccumMs += service
      this.scheduler.schedule(this.scheduler.now() + service, () => {
        this.busyCores--
        work.onComplete()
        this.pump()
      })
    }
  }

  private rollWindow(): void {
    const now = this.scheduler.now()
    const windowMs = 500
    if (now - this.windowStartMs >= windowMs) {
      const elapsed = Math.max(1, now - this.windowStartMs)
      this.windowUtil = Math.min(1, this.busyAccumMs / elapsed / this.cores)
      this.busyAccumMs = Math.max(0, this.busyAccumMs - elapsed * this.cores)
      this.windowStartMs = now
    }
  }
}
