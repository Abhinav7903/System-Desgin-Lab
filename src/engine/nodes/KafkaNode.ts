// Kafka node: topics, partitions, consumer groups, lag, retention.
// Models partitioned log with consumer group parallelism and retention limits.

import { BaseNode } from './BaseNode'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface KafkaConfig {
  label: string
  instanceId: string
  brokers: number
  partitions: number
  replicationFactor: number
  consumerGroups: number
  retentionMs: number
  maxLag: number
  queueSize: number
}

export class KafkaNode extends BaseNode<KafkaConfig> {
  private partitions: Array<{ messages: number; consumers: number }> = []
  private totalMessages = 0
  private consumerLag = 0

  constructor(id: string, config: KafkaConfig, ctx: SimContext) {
    super(id, 'kafka', config, ctx)
    // Initialize partitions
    for (let i = 0; i < this.config.partitions; i++) {
      this.partitions.push({ messages: 0, consumers: 0 })
    }
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    const cost = this.estimateCost(req)

    if (req.op === 'write') {
      // Producer: write to partition (round-robin or key-based)
      const partitionIdx = req.key
        ? this.xxhash32(req.key) % this.config.partitions
        : this.totalMessages % this.config.partitions

      this.partitions[partitionIdx]!.messages++
      this.totalMessages++

      // Check retention
      if (this.totalMessages > this.config.maxLag) {
        this.counters.errors++
        onResult({ ok: false, fate: 'rejected_queue_full', serviceMs: 0 })
        return
      }

      // Execute on a machine (simulating broker write)
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
    } else {
      // Consumer: read from partition
      // Find partition with messages
      let found = false
      for (let i = 0; i < this.config.partitions; i++) {
        const p = this.partitions[i]!
        if (p.messages > 0) {
          p.messages--
          this.totalMessages--
          p.consumers++
          found = true

          const m = this.machines[0]
          if (m && m.accepting) {
            m.execute(cost, (res) => {
              p.consumers--
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
          break
        }
      }

      if (!found) {
        // No messages available - simulate consumer wait
        this.consumerLag++
        this.ctx.schedule(this.ctx.now() + 10, () => this.handle(req, onResult))
      }
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
      cpuMs: req.op === 'write' ? 0.1 : 0.08,
      memKb: 2,
      diskReads: req.op === 'read' ? 1 : 0,
      diskWrites: req.op === 'write' ? 1 : 0,
      fsync: req.op === 'write' ? 1 : 0,
      netBytesIn: req.payloadBytes,
      netBytesOut: 0,
    }
  }

  get currentLag(): number {
    return this.consumerLag
  }

  get partitionStats(): Array<{ messages: number; consumers: number }> {
    return this.partitions
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'partitions' || key === 'brokers') {
      // Rebuild partitions if partitions count changes
      if (key === 'partitions') {
        this.rebuildPartitions()
      }
    }
  }

  private rebuildPartitions(): void {
    const newCount = this.config.partitions
    const oldCount = this.partitions.length
    if (newCount > oldCount) {
      for (let i = oldCount; i < newCount; i++) {
        this.partitions.push({ messages: 0, consumers: 0 })
      }
    } else if (newCount < oldCount) {
      this.partitions = this.partitions.slice(0, newCount)
    }
  }
}