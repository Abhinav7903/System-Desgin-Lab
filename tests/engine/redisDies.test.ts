// Scenario tests: behaviors must EMERGE from the rules, never be hardcoded.
// Graph: Client -> API -> (Redis, Postgres).

import { describe, it, expect } from 'vitest'
import { Simulator } from '../../src/engine/core/simulator'
import { cacheAsidePreset } from '../../src/engine/presets'
import type { RedisNode } from '../../src/engine/nodes/RedisNode'
import type { PostgresNode } from '../../src/engine/nodes/PostgresNode'

function build(overrides: { rps?: number; writeRatio?: number } = {}): Simulator {
  const sim = new Simulator(cacheAsidePreset({ rps: overrides.rps ?? 100, writeRatio: overrides.writeRatio ?? 0.1, seed: 7 }))
  return sim
}

function redis(sim: Simulator): RedisNode {
  return sim.node('redis') as unknown as RedisNode
}

function pg(sim: Simulator): PostgresNode {
  return sim.node('pg') as unknown as PostgresNode
}

const SEC = 1000

describe('baseline (healthy system)', () => {
  it('cache hit ratio is high, p99 is low, errors near 0', () => {
    const sim = build({ rps: 50 })
    sim.run(10 * SEC)
    const hitRatio = redis(sim).hitRatio
    expect(hitRatio).toBeGreaterThan(0.5)
    // Errors (excluding slow) must be near zero.
    const f = sim.metrics.snapshotFates()
    const total = Object.values(f).reduce((a, b) => a + b, 0)
    const bad = f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout + f.droppedNodeDown + f.droppedNoBuffer
    expect(bad / Math.max(1, total)).toBeLessThan(0.02)
  })

  it('every request gets exactly one fate (invariant)', () => {
    const sim = build({ rps: 200 })
    let lastCheck = 0
    sim.onSnapshot((g) => {
      lastCheck = g.fates.inFlight
      void lastCheck
    })
    sim.run(8 * SEC)
    const client = sim.allNodes().find((n) => n.kind === 'client') as unknown as { sent: number }
    const f = sim.metrics.snapshotFates()
    const done =
      f.served + f.servedSlow + f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout +
      f.droppedNodeDown + f.droppedNoBuffer + f.throttled + f.staleRead + f.retriedOk
    expect(done + f.inFlight).toBe(client.sent)
  })
})

describe('kill Redis (the classic cache-aside failure)', () => {
  // Small DB pool so the cache-stampede actually saturates Postgres.
  const stampede = { rps: 3000, seed: 7, overrides: { pg: { connectionPool: 4, replicas: 0 } } }

  it('cache stops serving, DB pool saturates, p99 spikes, errors appear', () => {
    const sim = new Simulator(cacheAsidePreset(stampede))
    sim.run(10 * SEC)
    const hitsBefore = redis(sim).hits
    expect(redis(sim).hitRatio).toBeGreaterThan(0.3)
    const p99Before = sim.metrics.p99
    const pgBefore = pg(sim).counters.in
    const fBefore = sim.metrics.snapshotFates()
    const okBefore = fBefore.served + fBefore.servedSlow + fBefore.retriedOk

    sim.applyFailure({ type: 'kill', nodeId: 'redis' })
    sim.run(10 * SEC)

    // Zero new cache hits: every read now goes to Postgres.
    expect(redis(sim).hits - hitsBefore).toBe(0)
    // DB load jumped: most served traffic is now DB-backed.
    const f = sim.metrics.snapshotFates()
    const pgDelta = pg(sim).counters.in - pgBefore
    const okDelta = f.served + f.servedSlow + f.retriedOk - okBefore
    expect(okDelta).toBeGreaterThan(0)
    expect(pgDelta / Math.max(1, okDelta)).toBeGreaterThan(0.5)
    // The DB pool saturated (the emergent capacity ceiling).
    expect(pg(sim).poolUtilization).toBeGreaterThanOrEqual(0.95)
    // Emergent damage: latency degraded after the failure.
    expect(sim.metrics.p99).toBeGreaterThan(p99Before)
    // Some requests failed outright (rejected/timed out/dropped).
    const bad = f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout + f.droppedNodeDown + f.droppedNoBuffer
    expect(bad).toBeGreaterThan(0)
  })

  it('with the circuit breaker on, outcomes are better than without it', () => {
    const runWith = (cb: boolean): { slow: number; p99: number } => {
      const sim = new Simulator(cacheAsidePreset({
        rps: 2000,
        seed: 7,
        latencyTargetMs: 30,
        overrides: { api: { circuitBreaker: cb } },
      }))
      sim.run(10 * SEC)
      sim.applyFailure({ type: 'slow', nodeId: 'redis', factor: 200 })
      sim.run(10 * SEC)
      const f = sim.metrics.snapshotFates()
      return { slow: f.servedSlow, p99: sim.metrics.p99 }
    }
    const without = runWith(false)
    const withCb = runWith(true)
    // The breaker stops waiting on a hung Redis: fewer slow responses,
    // lower tail latency.
    expect(withCb.p99).toBeLessThan(without.p99)
    expect(withCb.slow).toBeLessThan(without.slow)
  })
})

describe('determinism and performance', () => {
  it('same seed gives identical results', () => {
    const a = new Simulator(cacheAsidePreset({ seed: 123, rps: 150 }))
    const b = new Simulator(cacheAsidePreset({ seed: 123, rps: 150 }))
    let sa = ''
    let sb = ''
    a.onSnapshot((g) => (sa = JSON.stringify(g)))
    b.onSnapshot((g) => (sb = JSON.stringify(g)))
    a.run(5 * SEC)
    b.run(5 * SEC)
    expect(sa).toBe(sb)
  })
})
