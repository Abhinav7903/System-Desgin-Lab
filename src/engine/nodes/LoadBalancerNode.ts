// Load Balancer node: distributes requests across API instances.
// Algorithms: round-robin, least-connections, consistent-hash.
// Health checks with detection delay; max connections limit.

import { BaseNode } from './BaseNode'
import { Machine } from '../machine/machine'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface LoadBalancerConfig {
  label: string
  instanceId: string
  algorithm: 'round-robin' | 'least-connections' | 'consistent-hash'
  healthCheckIntervalMs: number
  healthCheckThreshold: number
  maxConnections: number
  autoscale: boolean
  autoscaleMax: number
  autoscaleDelayMs: number
  queueSize: number
}

export class LoadBalancerNode extends BaseNode<LoadBalancerConfig> {
  private rr = 0
  private connOpen = 0
  private healthCheckAt = 0

  constructor(id: string, config: LoadBalancerConfig, ctx: SimContext) {
    super(id, 'loadbalancer', config, ctx)
    this.healthCheckAt = ctx.now()
    this.rebuildMachines()
  }

  private rebuildMachines(): void {
    for (const m of this.machines) m.destroy()
    this.machines = []
    // Create LB machines for health checks and own processing
    for (let i = 0; i < 1; i++) {
      const m = new Machine(`${this.id}#${i}`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'event-loop',
        threads: 1,
        queueCap: this.config.queueSize,
        label: `${this.label}#${i}`,
      })
      m.onPhaseChange = () => this.onMachineChanged()
      this.machines.push(m)
    }
    this.healthCheckAt = this.ctx.now()
  }

  onConfigChange(key: string, _oldValue: unknown, _newValue: unknown): void {
    if (key === 'instanceId') {
      this.rebuildMachines()
    }
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++

    // Connection limit: refuse if at capacity
    if (this.connOpen >= this.config.maxConnections) {
      this.counters.rejected++
      onResult({ ok: false, fate: 'rejected_pool_exhausted', serviceMs: 0 })
      return
    }

    // Get downstream targets from graph edges
    const targets = this.ctx.targets(this.id)
    if (targets.length === 0) {
      this.counters.errors++
      onResult({ ok: false, fate: 'dropped_no_buffer', serviceMs: 0 })
      return
    }

    // Select a target based on algorithm
    const targetId = this.selectTarget(targets, req)
    if (!targetId) {
      this.counters.errors++
      onResult({ ok: false, fate: 'dropped_no_buffer', serviceMs: 0 })
      return
    }

    // Forward request to selected target via graph edge
    this.connOpen++
    this.ctx.send(this.id, targetId, req, (res) => {
      this.connOpen--
      if (res.ok) {
        this.counters.ok++
        onResult({ ok: true, serviceMs: res.serviceMs })
      } else {
        this.counters.errors++
        onResult({ ok: false, fate: res.fate, serviceMs: res.serviceMs })
      }
    })
  }

  private selectTarget(targets: string[], req: Request): string | undefined {
    const { algorithm } = this.config

    switch (algorithm) {
      case 'round-robin': {
        const target = targets[this.rr % targets.length]
        this.rr = (this.rr + 1) % targets.length
        return target
      }
      case 'least-connections': {
        // For simplicity, use round-robin for now
        // Could be enhanced to query downstream load
        const target = targets[this.rr % targets.length]
        this.rr = (this.rr + 1) % targets.length
        return target
      }
      case 'consistent-hash': {
        const key = req.key || 'default'
        const hash = this.xxhash32(key) % targets.length
        return targets[hash]
      }
      default:
        return targets[0]
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

  tick(dtSec: number): void {
    const now = this.ctx.now()
    if (now - this.healthCheckAt >= this.config.healthCheckIntervalMs) {
      this.healthCheckAt = now
      // Emit health check events; machines already track their own phase
      for (const m of this.machines) {
        if (m.phase === 'down') {
          this.ctx.log.emit(now, this.id, 'health_check', `${m.label} is down`, 'warn')
        }
      }
    }
    void dtSec
  }

  get poolUtilization(): number {
    return this.machines.length > 0 ? Math.min(1, this.connOpen / this.config.maxConnections) : 0
  }
}