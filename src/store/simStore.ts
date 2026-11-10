// UI state: the drawn graph, run controls, and the latest worker snapshots.
// Positions are React Flow coordinates; the graph doubles as the save format.

import { create } from 'zustand'
import { PRESETS } from '../engine/presets'
import type { GraphConfig } from '../engine/graph'
import type { GlobalSnapshot, NodeSnapshot } from '../engine/core/types'
import { DEFAULT_SPEED } from '../shared/protocol'
import { sendUi } from '../ui/workerClient'
import { getLesson } from '../engine/lessons/runner'
import { getDesigns, saveDesign, getLessonProgress, saveLessonProgress, getSettings, saveSettings, deleteDesign } from '../ui/lib/persistence'

export type PresetId = (typeof PRESETS)[number]['id']

export type AppMode = 'build' | 'demo'

interface SimStore {
  graph: GraphConfig
  presetId: PresetId
  running: boolean
  speed: number
  connected: boolean
  /** Latest global window snapshot. */
  global: GlobalSnapshot | null
  nodes: Record<string, NodeSnapshot>
  /** Per-node request rate derived from counter deltas (req/s). */
  nodeRps: Record<string, number>
  /** Previous cumulative inbound counter + snapshot time, for rate deltas. */
  prevIn: Record<string, { in: number; at: number }>
  selectedId: string | null
  /** Current lesson ID if in lesson mode. */
  lessonId: string | null
  /** Whether lesson player is open. */
  lessonOpen: boolean
  /** App mode: build (drag-drop) or demo (preset scenarios) */
  mode: AppMode
  /** Design management */
  designName: string
  savedDesigns: import('../ui/lib/persistence').SavedDesign[]
  settings: import('../ui/lib/persistence').Settings

  applySnapshot(g: GlobalSnapshot, nodes: NodeSnapshot[]): void
  markConnected(): void

  setPreset(id: PresetId): void
  resetRun(): void
  toggleRunning(): void
  step(): void
  setSpeed(speed: number): void
  setRps(rps: number): void
  setNodePosition(id: string, x: number, y: number): void
  select(id: string | null): void
  setGraph(graph: GraphConfig): void
  setMode(mode: AppMode): void

  patchNodeConfig(nodeId: string, patch: Record<string, number | boolean | string>): void
  killNode(nodeId: string, machineIndex?: number): void
  restartNode(nodeId: string, machineIndex?: number): void
  startLesson(lessonId: string): void
  closeLesson(): void

  // Design management
  loadDesigns(): void
  saveCurrentDesign(name?: string): void
  loadDesign(id: string): void
  deleteDesign(id: string): void
  setDesignName(name: string): void
  newDesign(): void

  // Lesson progress
  saveLessonProgress(lessonId: string, progress: any): void
  loadLessonProgress(lessonId: string): any

  // Settings
  loadSettings(): void
  updateSettings(settings: Partial<import('../ui/lib/persistence').Settings>): void
}

const initialPreset = PRESETS[0]!

function presetGraph(id: PresetId): GraphConfig {
  const p = PRESETS.find((x) => x.id === id) ?? initialPreset
  return p.build()
}

export const useSimStore = create<SimStore>((set, get) => ({
  graph: presetGraph(initialPreset.id),
  presetId: initialPreset.id,
  running: false,
  speed: DEFAULT_SPEED,
  connected: false,
  global: null,
  nodes: {},
  nodeRps: {},
  prevIn: {},
  selectedId: null,
  lessonId: null,
  lessonOpen: false,
  mode: 'demo' as AppMode,
  designName: 'Untitled Design',
  savedDesigns: [],
  settings: { theme: 'dark', speed: DEFAULT_SPEED, showNodeLabels: true, showEdgeAnimation: true, autoSave: true, soundEnabled: false },

  applySnapshot(g, nodes) {
    const prev = get().prevIn
    const nodeRps: Record<string, number> = {}
    const prevIn: Record<string, { in: number; at: number }> = {}
    const next: Record<string, NodeSnapshot> = {}
    for (const n of nodes) {
      next[n.id] = n
      const before = prev[n.id]
      if (before !== undefined && g.at > before.at) {
        const dtSec = (g.at - before.at) / 1000
        nodeRps[n.id] = Math.max(0, (n.counters.in - before.in) / dtSec)
      } else {
        nodeRps[n.id] = 0
      }
      prevIn[n.id] = { in: n.counters.in, at: g.at }
    }
    set({ global: g, nodes: next, nodeRps, prevIn })
  },

  markConnected() {
    set({ connected: true })
  },

  setPreset(id) {
    const graph = presetGraph(id)
    set({ graph, presetId: id, global: null, nodes: {}, nodeRps: {}, prevIn: {}, selectedId: null, running: true })
    sendUi({ type: 'reset', graph })
    sendUi({ type: 'play' })
  },

  resetRun() {
    set({ global: null, nodes: {}, nodeRps: {}, prevIn: {}, running: true })
    sendUi({ type: 'reset', graph: get().graph })
    sendUi({ type: 'play' })
  },

  toggleRunning() {
    const running = !get().running
    set({ running })
    sendUi({ type: running ? 'play' : 'pause' })
  },

  step() {
    set({ running: false })
    sendUi({ type: 'step' })
  },

  setSpeed(speed) {
    set({ speed })
    sendUi({ type: 'speed', speed })
  },

  setRps(rps) {
    const graph = get().graph
    const client = graph.nodes.find((n) => n.kind === 'client')
    if (client === undefined) return
    client.config = { ...client.config, rps }
    set({ graph: { ...graph } })
    sendUi({ type: 'patchConfig', nodeId: client.id, patch: { rps } })
  },

  setNodePosition(id, x, y) {
    const graph = get().graph
    const node = graph.nodes.find((n) => n.id === id)
    if (node === undefined) return
    node.x = x
    node.y = y
  },

  select(id) {
    set({ selectedId: id })
  },

  setGraph(newGraph: GraphConfig) {
    set({ graph: newGraph })
  },

  patchNodeConfig(nodeId, patch) {
    const graph = get().graph
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (node !== undefined) node.config = { ...node.config, ...patch }
    set({ graph: { ...graph } })
    sendUi({ type: 'patchConfig', nodeId, patch })
  },

  killNode(nodeId, machineIndex) {
    sendUi({ type: 'failure', action: { type: 'kill', nodeId, machineIndex } })
  },

  restartNode(nodeId, machineIndex) {
    sendUi({ type: 'failure', action: { type: 'restart', nodeId, machineIndex } })
  },

  startLesson(lessonId: string) {
    const lesson = getLesson(lessonId)
    if (!lesson) return
    set({ lessonId, lessonOpen: true, graph: lesson.referenceSolution, presetId: 'lb', running: false })
    sendUi({ type: 'reset', graph: lesson.referenceSolution })
  },

  closeLesson() {
    set({ lessonId: null, lessonOpen: false })
  },

  setMode(mode: AppMode) {
    set({ mode })
    // In build mode, stop the simulation and clear snapshots
    if (mode === 'build') {
      set({ running: false, global: null, nodes: {}, nodeRps: {}, prevIn: {} })
      sendUi({ type: 'pause' })
    } else {
      // In demo mode, load the preset
      const graph = presetGraph(get().presetId)
      set({ graph, running: false })
      sendUi({ type: 'reset', graph })
    }
  },

  // Design management
  loadDesigns() {
    set({ savedDesigns: getDesigns() })
  },

  saveCurrentDesign(name?: string) {
    const graph = get().graph
    const saved = saveDesign({ name: name || get().designName || 'Untitled', graph })
    set({ designName: saved.name, savedDesigns: getDesigns() })
  },

  loadDesign(id: string) {
    const designs = getDesigns()
    const design = designs.find((d: any) => d.id === id)
    if (!design) return
    set({ graph: design.graph, designName: design.name, presetId: 'lb', running: false })
    sendUi({ type: 'reset', graph: design.graph })
  },

  deleteDesign(id: string) {
    deleteDesign(id)
    set({ savedDesigns: getDesigns() })
  },

  setDesignName(name: string) {
    set({ designName: name })
  },

  newDesign() {
    const graph = presetGraph(initialPreset.id)
    set({ graph, designName: 'Untitled Design', presetId: initialPreset.id, running: false })
    sendUi({ type: 'reset', graph })
  },

  // Lesson progress
  saveLessonProgress(lessonId: string, progress: any) {
    saveLessonProgress(lessonId, progress)
  },

  loadLessonProgress(lessonId: string) {
    return getLessonProgress(lessonId)
  },

  // Settings
  loadSettings() {
    set({ settings: getSettings() })
  },

  updateSettings(settings: Partial<import('../ui/lib/persistence').Settings>) {
    const updated = saveSettings(settings)
    set({ settings: updated })
  },
}))
