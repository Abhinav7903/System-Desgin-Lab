// The virtual Machine: every component runs as software on a Machine with
// real CPU/Memory/Disk/NIC/OS limits. Nothing is scripted per scenario —
// behavior emerges when resources run out.

import { instanceType } from './instanceTypes'
import { Cpu } from './cpu'
import { Memory } from './memory'
import { Disk } from './disk'
import { Nic } from './nic'
import { Os } from './os'
import type { SimScheduler } from './scheduler'
import type { Rng } from '../core/rng'
import type { ResourceCost } from '../core/types'
import type { NodePhase } from '../core/types'

export type RuntimeModel = 'event-loop' | 'thread-pool' | 'multi-process'

export type MachineError = 'down' | 'disk_full' | 'busy'

export interface ExecResult {
  ok: boolean
  err?: MachineError
  /** Virtual ms the op took end-to-end on this machine. */
  elapsedMs: number
  swapped: boolean
}

export interface MachineConfig {
  instanceId: string
  runtime: RuntimeModel
  /** Thread-pool size for 'thread-pool' runtime; always 1 for event-loop. */
  threads?: number
  /** Bounded internal op queue. Beyond it, execute() reports 'busy'. */
  queueCap?: number
  label: string
  /** True for freshly launched instances (autoscale): cold boot + warm-up. */
  coldBoot?: boolean
}

/** A single in-flight operation occupying a thread (or the event loop). */
interface InFlight {
  startedAt: number
  onComplete: (res: ExecResult) => void
  settled: boolean
}

interface QueuedOp {
  cost: ResourceCost
  onComplete: (res: ExecResult) => void
}

export class Machine {
  readonly id: string
  readonly label: string
  readonly cpu: Cpu
  readonly memory: Memory
  readonly disk: Disk
  readonly nic: Nic
  readonly os: Os
  readonly runtime: RuntimeModel
  readonly queueCap: number

  phase: NodePhase = 'booting'
  instanceId: string
  threads: number
  /** Events for the log console (htop-style inspector). */
  logs: { at: number; level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL'; msg: string }[] = []
  onPhaseChange?: (m: Machine, from: NodePhase, to: NodePhase) => void

  private readonly scheduler: SimScheduler
  private readonly rng: Rng
  private inFlight: InFlight[] = []
  private opQueue: QueuedOp[] = []
  private restartDelayMs: number
  private destroyed = false

  constructor(id: string, scheduler: SimScheduler, rng: Rng, cfg: MachineConfig) {
    this.id = id
    this.label = cfg.label
    this.scheduler = scheduler
    this.rng = rng
    this.instanceId = cfg.instanceId
    this.runtime = cfg.runtime
    this.threads = cfg.threads ?? (cfg.runtime === 'event-loop' ? 1 : 8)
    this.queueCap = cfg.queueCap ?? 256
    const it = instanceType(cfg.instanceId)
    this.cpu = new Cpu(scheduler, it.vcpu, it.shared ? 0.6 : 1)
    this.memory = new Memory(it.ramGb)
    // instanceTypes lists disk throughput in MB/s; Disk works in Mbps.
    this.disk = new Disk(scheduler, it.diskIops, it.diskMbps * 8, 0.15, 1.2, 50)
    this.nic = new Nic(scheduler, rng, it.nicMbps)
    this.os = new Os()
    this.restartDelayMs = it.bootSec * 1000
    if (cfg.coldBoot) {
      // Freshly launched instance: boot time + JIT/page-cache warm-up.
      this.setPhase('booting')
      scheduler.schedule(scheduler.now() + it.bootSec * 1000, () => {
        if (!this.destroyed && this.phase === 'booting') {
          this.memory.reset(false)
          this.setPhase('healthy')
          this.log('INFO', `${this.label} up (${it.vcpu} vCPU / ${it.ramGb} GB)`)
        }
      })
    } else {
      // Already-running instance (the initial topology is pre-booted).
      this.memory.reset(false)
      this.setPhase('healthy')
    }
  }

  get busyThreads(): number {
    return this.inFlight.length
  }

  get utilization(): number {
    return this.cpu.utilization
  }

  get accepting(): boolean {
    return this.phase === 'healthy' || this.phase === 'degraded'
  }

  log(level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL', msg: string): void {
    this.logs.push({ at: this.scheduler.now(), level, msg })
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500)
  }

  setPhase(p: NodePhase): void {
    const from = this.phase
    this.phase = p
    this.onPhaseChange?.(this, from, p)
  }

  /** Crash the process (OOM or user kill). It restarts after a delay, cold. */
  crash(reason: string, restart = true): void {
    if (this.phase === 'down') return
    this.failInFlight('down')
    this.setPhase('down')
    this.log('FATAL', reason)
    this.os.reset()
    if (restart) {
      this.scheduler.schedule(this.scheduler.now() + this.restartDelayMs, () => {
        if (this.destroyed || this.phase !== 'down') return
        this.setPhase('recovering')
        this.memory.reset(true) // cold cache
        this.log('INFO', `${this.label} restarted (cold cache)`)
        this.scheduler.schedule(this.scheduler.now() + 2000, () => {
          if (!this.destroyed && this.phase === 'recovering') this.setPhase('healthy')
        })
      })
    }
  }

  /** User kill: stays down until restarted. */
  kill(): void {
    this.crash(`SIGKILL ${this.label} (user action)`, false)
  }

  restartNow(): void {
    if (this.phase === 'healthy') return
    this.setPhase('recovering')
    this.memory.reset(true)
    this.scheduler.schedule(this.scheduler.now() + 2000, () => {
      if (!this.destroyed && this.phase === 'recovering') this.setPhase('healthy')
    })
  }

  destroy(): void {
    this.destroyed = true
  }

  /**
   * Execute an op with a resource cost vector. The op occupies a thread (or
   * the single event-loop thread) while CPU/disk/network run through their
   * own queues. When all threads are busy the op waits in the machine's
   * bounded queue; when THAT is full, execute() reports 'busy' (sync) and the
   * caller decides rejection. Service time emerges from queueing.
   */
  execute(cost: ResourceCost, onComplete: (res: ExecResult) => void): void {
    if (!this.accepting) {
      onComplete({ ok: false, err: 'down', elapsedMs: 0, swapped: false })
      return
    }
    if (this.opQueue.length + this.inFlight.length >= this.queueCap) {
      onComplete({ ok: false, err: 'busy', elapsedMs: 0, swapped: false })
      return
    }
    if (this.os.fdExhausted) {
      this.log('ERROR', 'too many open files')
      onComplete({ ok: false, err: 'down', elapsedMs: 0, swapped: false })
      return
    }
    if (this.inFlight.length < this.threads) {
      // A thread is free: start immediately (no queue hop).
      this.start(cost, onComplete)
      return
    }
    if (this.opQueue.length >= this.queueCap) {
      onComplete({ ok: false, err: 'busy', elapsedMs: 0, swapped: false })
      return
    }
    this.opQueue.push({ cost, onComplete })
    this.pump()
  }

  private pump(): void {
    while (this.opQueue.length > 0 && this.inFlight.length < this.threads) {
      const op = this.opQueue.shift()!
      this.start(op.cost, op.onComplete)
    }
  }

  private start(cost: ResourceCost, onComplete: (res: ExecResult) => void): void {
    const startedAt = this.scheduler.now()
    const fl: InFlight = { startedAt, onComplete, settled: false }
    this.inFlight.push(fl)
    const finish = (ok: boolean, err?: MachineError): void => {
      if (fl.settled) return
      fl.settled = true
      const idx = this.inFlight.indexOf(fl)
      if (idx >= 0) this.inFlight.splice(idx, 1)
      onComplete({
        ok,
        err: err === 'busy' ? undefined : err,
        elapsedMs: this.scheduler.now() - startedAt,
        swapped: this.memory.onSwap,
      })
      this.pump()
    }

    // Memory pressure: swap slows everything on this machine.
    const swapFactor = this.memory.slowFactor
    const cpuMs = cost.cpuMs * swapFactor
    const hasDisk = cost.diskReads + cost.diskWrites + cost.fsync > 0
    // Small transfers are folded into CPU time (kernel copies); large
    // payloads still exercise the NIC queue so saturation stays realistic.
    const smallNet = cost.netBytesIn + cost.netBytesOut <= 8192

    // Fast path: when CPU, disk, and (for small payloads) the NIC are all
    // idle, complete in ONE event — serializing idle resources is exactly
    // the sum of their service times. When anything is busy, the staged
    // path below runs and queueing delay emerges for real.
    if (this.cpu.idle && (!hasDisk || this.disk.idle) && smallNet) {
      let t = this.scheduler.now()
      t = this.cpu.reserve(t, cpuMs)
      if (hasDisk) t = this.disk.reserve(t, cost)
      t = this.nic.reserve(t, cost.netBytesIn + cost.netBytesOut)
      if (cost.memKb > 0) this.memory.allocate(cost.memKb)
      this.scheduler.schedule(t, () => {
        if (cost.memKb > 0) this.memory.release(cost.memKb)
        finish(true)
      })
      return
    }

    // Staged path (real queueing emerges here when resources are busy).
    const doCpu = (): void => {
      this.cpu.submit(cpuMs, () => {
        if (hasDisk) {
          this.disk.submit(cost.diskReads, cost.diskWrites, cost.fsync, (err) => {
            if (err === 'disk_full') {
              this.log('FATAL', 'No space left on device')
              this.crash('disk full', false)
              finish(false, 'disk_full')
              return
            }
            doNetOut()
          })
        } else {
          doNetOut()
        }
      })
    }
    const doNetOut = (): void => {
      if (cost.netBytesOut > 0) {
        this.nic.send(cost.netBytesOut, 0, (lost) => {
          if (lost) {
            this.log('WARN', 'NIC drop')
            finish(false)
            return
          }
          doMem()
        })
      } else {
        doMem()
      }
    }
    const doMem = (): void => {
      if (cost.memKb > 0) {
        this.memory.allocate(cost.memKb)
        this.memory.release(cost.memKb)
      }
      finish(true)
    }

    if (cost.netBytesIn > 0 && !smallNet) {
      this.nic.send(cost.netBytesIn, 0, (lost) => {
        if (lost) {
          this.log('WARN', 'NIC drop')
          finish(false)
          return
        }
        doCpu()
      })
    } else {
      doCpu()
    }
  }

  /** Memory leak tick; OOM-kills when RAM is exhausted. */
  tick(dtSec: number): void {
    if (this.phase === 'down' || this.phase === 'booting') return
    this.memory.tickLeak(dtSec)
    if (this.memory.pressure >= 0.98 && this.memory.leakKbPerSec > 0) {
      this.crash('OOM killed process (out of memory)', true)
    } else if (this.memory.onSwap && this.rng.chance(0.02 * dtSec)) {
      this.log('WARN', 'swapping: system extremely slow')
    }
  }

  private failInFlight(err: MachineError): void {
    const flights = this.inFlight.slice()
    const queued = this.opQueue.slice()
    this.inFlight = []
    this.opQueue = []
    for (const f of flights) {
      f.settled = true
      f.onComplete({ ok: false, err, elapsedMs: this.scheduler.now() - f.startedAt, swapped: false })
    }
    for (const q of queued) {
      q.onComplete({ ok: false, err, elapsedMs: 0, swapped: false })
    }
  }
}
