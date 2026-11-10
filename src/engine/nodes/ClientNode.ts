// Client: traffic generator. Constant/ramp/burst/spike/wave patterns, Poisson
// arrivals, read/write ratio, uniform/Zipf/hot-key distributions. Owns request
// finalization: every request gets exactly ONE fate (invariant).

import { BaseNode } from './BaseNode'
import type { Request, RequestFate } from '../core/types'
import type { SimContext } from '../core/context'

export type TrafficPattern = 'constant' | 'ramp' | 'burst' | 'spike' | 'wave'
export type KeyDistribution = 'uniform' | 'zipf' | 'hotkey'

export interface ClientConfig {
  label: string
  instanceId: string
  queueSize: number
  rps: number
  pattern: TrafficPattern
  /** 0..1 fraction of writes. */
  writeRatio: number
  keyDistribution: KeyDistribution
  keyspace: number
  payloadBytes: number
  /** Per-attempt timeout ms. */
  timeoutMs: number
  maxRetries: number
  retryDelayMs: number
  /** Exponential backoff with jitter when true. */
  backoff: boolean
  rampSec: number
  burstFactor: number
  burstPeriodMs: number
  burstDurationMs: number
  spikeAtMs: number
  spikeFactor: number
  spikeDurationMs: number
}

export class ClientNode extends BaseNode<ClientConfig> {
  private seq = 0
  private inFlight = new Map<number, Request>()
  private deadlines: Request[] = []
  private deadlineHead = 0
  private nextSendAt = 0
  /**
   * Pre-generated arrival times (strictly increasing — Poisson gaps > 0).
   * Arrivals fire from the run loop WITHOUT going through the event heap:
   * the run loop merges this sorted list with heap events.
   */
  private arrivalTimes: number[] = []
  private arrivalHead = 0

  sent = 0
  /** Client-side CPU cost of building a request (runs on the client machine). */

  constructor(id: string, config: ClientConfig, ctx: SimContext) {
    super(id, 'client', config, ctx)
    this.nextSendAt = ctx.now()
  }

  handle(_req: Request, onResult: (res: import('../core/context').SendResult) => void): void {
    // Clients do not receive requests.
    onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
  }

  /** Current target rps at virtual time tMs. */
  rpsAt(tMs: number): number {
    const t = tMs / 1000
    const base = this.config.rps
    switch (this.config.pattern) {
      case 'constant': return base
      case 'ramp': return base * Math.min(1, 0.1 + (0.9 * t) / Math.max(1, this.config.rampSec))
      case 'burst': {
        const period = Math.max(this.config.burstDurationMs + 1, this.config.burstPeriodMs)
        const phase = tMs % period
        const inBurst = phase < this.config.burstDurationMs
        return inBurst ? base * this.config.burstFactor : base
      }
      case 'spike': {
        const { spikeAtMs, spikeDurationMs, spikeFactor } = this.config
        if (tMs >= spikeAtMs && tMs < spikeAtMs + spikeDurationMs) return base * spikeFactor
        return base
      }
      case 'wave': return base * (0.6 + 0.4 * Math.sin((2 * Math.PI * t) / 300))
    }
  }

  /** Schedule request arrivals (Poisson) until `horizonMs` of virtual time. */
  pump(horizonMs: number): void {
    const now = this.ctx.now()
    if (this.nextSendAt < now) this.nextSendAt = now
    let guard = 0
    while (this.nextSendAt < horizonMs && guard < 200_000) {
      guard++
      const rps = this.rpsAt(this.nextSendAt)
      if (rps <= 0) {
        this.nextSendAt += 100
        continue
      }
      const sendAt = this.nextSendAt
      this.nextSendAt = sendAt + this.ctx.rng.exp(1000 / rps)
      this.arrivalTimes.push(sendAt)
    }
  }

  /** Next unfired arrival time, or undefined (part of the run-loop merge). */
  nextArrivalAt(): number | undefined {
    return this.arrivalTimes[this.arrivalHead]
  }

  /** Fire the next arrival (only the run loop calls this, in time order). */
  fireNextArrival(): void {
    const at = this.arrivalTimes[this.arrivalHead]
    if (at === undefined) return
    this.arrivalHead++
    this.emitOne(at)
    // Compact consumed prefix occasionally (slice is O(n)).
    if (this.arrivalHead > 4_096) {
      this.arrivalTimes = this.arrivalTimes.slice(this.arrivalHead)
      this.arrivalHead = 0
    }
  }

  private emitOne(atMs: number): void {
    const cfg = this.config
    const op = this.ctx.rng.chance(cfg.writeRatio) ? 'write' : 'read'
    const req: Request = {
      id: this.seq++,
      op,
      key: this.drawKey(),
      payloadBytes: cfg.payloadBytes,
      sentAt: atMs,
      deadlineAt: atMs + cfg.timeoutMs,
      attempts: 0,
      retried: false,
      path: [this.id],
    }
    this.sent++
    this.counters.in++ // generated requests = this node's inbound rate
    this.inFlight.set(req.id, req)
    this.deadlines.push(req)
    this.ctx.metrics.setInFlight(this.inFlight.size)
    this.launch(req)
  }

  /**
   * Deadline sweep (per window instead of one timer per request — same
   * invariant guarantee, a fraction of the events). Sends are chronological
   * and timeoutMs is constant, so `deadlines` stays sorted.
   */
  tick(_dtSec: number): void {
    const now = this.ctx.now()
    while (this.deadlineHead < this.deadlines.length) {
      const d = this.deadlines[this.deadlineHead]!
      if (d.deadlineAt > now) break
      this.deadlineHead++
      this.finalize(d, 'timeout', now - d.sentAt)
    }
    // Compact consumed prefix occasionally (shift() would be O(n) per pop).
    if (this.deadlineHead > 10_000) {
      this.deadlines = this.deadlines.slice(this.deadlineHead)
      this.deadlineHead = 0
    }
  }

  private drawKey(): string {
    const n = Math.max(1, this.config.keyspace)
    switch (this.config.keyDistribution) {
      case 'uniform': return `k:${this.ctx.rng.int(0, n - 1)}`
      case 'zipf': return `k:${this.ctx.rng.zipfIndex(n)}`
      case 'hotkey': return 'k:hot'
    }
  }

  private launch(req: Request): void {
    if (req.done === true) return
    const targets = this.ctx.targets(this.id)
    if (targets.length === 0) {
      // Nothing connected: lost with no buffer in front of it.
      this.finalize(req, 'dropped_no_buffer')
      return
    }
    const target = targets[req.id % targets.length]!
    const myAttempt = ++req.attempts
    req.path.push(target)
    this.ctx.send(this.id, target, req, (res) => {
      // Only the LATEST attempt may act: a late response from an abandoned
      // attempt must not trigger another retry (it is left to time out).
      if (req.done === true || req.attempts !== myAttempt) return
      if (res.ok) {
        this.finalize(req, myAttempt > 1 ? 'retried_ok' : 'served', this.ctx.now() - req.sentAt)
        return
      }
      const fate = res.fate ?? 'dropped_node_down'
      const retryBudget = myAttempt <= this.config.maxRetries
      const timeLeft = this.ctx.now() < req.deadlineAt
      if (retryBudget && timeLeft && fate !== 'throttled') {
        this.scheduleRetry(req)
      } else {
        this.finalize(req, fate, this.ctx.now() - req.sentAt)
      }
    })
  }

  private scheduleRetry(req: Request): void {
    req.retried = true
    let delay = this.config.retryDelayMs
    if (this.config.backoff) {
      delay = this.config.retryDelayMs * Math.pow(2, req.attempts - 1)
      delay *= 0.5 + this.ctx.rng.next() // jitter
    }
    const at = Math.min(this.ctx.now() + delay, req.deadlineAt)
    this.ctx.schedule(at, () => {
      if (req.done !== true) this.launch(req)
    })
  }

  private finalize(req: Request, fate: RequestFate, latencyMs = 0): void {
    if (req.done === true) return
    req.done = true
    this.inFlight.delete(req.id)
    this.ctx.metrics.setInFlight(this.inFlight.size)
    const finalFate =
      (fate === 'served' || fate === 'retried_ok') && latencyMs > this.ctx.latencyTargetMs
        ? 'served_slow'
        : fate
    this.ctx.metrics.recordFate(finalFate)
    if (finalFate === 'served' || finalFate === 'retried_ok' || finalFate === 'served_slow') {
      this.ctx.metrics.recordLatency(latencyMs)
    }
    this.ctx.resolve(req, finalFate, latencyMs)
  }
}
