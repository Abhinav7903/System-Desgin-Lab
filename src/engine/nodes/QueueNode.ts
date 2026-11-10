// Queue node: simple queue (SQS/RabbitMQ style), DLQ.
// Models bounded queue with visibility timeout, retries, dead-letter queue.

import { BaseNode } from './BaseNode'
import type { ResourceCost } from '../core/types'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface QueueConfig {
  label: string
  instanceId: string
  visibilityTimeoutMs: number
  maxRetries: number
  dlqEnabled: boolean
  maxSize: number
  queueSize: number
}

interface QueuedMessage {
  req: Request
  attempts: number
  visibleAt: number
}

export class QueueNode extends BaseNode<QueueConfig> {
  private internalQueue: QueuedMessage[] = []
  private dlq: QueuedMessage[] = []
  private processing: Map<number, QueuedMessage> = new Map()

  constructor(id: string, config: QueueConfig, ctx: SimContext) {
    super(id, 'queue', config, ctx)
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    if (req.op === 'write') {
      // Enqueue
      if (this.internalQueue.length >= this.config.maxSize) {
        this.counters.rejected++
        onResult({ ok: false, fate: 'rejected_queue_full', serviceMs: 0 })
        return
      }

      const msg: QueuedMessage = {
        req,
        attempts: 0,
        visibleAt: this.ctx.now(),
      }
      this.internalQueue.push(msg)
      this.counters.ok++
      onResult({ ok: true, serviceMs: 1 })
      return
    }

    // Read: get next visible message
    const now = this.ctx.now()
    const idx = this.internalQueue.findIndex((m) => m.visibleAt <= now)
    if (idx === -1) {
      // No visible messages - poll later
      this.ctx.schedule(now + 100, () => this.handle(req, onResult))
      return
    }

    const msg = this.internalQueue.splice(idx, 1)[0]!
    msg.attempts++
    this.processing.set(msg.req.id, msg)

    const cost = this.estimateCost(msg.req)
    const m = this.machines[0]
    if (m && m.accepting) {
      m.execute(cost, (res) => {
        this.processing.delete(msg.req.id)
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          // Processing failed - requeue with visibility timeout or DLQ
          if (msg.attempts >= this.config.maxRetries) {
            if (this.config.dlqEnabled) {
              this.dlq.push(msg)
              this.counters.dropped++
            }
            this.counters.errors++
            onResult({ ok: false, fate: 'dropped_no_buffer', serviceMs: 0 })
          } else {
            msg.visibleAt = now + this.config.visibilityTimeoutMs
            this.internalQueue.push(msg)
            this.counters.rejected++
            onResult({ ok: false, fate: 'rejected_queue_full', serviceMs: 0 })
          }
        }
      })
    } else {
      // Machine down - requeue
      msg.visibleAt = now + this.config.visibilityTimeoutMs
      this.internalQueue.push(msg)
      this.counters.errors++
      onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
    }
  }

  private estimateCost(req: Request): ResourceCost {
    return {
      cpuMs: 0.05,
      memKb: 1,
      diskReads: 0,
      diskWrites: 0,
      fsync: 0,
      netBytesIn: req.payloadBytes,
      netBytesOut: 0,
    }
  }

  getQueueDepth(): number {
    return this.internalQueue.length
  }

  getDlqDepth(): number {
    return this.dlq.length
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId' || key === 'maxSize' || key === 'visibilityTimeoutMs') {
      // Configuration changes that don't require rebuild, just take effect immediately
    }
  }
}