// Message protocol between the UI (main thread) and the simulation worker.
// Serializable only — no class instances cross the thread boundary.

import type { GraphConfig } from '../engine/graph'
import type { FailureAction, GlobalSnapshot, NodeSnapshot } from '../engine/core/types'

export type UiMessage =
  | { type: 'init'; graph: GraphConfig }
  | { type: 'play' }
  | { type: 'pause' }
  /** Advance exactly one metrics window (100 ms virtual). */
  | { type: 'step' }
  | { type: 'speed'; speed: number }
  | { type: 'reset'; graph?: GraphConfig }
  /** Hot-reconfigure a live node (applies immediately, logged in the engine). */
  | { type: 'patchConfig'; nodeId: string; patch: Record<string, number | boolean | string> }
  | { type: 'failure'; action: FailureAction }
  /** Replace the entire graph (used when nodes/edges are added/removed in build mode). */
  | { type: 'updateGraph'; graph: GraphConfig }

export type WorkerMessage =
  | { type: 'ready'; graph: GraphConfig }
  | { type: 'snapshot'; global: GlobalSnapshot; nodes: NodeSnapshot[] }
  | { type: 'error'; message: string }

export const SPEEDS = [1, 5, 20, 100] as const
export const DEFAULT_SPEED = 5
