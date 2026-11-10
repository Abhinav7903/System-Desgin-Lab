// Rate Limiter node: token bucket / sliding window algorithms.
// Models API rate limiting with burst allowance and key-based tracking.

import { BaseNode } from './BaseNode'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface RateLimiterConfig {
  label: string
  instanceId: string
  algorithm: 'token-bucket' | 'sliding-window' | 'fixed-window'
  requestsPerSecond: number
  burstAllowance: number
  keyPrefix: string
  queueSize: number
}

interface Bucket {
  tokens: number
  lastRefill: number
}

export class RateLimiterNode extends BaseNode<RateLimiterConfig> {
  private buckets = new Map<string, Bucket>()
  private windowCounts = new Map<string, number[]>() // timestamp[] for sliding window
  private rejected = 0

  constructor(id: string, config: RateLimiterConfig, ctx: SimContext) {
    super(id, 'ratelimiter', config, ctx)
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    const key = `${this.config.keyPrefix}:${req.key || 'default'}`
    const now = this.ctx.now()
    let allowed = false

    switch (this.config.algorithm) {
      case 'token-bucket': {
        let bucket = this.buckets.get(key)
        if (!bucket) {
          bucket = { tokens: this.config.burstAllowance, lastRefill: now }
          this.buckets.set(key, bucket)
        }
        // Refill tokens based on time elapsed
        const elapsedSec = (now - bucket.lastRefill) / 1000
        bucket.tokens = Math.min(this.config.burstAllowance, bucket.tokens + elapsedSec * this.config.requestsPerSecond)
        bucket.lastRefill = now

        if (bucket.tokens >= 1) {
          bucket.tokens--
          allowed = true
        }
        break
      }
      case 'sliding-window': {
        const windowMs = 1000 // 1 second window
        let timestamps = this.windowCounts.get(key) ?? []
        // Remove old timestamps outside window
        timestamps = timestamps.filter((t) => now - t < windowMs)
        if (timestamps.length < this.config.requestsPerSecond) {
          timestamps.push(now)
          this.windowCounts.set(key, timestamps)
          allowed = true
        }
        break
      }
      case 'fixed-window': {
        const windowSec = Math.floor(now / 1000)
        const windowKey = `${key}:${windowSec}`
        let count = this.windowCounts.get(windowKey) ?? [0]
        if (count[0]! < this.config.requestsPerSecond) {
          count[0]!++
          this.windowCounts.set(windowKey, count)
          allowed = true
        }
        break
      }
    }

    if (!allowed) {
      this.rejected++
      this.counters.rejected++
      onResult({ ok: false, fate: 'throttled', serviceMs: 0 })
      return
    }

    // Allowed - execute minimal cost
    const cost = this.estimateCost(req)
    const m = this.machines[0]
    if (m && m.accepting) {
      m.execute(cost, (res) => {
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          this.counters.errors++
          onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
        }
      })
    } else {
      this.counters.errors++
      onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
    }
  }

  private estimateCost(_req: Request): ResourceCost {
    return {
      cpuMs: 0.01,
      memKb: 1,
      diskReads: 0,
      diskWrites: 0,
      fsync: 0,
      netBytesIn: 0,
      netBytesOut: 0,
    }
  }

  get rejectionRate(): number {
    const total = this.counters.in
    return total > 0 ? this.rejected / total : 0
  }

  get activeKeys(): number {
    return this.buckets.size + this.windowCounts.size
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'algorithm' || key === 'requestsPerSecond' || key === 'burstAllowance' || key === 'keyPrefix') {
      // Configuration changes that don't require rebuild, just take effect immediately
    }
  }
}