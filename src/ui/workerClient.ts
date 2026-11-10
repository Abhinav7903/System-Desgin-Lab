// Thin wrapper around the simulation Web Worker. The store talks to the
// engine only through this module; no engine object ever reaches React.

import type { UiMessage, WorkerMessage } from '../shared/protocol'
import type { GlobalSnapshot, NodeSnapshot } from '../engine/core/types'

export interface WorkerHandlers {
  onSnapshot(global: GlobalSnapshot, nodes: NodeSnapshot[]): void
  onReady(): void
  onError(message: string): void
}

let worker: Worker | null = null

export function startWorker(handlers: WorkerHandlers): void {
  if (worker !== null) return
  worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
    const msg = ev.data
    if (msg.type === 'snapshot') handlers.onSnapshot(msg.global, msg.nodes)
    else if (msg.type === 'ready') handlers.onReady()
    else handlers.onError(msg.message)
  }
  worker.onerror = (ev) => handlers.onError(ev.message)
}

export function sendUi(msg: UiMessage): void {
  worker?.postMessage(msg)
}
