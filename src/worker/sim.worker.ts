// Simulation worker: owns the engine, advances virtual time in real-time
// slices, and posts one coalesced snapshot batch per tick. The UI never
// touches engine code directly.

import { Simulator } from '../engine/core/simulator'
import type { GraphConfig } from '../engine/graph'
import type { GlobalSnapshot, NodeSnapshot } from '../engine/core/types'
import type { UiMessage, WorkerMessage } from '../shared/protocol'

/** Real ms between slices. Each slice advances `speed * TICK_MS` virtual ms. */
const TICK_MS = 50

let sim: Simulator | null = null
let graph: GraphConfig | null = null
let running = false
let speed = 5
let latest: { global: GlobalSnapshot; nodes: NodeSnapshot[] } | null = null
let timer: ReturnType<typeof setInterval> | null = null

function post(msg: WorkerMessage): void {
  self.postMessage(msg)
}

function build(g: GraphConfig): void {
  graph = g
  sim = new Simulator(g)
  latest = null
  sim.onSnapshot((global, nodes) => {
    // Coalesce: several windows may elapse per real tick at high speed.
    latest = { global, nodes }
  })
  post({ type: 'ready', graph: g })
}

function emitLatest(): void {
  if (latest === null) return
  post({ type: 'snapshot', global: latest.global, nodes: latest.nodes })
  latest = null
}

function tick(): void {
  if (!running || sim === null) return
  try {
    sim.run(speed * TICK_MS)
    emitLatest()
  } catch (err) {
    running = false
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

self.onmessage = (ev: MessageEvent<UiMessage>) => {
  const msg = ev.data
  switch (msg.type) {
    case 'init':
      build(msg.graph)
      running = false
      if (timer === null) timer = setInterval(tick, TICK_MS)
      break
    case 'play':
      running = true
      break
    case 'pause':
      running = false
      emitLatest()
      break
    case 'step':
      if (sim === null) return
      running = false
      sim.run(sim.windowMs)
      emitLatest()
      break
    case 'speed':
      speed = Math.max(0.1, msg.speed)
      break
    case 'reset':
      running = false
      build(msg.graph ?? graph!)
      break
    case 'patchConfig': {
      if (sim === null) return
      const node = sim.node(msg.nodeId)
      if (node === undefined) return
      // Track old values to pass to onConfigChange
      const oldConfig = { ...node.config } as Record<string, unknown>
      Object.assign(node.config, msg.patch)
      // Call onConfigChange for each changed key
      for (const key of Object.keys(msg.patch)) {
        node.onConfigChange(key, oldConfig[key], msg.patch[key])
      }
      // Keep the stored graph in sync so reset preserves the live change.
      const gn = graph?.nodes.find((n) => n.id === msg.nodeId)
      if (gn !== undefined) Object.assign(gn.config, msg.patch)
      sim.log.emit(sim.now(), msg.nodeId, 'reconfigure', `${node.label}: ${JSON.stringify(msg.patch)}`, 'info')
      break
    }
    case 'failure':
      sim?.applyFailure(msg.action)
      break
    case 'updateGraph': {
      // Rebuild the simulator with the new graph
      graph = msg.graph
      sim = new Simulator(graph)
      latest = null
      sim.onSnapshot((global, nodes) => {
        latest = { global, nodes }
      })
      // If we were running, continue running
      break
    }
  }
}
