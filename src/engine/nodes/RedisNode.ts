// Redis: single-threaded event loop (one slow op stalls ALL others), TTL,
// LRU eviction, max memory, max connections. GET on read, SET on write.

import { BaseNode } from './BaseNode'
import { Machine } from '../machine/machine'
import { DEFAULT_COSTS } from '../machine/benchmarks'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface RedisConfig {
  label: string
  instanceId: string
  queueSize: number
  instances: number
  maxMemoryMb: number
  ttlMs: number
  eviction: 'lru' | 'noeviction'
  maxConnections: number
  replicas: number
}

interface Entry {
  expiresAtMs: number
  lastAccess: number
}

export class RedisNode extends BaseNode<RedisConfig> {
  private store = new Map<string, Entry>()
  private rr = 0
  hits = 0
  misses = 0
  evictions = 0
  memoryUsedKb = 0
  private bytesPerKey = 1 // 1 KB per cached value (approx)

  constructor(id: string, config: RedisConfig, ctx: SimContext) {
    super(id, 'redis', config, ctx)
    this.rebuildMachines()
  }

  private rebuildMachines(): void {
    for (const m of this.machines) m.destroy()
    this.machines = []
    // Primary instances
    for (let i = 0; i < this.config.instances; i++) {
      const m = new Machine(`${this.id}#${i}`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'event-loop', // single thread!
        threads: 1,
        queueCap: this.config.queueSize,
        label: `${this.label}#${i}`,
      })
      m.onPhaseChange = () => this.onMachineChanged()
      this.machines.push(m)
    }
    // Replicas
    for (let i = 0; i < this.config.replicas; i++) {
      const m = new Machine(`${this.id}#replica-${i}`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'event-loop',
        threads: 1,
        queueCap: this.config.queueSize,
        label: `${this.label}#replica-${i}`,
      })
      m.onPhaseChange = () => this.onMachineChanged()
      this.machines.push(m)
    }
    this.markDirty()
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'instances' || key === 'replicas') {
      this.rebuildMachines()
    }
  }

  get hitRatio(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++
    const healthy = this.machines.filter((m) => m.accepting)
    if (healthy.length === 0) {
      this.counters.dropped++
      onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
      return
    }
    const m = healthy[this.rr++ % healthy.length]!
    const cost = DEFAULT_COSTS.redisGet
    m.execute(cost, (res) => {
      if (!res.ok) {
        if (res.err === 'busy') {
          this.counters.rejected++
          onResult({ ok: false, fate: 'rejected_queue_full', serviceMs: 0 })
        } else {
          this.counters.errors++
          this.counters.dropped++
          onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        }
        return
      }
      const now = this.ctx.now()
      if (req.op === 'read') {
        const e = this.store.get(req.key)
        if (e !== undefined && e.expiresAtMs > now) {
          e.lastAccess = now
          this.hits++
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          if (e !== undefined) this.store.delete(req.key)
          this.misses++
          onResult({ ok: false, fate: 'stale_read', serviceMs: res.elapsedMs })
        }
      } else {
        this.setKey(req.key, now)
        this.counters.ok++
        onResult({ ok: true, serviceMs: res.elapsedMs })
      }
    })
  }

  private setKey(key: string, now: number): void {
    const maxKb = this.config.maxMemoryMb * 1024
    // Evict LRU until the new key fits.
    while (this.memoryUsedKb + this.bytesPerKey > maxKb && this.store.size > 0) {
      let oldest: string | null = null
      let oldestAt = Infinity
      for (const [k, e] of this.store) {
        if (e.lastAccess < oldestAt) {
          oldestAt = e.lastAccess
          oldest = k
        }
      }
      if (oldest === null) break
      this.store.delete(oldest)
      this.memoryUsedKb -= this.bytesPerKey
      this.evictions++
      if (this.config.eviction === 'noeviction') break
    }
    const existing = this.store.get(key)
    if (existing === undefined) this.memoryUsedKb += this.bytesPerKey
    this.store.set(key, { expiresAtMs: now + this.config.ttlMs, lastAccess: now })
    this.memoryUsedKb += this.bytesPerKey
  }
}