// The main simulation loop. Builds nodes from a GraphConfig, routes requests
// along edges, pumps clients, ticks machines, closes metric windows.
// PURE: no React, no DOM, no real time — only the virtual event queue.

import { VirtualClock } from './clock'
import { EventQueue } from './eventQueue'
import { TimingWheel } from './timingWheel'
import { Rng } from './rng'
import type {
  FailureAction,
  GlobalSnapshot,
  NodeSnapshot,
  Request,
  RequestFate,
  NodeKind,
} from './types'
import type { SimContext, SendResult } from './context'
import { EventLog } from '../analysis/eventLog'
import { MetricsCollector } from '../metrics/collector'
import type { GraphConfig, GraphEdgeConfig } from '../graph'
import { BaseNode } from '../nodes/BaseNode'
import { ClientNode } from '../nodes/ClientNode'
import { createNode, defaultConfigFor } from '../nodes/registry'
import { FailureInjector } from '../failures/injector'

export interface SimulatorOptions {
  /** Virtual ms per metrics window. */
  windowMs?: number
}

export class Simulator implements SimContext {
  readonly clock = new VirtualClock()
  readonly queue = new EventQueue()
  readonly wheel: TimingWheel
  readonly rng: Rng
  readonly metrics = new MetricsCollector()
  readonly log = new EventLog()
  readonly injector: FailureInjector
  readonly graph: GraphConfig
  latencyTargetMs: number
  windowMs: number

  private nodes = new Map<string, BaseNode>()
  private clientNodes: ClientNode[] = []
  private edges: GraphEdgeConfig[]
  /** Cached edge lookup (send() is called millions of times). */
  private edgeMap = new Map<string, GraphEdgeConfig>()
  /** Cached targets per node id (invalidated on edge changes). */
  private targetsCache = new Map<string, string[]>()
  private onSnapshotCb: ((g: GlobalSnapshot, n: NodeSnapshot[]) => void) | null = null

  constructor(graph: GraphConfig, opts: SimulatorOptions = {}) {
    this.graph = graph
    this.rng = new Rng(graph.seed)
    this.latencyTargetMs = graph.latencyTargetMs
    this.windowMs = opts.windowMs ?? 100
    this.edges = graph.edges.map((e) => ({ ...e }))
    for (const e of this.edges) this.edgeMap.set(`${e.from}->${e.to}`, e)
    this.injector = new FailureInjector(this)
    this.wheel = new TimingWheel((atMs, run) => this.schedule(atMs, run))
    for (const n of graph.nodes) {
      const cfg = { ...defaultConfigFor(n.kind), ...n.config } as never
      const node = createNode(n.id, n.kind, cfg, this)
      this.nodes.set(n.id, node)
      if (node instanceof ClientNode) this.clientNodes.push(node)
    }
  }

  now(): number {
    return this.clock.nowMs
  }

  /** Total events ever scheduled (deterministic per seed). */
  get scheduledEvents(): number {
    return this.queue.scheduled
  }

  schedule(atMs: number, run: () => void): void {
    this.queue.schedule(Math.max(atMs, this.clock.nowMs), run)
  }

  timeoutAt(atMs: number, run: () => void): void {
    this.wheel.schedule(Math.max(atMs, this.clock.nowMs), run)
  }

  node(id: string): BaseNode | undefined {
    return this.nodes.get(id)
  }

  allNodes(): BaseNode[] {
    return [...this.nodes.values()]
  }

  // --- SimContext ---
  send(fromId: string, toId: string, req: Request, onResult: (res: SendResult) => void): void {
    const edge = this.edgeMap.get(`${fromId}->${toId}`)
    if (edge === undefined) {
      // No link: the request is lost unless something buffers it.
      this.queue.schedule(this.now() + 1, () =>
        onResult({ ok: false, fate: 'dropped_no_buffer', serviceMs: 0 }),
      )
      return
    }
    const loss = edge.packetLoss ?? 0
    const baseLatency = edge.latencyMs ?? 1
    const latency = this.rng.jitter(baseLatency, 0.2)
    const arriveAt = this.now() + latency
    if (loss > 0 && this.rng.chance(loss)) {
      // Packet lost in transit: the sender learns at the request deadline
      // (real clients wait it out; nothing silently disappears).
      this.queue.schedule(Math.max(arriveAt, req.deadlineAt), () =>
        onResult({ ok: false, fate: 'timeout', serviceMs: 0 }),
      )
      return
    }
    this.queue.schedule(arriveAt, () => {
      const node = this.nodes.get(toId)
      if (node === undefined) {
        onResult({ ok: false, fate: 'dropped_node_down', serviceMs: 0 })
        return
      }
      node.handle(req, onResult)
    })
  }

  targets(fromId: string, kind?: NodeKind): string[] {
    const key = kind === undefined ? fromId : `${fromId}:${kind}`
    let t = this.targetsCache.get(key)
    if (t === undefined) {
      t = this.edges
        .filter((e) => e.from === fromId && (kind === undefined || this.nodes.get(e.to)?.kind === kind))
        .map((e) => e.to)
      this.targetsCache.set(key, t)
    }
    return t
  }

  nodesOfKind(kind: NodeKind): string[] {
    return [...this.nodes.values()].filter((n) => n.kind === kind).map((n) => n.id)
  }

  resolve(req: Request, fate: RequestFate, latencyMs: number): void {
    // Client finalization already recorded metrics. Hook for lessons/tests.
    void req
    void fate
    void latencyMs
  }

  applyFailure(action: FailureAction): void {
    this.injector.apply(action)
    this.log.emit(this.now(), action.type, JSON.stringify(action), 'warn')
  }

  // --- Run loop ---
  onSnapshot(cb: (g: GlobalSnapshot, n: NodeSnapshot[]) => void): void {
    this.onSnapshotCb = cb
  }

  /** Advance `durationMs` of virtual time, emitting snapshots per window. */
  run(durationMs: number): void {
    const endT = this.now() + durationMs
    while (this.now() < endT) {
      const windowEnd = Math.min(this.now() + this.windowMs, endT)
      // Keep client arrivals generated a little ahead of the window.
      this.pumpClients(windowEnd + 250)
      // Drain all events due within the window, merged with client
      // arrivals (which never enter the heap — they are pre-sorted).
      let best = this.minArrivalClient()
      for (;;) {
        const heapAt = this.queue.peekAt()
        const arrAt = best?.nextArrivalAt()
        const heapDue = heapAt !== undefined && heapAt <= windowEnd
        const arrDue = arrAt !== undefined && arrAt <= windowEnd
        if (!heapDue && !arrDue) break
        if (arrDue && (!heapDue || arrAt! <= heapAt!)) {
          // Arrival fires first on ties (same order the heap seq had).
          this.clock.advanceTo(arrAt!)
          best!.fireNextArrival()
          best = this.minArrivalClient()
        } else {
          const run = this.queue.popRun()!
          this.clock.advanceTo(heapAt!)
          run()
        }
        // Fire wheel timeouts that became due.
        this.wheel.drain(this.now())
      }
      this.clock.advanceTo(windowEnd)
      this.wheel.drain(this.now())
      this.tickNodes(this.windowMs / 1000)
      // Snapshot BEFORE closing the window: it must describe the window that
      // just elapsed, not the empty one that follows.
      this.emitSnapshot()
      this.metrics.closeWindow(this.now(), this.windowMs)
    }
  }

  private pumpClients(horizonMs: number): void {
    for (const n of this.nodes.values()) {
      if (n.pump) n.pump(horizonMs)
    }
  }

  /** The client with the earliest unfired arrival (or undefined). */
  private minArrivalClient(): ClientNode | undefined {
    let best: ClientNode | undefined
    let bestAt = Infinity
    for (const c of this.clientNodes) {
      const t = c.nextArrivalAt()
      if (t !== undefined && t < bestAt) {
        bestAt = t
        best = c
      }
    }
    return best
  }

  private tickNodes(dtSec: number): void {
    for (const n of this.nodes.values()) {
      n.tick?.(dtSec)
      for (const m of n.machines) m.tick(dtSec)
    }
  }

  private emitSnapshot(): void {
    if (this.onSnapshotCb === null) return
    const f = this.metrics.windowFates()
    const done =
      f.served + f.servedSlow + f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout +
      f.droppedNodeDown + f.droppedNoBuffer + f.throttled + f.staleRead + f.retriedOk
    const total = Math.max(1, done)
    const g: GlobalSnapshot = {
      at: this.now(),
      rps: (done * 1000) / this.windowMs,
      fates: f,
      p50: this.metrics.p50,
      p95: this.metrics.p95,
      p99: this.metrics.p99,
      latencyTargetMs: this.latencyTargetMs,
      errorRate:
        (f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout + f.droppedNodeDown + f.droppedNoBuffer) /
        total,
      sloViolated: this.metrics.p99 > this.latencyTargetMs,
    }
    const ns: NodeSnapshot[] = this.allNodes().map((n) => this.snapshotNode(n))
    this.onSnapshotCb(g, ns)
  }

  private snapshotNode(n: BaseNode): NodeSnapshot {
    const m = n.machines[0]
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      phase: n.phase,
      cpuUtil:
        n.machines.length > 0
          ? n.machines.reduce((a, x) => a + x.cpu.utilization, 0) / n.machines.length
          : 0,
      memUsedMb: m ? m.memory.usedKb / 1024 / 1024 : 0,
      memTotalMb: m ? m.memory.totalKb / 1024 / 1024 : 0,
      queueDepth: n.queueDepth(),
      queueCap: n.config.queueSize,
      inFlight: m ? m.busyThreads : 0,
      threadsBusy: m ? m.busyThreads : 0,
      threadsTotal: m ? m.threads : 0,
      connOpen: m ? m.os.connections : 0,
      connMax: m ? m.os.maxConnections : 0,
      counters: { ...n.counters },
    }
  }
}
