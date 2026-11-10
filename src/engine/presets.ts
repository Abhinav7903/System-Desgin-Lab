// Preset graphs for the gallery and tests. Pure data builders.

import type { GraphConfig, GraphEdgeConfig, GraphNodeConfig } from './graph'
import { defaultConfigFor } from './nodes/registry'
import type { NodeKind } from './core/types'

function n(
  id: string,
  kind: NodeKind,
  label: string,
  x: number,
  y: number,
  overrides: Record<string, number | boolean | string> = {},
): GraphNodeConfig {
  return {
    id,
    kind,
    label,
    x,
    y,
    config: { ...defaultConfigFor(kind), label, ...overrides },
  }
}

function e(from: string, to: string, latencyMs = 1): GraphEdgeConfig {
  return { id: `${from}->${to}`, from, to, latencyMs }
}

export interface PresetOptions {
  rps?: number
  latencyTargetMs?: number
  seed?: number
  writeRatio?: number
  /** Per-node-id config overrides, e.g. { pg: { connectionPool: 4 } }. */
  overrides?: Record<string, Record<string, number | boolean | string>>
}

/** Client -> API -> (Redis ->) Postgres. The classic cache-aside stack. */
export function cacheAsidePreset(opts: PresetOptions = {}): GraphConfig {
  const rps = opts.rps ?? 100
  const ov = opts.overrides ?? {}
  const nodes = [
    n('client', 'client', 'Users', 60, 200, { rps, writeRatio: opts.writeRatio ?? 0.1, ...ov.client }),
    n('api', 'api', 'API', 320, 200, ov.api),
    n('redis', 'redis', 'Redis', 580, 120, ov.redis),
    n('pg', 'postgres', 'Postgres', 580, 320, ov.pg),
  ]
  const edges = [
    e('client', 'api'),
    e('api', 'redis', 1),
    e('api', 'pg', 2),
  ]
  return {
    name: 'Cache-aside stack',
    nodes,
    edges,
    seed: opts.seed ?? 42,
    latencyTargetMs: opts.latencyTargetMs ?? 200,
  }
}

/** Client -> API -> Postgres. No cache: shows raw DB load. */
export function noCachePreset(opts: PresetOptions = {}): GraphConfig {
  const g = cacheAsidePreset(opts)
  return {
    ...g,
    name: 'No cache',
    nodes: g.nodes.filter((x) => x.kind !== 'redis'),
    edges: g.edges.filter((x) => x.to !== 'redis' && x.from !== 'redis'),
  }
}

/** Client -> LB -> API x3 -> Redis, Postgres. */
export function loadBalancedPreset(opts: PresetOptions = {}): GraphConfig {
  const g = cacheAsidePreset({ ...opts, rps: opts.rps ?? 1000 })
  const apiOv = opts.overrides?.api
  return {
    ...g,
    name: 'Load balanced',
    nodes: [
      ...g.nodes.filter((x) => x.kind !== 'api'),
      n('api1', 'api', 'API 1', 320, 100, apiOv),
      n('api2', 'api', 'API 2', 320, 200, apiOv),
      n('api3', 'api', 'API 3', 320, 300, apiOv),
    ],
    edges: [
      e('client', 'api1'),
      e('client', 'api2'),
      e('client', 'api3'),
      e('api1', 'redis', 1),
      e('api1', 'pg', 2),
      e('api2', 'redis', 1),
      e('api2', 'pg', 2),
      e('api3', 'redis', 1),
      e('api3', 'pg', 2),
    ],
  }
}

export const PRESETS = [
  { id: 'cache-aside', name: 'With cache', build: cacheAsidePreset, desc: 'Client -> API -> Redis -> Postgres' },
  { id: 'no-cache', name: 'No cache', build: noCachePreset, desc: 'Client -> API -> Postgres (raw DB load)' },
  { id: 'lb', name: 'With LB (3x API)', build: loadBalancedPreset, desc: 'Client fans out to 3 API servers' },
] as const
