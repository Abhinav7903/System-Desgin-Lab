// API server: N instances (Machines), bounded queue, thread pool, cache-aside
// logic — try Redis with a short timeout; on miss/failure fall back to
// Postgres; on DB success refill the cache if Redis is up. Circuit breaker
// per downstream. Autoscaling with warm-up delay.

import { BaseNode } from './BaseNode'
import { Machine } from '../machine/machine'
import { CircuitBreaker } from '../mechanisms/circuitBreaker'
import { DEFAULT_COSTS } from '../machine/benchmarks'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface ApiServerConfig {
  label: string
  instanceId: string
  queueSize: number
  instances: number
  threadsPerInstance: number
  cpuMsPerRequest: number
  timeoutMs: number
  downstreamTimeoutMs: number
  circuitBreaker: boolean
  cbThreshold: number
  cbCooldownMs: number
  useCache: boolean
  autoscale: boolean
  autoscaleMin: number
  autoscaleMax: number
  autoscaleDelayMs: number
}

interface Pending {
  req: Request
  onResult: (res: SendResult) => void
}

export class ApiServerNode extends BaseNode<ApiServerConfig> {
  private rr = 0
  /** FIFO of requests waiting for a machine thread (head-pointer deque). */
  private ready: Pending[] = []
  private readyHead = 0
  /** Queued + executing requests (the queue the user sees). */
  private active = 0
  /** Single-flight guard for the saturated-machine redispatch timer. */
  private retryScheduled = false
  private breakers = new Map<string, CircuitBreaker>()
  private scaleUpAt: number | null = null
  /** Cost vectors are shared (read-only downstream) — one per payload size. */
  private costCache = new Map<number, ResourceCost>()

  constructor(id: string, config: ApiServerConfig, ctx: SimContext) {
    super(id, 'api', config, ctx)
    this.rebuildMachines()
  }

  private rebuildMachines(): void {
    for (const m of this.machines) m.destroy()
    this.machines = []
    for (let i = 0; i < this.config.instances; i++) {
      const m = new Machine(`${this.id}#${i}`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'thread-pool',
        threads: this.config.threadsPerInstance,
        label: `${this.label}#${i}`,
      })
      m.onPhaseChange = () => this.onMachineChanged()
      this.machines.push(m)
    }
    this.markDirty()
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'instances' || key === 'threadsPerInstance') {
      this.rebuildMachines()
    }
  }

  /** Autoscaling: append ONE cold-booting instance (boot + warm-up). */
  private addColdInstance(): void {
    const i = this.machines.length
    const m = new Machine(`${this.id}#${i}`, this.ctx, this.ctx.rng, {
      instanceId: this.config.instanceId,
      runtime: 'thread-pool',
      threads: this.config.threadsPerInstance,
      label: `${this.label}#${i}`,
      coldBoot: true,
    })
    m.onPhaseChange = () => this.onMachineChanged()
    this.machines.push(m)
    this.markDirty()
  }

  private breakerFor(downId: string): CircuitBreaker {
    let b = this.breakers.get(downId)
    if (b === undefined) {
      b = new CircuitBreaker(this.config.cbThreshold, this.config.cbCooldownMs, () => this.ctx.now())
      b.onTransition = (from, to, at) =>
        this.ctx.log.emit(at, this.id, 'circuit_breaker', `breaker ${from} -> ${to}`, to === 'open' ? 'warn' : 'info')
      this.breakers.set(downId, b)
    }
    return b
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++
    if (this.active >= this.config.queueSize) {
      this.counters.rejected++
      onResult({ ok: false, fate: 'rejected_queue_full', serviceMs: 0 })
      return
    }
    this.active++
    this.ready.push({ req, onResult })
    this.tryDispatch()
    this.markDirty()
  }

  /** Visible queue depth: waiting + executing requests. */
  queueDepth(): number {
    return this.active
  }

  private costFor(payloadBytes: number): ResourceCost {
    let c = this.costCache.get(payloadBytes)
    if (c === undefined) {
      c = { ...DEFAULT_COSTS.apiHandler, cpuMs: this.config.cpuMsPerRequest, netBytesIn: payloadBytes }
      this.costCache.set(payloadBytes, c)
    }
    return c
  }

  /** Pick the next accepting machine round-robin (no array allocation). */
  private nextMachine(): Machine | undefined {
    const n = this.machines.length
    if (n === 0) return undefined
    for (let t = 0; t < n; t++) {
      const m = this.machines[(this.rr + t) % n]!
      if (m.accepting) {
        this.rr = (this.rr + t + 1) % n
        return m
      }
    }
    return undefined
  }

  private tryDispatch(): void {
    if (this.readyHead >= this.ready.length) return
    const m = this.nextMachine()
    if (m === undefined) return
    const p = this.ready[this.readyHead]!
    const settled = this.executeOn(m, p)
    if (settled === 'busy') {
      // Machine queue full: put the request back and retry shortly.
      this.readyHead--
      this.scheduleBusyRetry()
      return
    }
    for (;;) {
      if (this.readyHead >= this.ready.length) break
      const next = this.nextMachine()
      if (next === undefined) break
      const q = this.ready[this.readyHead]!
      if (this.executeOn(next, q) === 'busy') {
        this.readyHead--
        this.scheduleBusyRetry()
        break
      }
    }
    this.compactReady()
  }

  /**
   * Single-flight redispatch: exactly ONE pending retry at a time. Without
   * the guard, every handle() while saturated spawns its own self-perpetuating
   * retry chain — 9000 new chains/s at 200 loops/s each is an event-rate
   * explosion (observed 1.5M events/virtual-second).
   */
  private scheduleBusyRetry(): void {
    if (this.retryScheduled) return
    this.retryScheduled = true
    this.ctx.schedule(this.ctx.now() + 5, () => {
      this.retryScheduled = false
      this.tryDispatch()
    })
  }

  /** Dispatch one pending request onto a machine. 'busy' means it stayed queued. */
  private executeOn(m: Machine, p: Pending): 'busy' | 'down' | 'ok' {
    this.readyHead++
    let sync: 'busy' | 'down' | 'ok' | null = null
    m.execute(this.costFor(p.req.payloadBytes), (res) => {
      if (res.ok) {
        this.active--
        this.downstream(p.req, p.onResult)
        this.tryDispatch()
        return
      }
      if (res.err === 'busy') {
        sync = 'busy'
        return
      }
      sync = 'down'
      this.active--
      this.counters.errors++
      p.onResult({
        ok: false,
        fate: res.err === 'down' ? 'dropped_node_down' : 'dropped_no_buffer',
        serviceMs: 0,
      })
    })
    if (sync === 'busy') return 'busy'
    if (sync === 'down') return 'down'
    return 'ok'
  }

  private compactReady(): void {
    if (this.readyHead > 512) {
      this.ready = this.ready.slice(this.readyHead)
      this.readyHead = 0
    }
  }

  /** Cache-aside: Redis (short timeout) -> Postgres -> refill cache. */
  private downstream(req: Request, onResult: (res: SendResult) => void): void {
    const redisTargets = this.ctx.targets(this.id, 'redis')
    const pgTargets = this.ctx.targets(this.id, 'postgres')

    const toPg = (then?: () => void): void => {
      if (pgTargets.length === 0) {
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_no_buffer', serviceMs: 0 })
        return
      }
      this.sendWithTimeout(pgTargets, req, this.config.timeoutMs, (res) => {
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: 0 })
          then?.()
        } else {
          this.counters.errors++
          onResult({ ok: false, fate: res.fate, serviceMs: 0 })
        }
      })
    }

    const refill = (): void => {
      if (redisTargets.length === 0) return
      const set: Request = { ...req, op: 'write' } // cache SET
      const target = redisTargets[req.id % redisTargets.length]!
      const br = this.breakerFor(target)
      if (this.config.circuitBreaker && !br.allow()) return
      this.ctx.send(this.id, target, set, () => undefined) // fire and forget
    }

    if (req.op === 'read' && this.config.useCache && redisTargets.length > 0) {
      const target = redisTargets[req.id % redisTargets.length]!
      const br = this.breakerFor(target)
      if (this.config.circuitBreaker && !br.allow()) {
        toPg(refill) // fail fast straight to the DB
        return
      }
      this.sendWithTimeout(redisTargets, req, this.config.downstreamTimeoutMs, (res) => {
        if (this.config.circuitBreaker) {
          if (res.ok) br.recordSuccess()
          else br.recordFailure()
        }
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: 0 })
          return
        }
        // Miss, timeout, or Redis down: fall through to the DB (stampede).
        toPg(refill)
      })
      return
    }
    toPg()
  }

  /** Send to a target with a timeout fallback; exactly one settlement. */
  private sendWithTimeout(
    targets: string[],
    req: Request,
    timeoutMs: number,
    onResult: (res: SendResult) => void,
  ): void {
    let settled = false
    const finish = (res: SendResult): void => {
      if (settled) return
      settled = true
      onResult(res)
    }
    const target = targets[req.id % targets.length]!
    this.ctx.send(this.id, target, req, finish)
    // Timeout via the timing wheel (cheaper than a timer per call).
    this.ctx.timeoutAt(this.ctx.now() + timeoutMs, () =>
      finish({ ok: false, fate: 'timeout', serviceMs: timeoutMs }),
    )
  }

  /** Per-window tick: consider autoscaling. */
  tick(dtSec: number): void {
    this.tickAutoscale()
    void dtSec
  }

  /** A machine booted/died/restarted: hand queued requests to the new state. */
  onMachineChanged(): void {
    super.onMachineChanged()
    this.tryDispatch()
  }

  /** Autoscale: add machines after a delay when the queue stays full. */
  tickAutoscale(): void {
    if (!this.config.autoscale) return
    const now = this.ctx.now()
    const over = this.queueDepth() > this.config.queueSize * 0.7
    if (over && this.config.instances < this.config.autoscaleMax) {
      if (this.scaleUpAt === null) this.scaleUpAt = now + this.config.autoscaleDelayMs
      else if (now >= this.scaleUpAt) {
        this.scaleUpAt = null
        this.config.instances++
        this.addColdInstance()
        this.ctx.log.emit(now, this.id, 'autoscale', `${this.label} scaled to ${this.config.instances} instances (booting)`)
      }
    } else if (!over) {
      this.scaleUpAt = null
    }
  }
}
