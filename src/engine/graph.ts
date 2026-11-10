// Graph topology config: what the user draws on the canvas.

import type { NodeKind } from './core/types'

export interface GraphNodeConfig {
  id: string
  kind: NodeKind
  label: string
  x: number
  y: number
  /** Node-specific config (instances, rps, ttl, pool size...), all editable. */
  config: Record<string, number | boolean | string>
}

export interface GraphEdgeConfig {
  id: string
  from: string
  to: string
  /** Base network latency ms on this link. */
  latencyMs?: number
  /** Packet loss 0..1. */
  packetLoss?: number
}

export interface GraphConfig {
  name: string
  nodes: GraphNodeConfig[]
  edges: GraphEdgeConfig[]
  seed: number
  /** Global latency target used for served_slow. */
  latencyTargetMs: number
}

let idCounter = 0
export function nextId(prefix: string): string {
  idCounter++
  return `${prefix}_${idCounter.toString(36)}`
}

export function findNode(graph: GraphConfig, id: string): GraphNodeConfig | undefined {
  return graph.nodes.find((n) => n.id === id)
}

export function outgoing(graph: GraphConfig, fromId: string): GraphEdgeConfig[] {
  return graph.edges.filter((e) => e.from === fromId)
}
