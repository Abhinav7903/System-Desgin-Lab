// CDN node: edge cache with hit/miss, TTL, edge locations.
// Models geographic edge caching with origin fallback.

import { BaseNode } from './BaseNode'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface CdnConfig {
  label: string
  instanceId: string
  edgeLocations: number
  cacheSizeGb: number
  defaultTtlMs: number
  originLatencyMs: number
  queueSize: number
}

interface CacheEntry {
  key: string
  data: string
  expiresAt: number
  sizeBytes: number
}

export class CdnNode extends BaseNode<CdnConfig> {
  private cache = new Map<string, CacheEntry>()
  private totalSize = 0
  private hits = 0
  private misses = 0

  constructor(id: string, config: CdnConfig, ctx: SimContext) {
    super(id, 'cdn', config, ctx)
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    const now = this.ctx.now()
    const entry = this.cache.get(req.key)

    if (entry && entry.expiresAt > now) {
      // Cache hit
      this.hits++
      this.counters.ok++
      onResult({ ok: true, serviceMs: 1 }) // Near-instant edge hit
      return
    }

    // Cache miss - fetch from origin
    this.misses++

    // Simulate origin fetch latency
    const originLatency = this.config.originLatencyMs + this.ctx.rng.int(0, 50)

    this.ctx.schedule(now + originLatency, () => {
      // Store in cache
      const size = req.payloadBytes
      this.evictIfNeeded(size)

      this.cache.set(req.key, {
        key: req.key,
        data: 'cached-content',
        expiresAt: now + this.config.defaultTtlMs,
        sizeBytes: size,
      })
      this.totalSize += size

      // Execute on machine to track resource usage
      const cost = this.estimateCost(req)
      const m = this.machines[0]
      if (m && m.accepting) {
        m.execute(cost, (res) => {
          if (res.ok) {
            this.counters.ok++
            onResult({ ok: true, serviceMs: res.elapsedMs + originLatency })
          } else {
            this.counters.errors++
            onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
          }
        })
      } else {
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
      }
    })
  }

  private evictIfNeeded(newSize: number): void {
    const maxBytes = this.config.cacheSizeGb * 1024 * 1024 * 1024
    while (this.totalSize + newSize > maxBytes && this.cache.size > 0) {
      // Simple LRU: evict oldest
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        const entry = this.cache.get(firstKey)
        if (entry) this.totalSize -= entry.sizeBytes
        this.cache.delete(firstKey)
      }
    }
  }

  private estimateCost(req: Request): ResourceCost {
    return {
      cpuMs: 0.02,
      memKb: 1,
      diskReads: 0,
      diskWrites: 0,
      fsync: 0,
      netBytesIn: req.payloadBytes,
      netBytesOut: req.payloadBytes,
    }
  }

  get hitRatio(): number {
    const total = this.hits + this.misses
    return total > 0 ? this.hits / total : 0
  }

  get cacheUsage(): number {
    const max = this.config.cacheSizeGb * 1024 * 1024 * 1024
    return max > 0 ? this.totalSize / max : 0
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'edgeLocations' || key === 'cacheSizeGb') {
      // Configuration changes that don't require rebuild, just take effect immediately
    }
  }
}