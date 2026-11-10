// Postgres: primary + N replicas, connection pool with visible exhaustion,
// per-query latency that rises with utilization, replication lag, optional
// failover with an election delay (a replica is promoted; lag can lose writes).

import { BaseNode } from './BaseNode'
import { Machine } from '../machine/machine'
import { ConnectionPool } from '../mechanisms/connectionPool'
import { DEFAULT_COSTS } from '../machine/benchmarks'
import type { Request } from '../core/types'
import type { SimContext, SendResult } from '../core/context'

export interface PostgresConfig {
  label: string
  instanceId: string
  queueSize: number
  /** Read replicas (machines) in addition to the primary. */
  replicas: number
  /** Write replicas (machines) in addition to the primary for write scaling. */
  writeReplicas: number
  /** Simulated client-side pool (like pgbouncer): total connections. */
  maxConnections: number
  connectionPool: number
  failover: boolean
  electionMs: number
  replicationLagMs: number
}

export class PostgresNode extends BaseNode<PostgresConfig> {
  private machinesAll: Machine[] = []
  private primaryIdx = 0
  private readRr = 0
  private writeRr = 0
  private pool: ConnectionPool
  /** Failover state. */
  private electionAt: number | null = null
  private lostWrites = 0
  staleReads = 0

  constructor(id: string, config: PostgresConfig, ctx: SimContext) {
    super(id, 'postgres', config, ctx)
    this.pool = new ConnectionPool(this.config.connectionPool)
    this.rebuild()
  }

  private rebuild(): void {
    for (const m of this.machinesAll) m.destroy()
    this.machinesAll = []
    this.machines = []
    // Machine 0 = primary; machines 1..replicas = read replicas; 
    // machines after that = write replicas
    const totalReplicas = this.config.replicas + this.config.writeReplicas
    for (let i = 0; i <= totalReplicas; i++) {
      let label: string
      if (i === this.primaryIdx) {
        label = `${this.label}#${i} (primary)`
      } else if (i <= this.config.replicas) {
        label = `${this.label}#${i} (read replica)`
      } else {
        label = `${this.label}#${i} (write replica)`
      }
      const m = new Machine(`${this.id}#${i}`, this.ctx, this.ctx.rng, {
        instanceId: this.config.instanceId,
        runtime: 'thread-pool',
        threads: 8,
        queueCap: this.config.queueSize,
        label,
      })
      m.onPhaseChange = () => {
        this.onMachineChanged()
        this.checkFailover()
      }
      this.machinesAll.push(m)
      // All machines can serve reads/writes, but primary is at index 0
      // Read replicas (1..replicas) and write replicas (replicas+1..totalReplicas) are all in machines
      if (i === this.primaryIdx || i > 0) this.machines.push(m)
    }
    this.pool.resize(this.config.connectionPool)
    this.markDirty()
  }

  get primary(): Machine | undefined {
    return this.machinesAll[this.primaryIdx]
  }

  get replicasUp(): Machine[] {
    return this.machinesAll.filter((m, i) => i !== this.primaryIdx && m.accepting)
  }

  private checkFailover(): void {
    const primary = this.primary
    if (primary === undefined) return
    if (primary.phase === 'down' && this.config.failover && this.electionAt === null) {
      const promoteIdx = this.machinesAll.findIndex((m, i) => i !== this.primaryIdx && m.accepting)
      if (promoteIdx > 0) {
        this.electionAt = this.ctx.now() + this.config.electionMs
        this.ctx.log.emit(this.ctx.now(), this.id, 'failover', `primary down; electing new primary (wait ${this.config.electionMs}ms)`, 'warn')
        this.ctx.schedule(this.electionAt, () => {
          this.electionAt = null
          const target = this.machinesAll.findIndex((m, i) => i !== this.primaryIdx && m.accepting)
          if (target > 0) {
            // Promote: replication lag means recent writes may be lost.
            this.lostWrites += Math.round((this.config.replicationLagMs / 1000) * 2)
            this.primaryIdx = target
            this.rebuild()
            this.ctx.log.emit(this.ctx.now(), this.id, 'failover', `replica #${target} promoted to primary`, 'info')
          }
        })
      }
    }
  }

  handle(req: Request, onResult: (res: SendResult) => void): void {
    this.counters.in++
    const now = this.ctx.now()
    if (this.electionAt !== null) {
      // Election in progress: writes fail, reads go to replicas (stale).
      if (req.op === 'write') {
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }
      this.staleReads++
      this.readFromReplica(req, onResult, true)
      return
    }
    this.pool.acquireAsync((release) => {
      if (release === null) {
        this.counters.rejected++
        onResult({ ok: false, fate: 'rejected_pool_exhausted', serviceMs: 0 })
        return
      }
      this.query(req, onResult, release)
    })
    void now
  }

  private query(req: Request, onResult: (res: SendResult) => void, release: () => void): void {
    if (req.op === 'write') {
      const p = this.primary
      if (p === undefined || !p.accepting) {
        release()
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }
      p.execute(DEFAULT_COSTS.sqlWrite, (res) => {
        release()
        if (res.ok) {
          this.counters.ok++
          onResult({ ok: true, serviceMs: res.elapsedMs })
        } else {
          this.counters.errors++
          onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
        }
      })
      return
    }
    // Reads: replicas first (round robin), primary as last resort.
    const replicas = this.replicasUp
    if (replicas.length > 0) {
      // With the primary down and no promotion, replicas keep serving but
      // they no longer receive updates: every read is stale.
      const stale = !this.primary?.accepting
      this.readFromReplica(req, onResult, stale, release)
    } else {
      const p = this.primary
      if (p === undefined || !p.accepting) {
        release()
        this.counters.errors++
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }
      p.execute(DEFAULT_COSTS.sqlPointRead, (res) => {
        release()
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

  private readFromReplica(
    _req: Request,
    onResult: (res: SendResult) => void,
    stale: boolean,
    release?: () => void,
  ): void {
    const replicas = this.replicasUp
    if (replicas.length === 0) {
      release?.()
      this.counters.errors++
      onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
      return
    }
    const m = replicas[this.readRr++ % replicas.length]!
    // Some reads miss the page cache and hit the disk.
    const cost = this.ctx.rng.chance(0.3) ? DEFAULT_COSTS.sqlDiskRead : DEFAULT_COSTS.sqlPointRead
    m.execute(cost, (res) => {
      release?.()
      if (res.ok) {
        this.counters.ok++
        if (stale) this.staleReads++
        onResult({ ok: true, serviceMs: res.elapsedMs })
      } else {
        this.counters.errors++
        onResult({ ok: false, fate: res.err === 'busy' ? 'rejected_queue_full' : 'dropped_node_down', serviceMs: 0 })
      }
    })
  }

  get poolUtilization(): number {
    return this.pool.utilization
  }

  /** Writes estimated lost at promotion (replication lag window). */
  get lostWritesCount(): number {
    return this.lostWrites
  }

  get writeRrCount(): number {
    return this.writeRr
  }
}
