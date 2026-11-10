// MongoDB node: shards, replication factor, consistency levels.
// Models sharded cluster with primary/secondary per shard.

import { BaseNode } from './BaseNode'
import { Machine } from '../machine/machine'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface MongoConfig {
  label: string
  instanceId: string
  shards: number
  replicationFactor: number
  consistencyLevel: 'one' | 'majority' | 'all'
  queueSize: number
  maxConnections: number
}

interface Shard {
  primary: Machine | null
  secondaries: Machine[]
  phase: 'healthy' | 'degraded' | 'down'
}

export class MongoNode extends BaseNode<MongoConfig> {
  private shards: Shard[] = []

  constructor(id: string, config: MongoConfig, ctx: SimContext) {
    super(id, 'mongo', config, ctx)
    this.rebuild()
  }

  private rebuild(): void {
    for (const s of this.shards) {
      if (s.primary) s.primary.destroy()
      for (const sec of s.secondaries) sec.destroy()
    }
    this.shards = []

    for (let i = 0; i < this.config.shards; i++) {
      const primary = new Machine(`${this.id}-shard${i}-primary`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'thread-pool',
        threads: 8,
        queueCap: this.config.queueSize,
        label: `Shard ${i} Primary`,
      })
      const secondaries: Machine[] = []
      for (let j = 0; j < this.config.replicationFactor - 1; j++) {
        const sec = new Machine(`${this.id}-shard${i}-sec${j}`, this.ctx, this.ctx.rng, {
          instanceId: this.config.instanceId,
          runtime: 'thread-pool',
          threads: 8,
          queueCap: this.config.queueSize,
          label: `Shard ${i} Secondary ${j}`,
        })
        secondaries.push(sec)
      }
      this.shards.push({
        primary,
        secondaries,
        phase: 'healthy',
      })
    }
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    // Hash key to shard
    const shardIdx = req.key ? this.xxhash32(req.key) % this.config.shards : 0
    const shard = this.shards[shardIdx]!

    const cost = this.estimateCost(req)

    if (req.op === 'write') {
      // Write to primary, replicate based on consistency level
      if (!shard.primary || !shard.primary.accepting) {
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }

      this.consistencyReplicasNeeded() // Track for potential future use
      shard.primary.execute(cost, (res) => {
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          this.counters.errors++
          onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
        }
      })
    } else {
      // Read: based on consistency level
      const targets = this.readTargets(shard)
      if (targets.length === 0) {
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }

      // Round-robin read target
      const target = targets[this.rr++ % targets.length]!
      target.execute(cost, (res) => {
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          this.counters.errors++
          onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
        }
      })
    }
  }

  private rr = 0

  private consistencyReplicasNeeded(): number {
    switch (this.config.consistencyLevel) {
      case 'one': return 1
      case 'majority': return Math.floor(this.config.replicationFactor / 2) + 1
      case 'all': return this.config.replicationFactor
    }
  }

  private readTargets(shard: Shard): Machine[] {
    switch (this.config.consistencyLevel) {
      case 'one':
        // Read from primary or any healthy secondary
        const healthy = [shard.primary, ...shard.secondaries].filter((m): m is Machine => m !== null && m.accepting)
        return healthy.length > 0 ? healthy : [shard.primary].filter((m): m is Machine => m !== null)
      case 'majority':
        // Read from majority
        const majority = [shard.primary, ...shard.secondaries].filter((m): m is Machine => m !== null && m.accepting)
        return majority.length >= this.consistencyReplicasNeeded() ? majority : [shard.primary].filter((m): m is Machine => m !== null)
      case 'all':
        return [shard.primary].filter((m): m is Machine => m !== null)
    }
  }

  private xxhash32(key: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = (h * 0x01000193) >>> 0
    }
    return (h >>> 0) + (h << 15) >>> 0
  }

  private estimateCost(req: Request): ResourceCost {
    return {
      cpuMs: req.op === 'write' ? 0.2 : 0.15,
      memKb: 4,
      diskReads: req.op === 'read' ? 1 : 0,
      diskWrites: req.op === 'write' ? 1 : 0,
      fsync: req.op === 'write' ? 1 : 0,
      netBytesIn: req.payloadBytes,
      netBytesOut: 0,
    }
  }
  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'shards' || key === 'replicationFactor') {
      this.rebuild()
    }
  }
}