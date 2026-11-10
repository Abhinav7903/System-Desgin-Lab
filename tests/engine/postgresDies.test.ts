// Scenario tests: Postgres primary/replica failures. Behaviors emerge from
// the node rules (routing, election delay, replication lag) — never scripted.

import { describe, it, expect } from 'vitest'
import { Simulator } from '../../src/engine/core/simulator'
import { cacheAsidePreset } from '../../src/engine/presets'
import { PostgresNode } from '../../src/engine/nodes/PostgresNode'

const SEC = 1000

function errorsBetween(sim: Simulator, fromMs: number, toMs: number): number {
  let sum = 0
  for (const w of sim.metrics.history) {
    if (w.at > fromMs && w.at <= toMs) sum += w.errors
  }
  return sum
}

function served(f: ReturnType<Simulator['metrics']['snapshotFates']>): number {
  return f.served + f.servedSlow + f.retriedOk
}

/** Cache-aside stack with a small, healthy DB and no client retries so write
 *  failures surface directly instead of being masked by retries. */
function dbPreset(pg: Record<string, number | boolean>): Simulator {
  return new Simulator(
    cacheAsidePreset({
      seed: 21,
      rps: 400,
      latencyTargetMs: 200,
      writeRatio: 0.3,
      overrides: {
        client: { maxRetries: 0 },
        pg: { replicas: 2, failover: false, replicationLagMs: 500, ...pg },
      },
    }),
  )
}

describe('Postgres primary dies without failover', () => {
  it('writes fail, reads keep serving from replicas (stale)', () => {
    const sim = dbPreset({ failover: false })
    sim.run(5 * SEC)
    const pg = sim.node('pg') as PostgresNode
    const f0 = sim.metrics.snapshotFates()
    expect(f0.droppedNodeDown).toBe(0) // healthy before the kill

    sim.applyFailure({ type: 'kill', nodeId: 'pg', machineIndex: 0 })
    sim.run(3 * SEC)

    const f1 = sim.metrics.snapshotFates()
    // Writes fail: no promotion is configured, the primary stays down.
    expect(f1.droppedNodeDown).toBeGreaterThan(f0.droppedNodeDown)
    expect(pg.primary?.phase).toBe('down')
    // Reads continue on the remaining replicas — at ~70% of traffic.
    const readsServed = served(f1) - served(f0)
    expect(readsServed).toBeGreaterThan(600)
    expect(readsServed).toBeGreaterThan(f1.droppedNodeDown - f0.droppedNodeDown)
    // Without a primary there is no one to replicate to: replica data is stale.
    expect(pg.staleReads).toBeGreaterThan(0)
    expect(pg.replicasUp.length).toBe(2)
  })
})

describe('Postgres primary dies with failover', () => {
  it('writes fail during the election, then a replica is promoted (lag loses writes)', () => {
    const sim = dbPreset({ failover: true, electionMs: 3000, replicationLagMs: 1000 })
    sim.run(5 * SEC)
    const pg = sim.node('pg') as PostgresNode
    const before = sim.metrics.snapshotFates()

    sim.applyFailure({ type: 'kill', nodeId: 'pg', machineIndex: 0 })
    sim.run(2 * SEC) // t=7: election in progress (ends ~t=8)
    const during = errorsBetween(sim, 5 * SEC, 7 * SEC)
    expect(during).toBeGreaterThan(0) // writes rejected while electing

    sim.run(3 * SEC) // t=10: new primary is up and serving writes
    expect(errorsBetween(sim, 9 * SEC, 10 * SEC)).toBe(0)
    expect(pg.primary?.phase).toBe('healthy')
    expect(pg.primary?.label).toContain('primary')
    // The promoted replica was behind: recent writes are lost.
    expect(pg.lostWritesCount).toBeGreaterThan(0)

    // Overall throughput recovered well beyond the election damage.
    const after = sim.metrics.snapshotFates()
    expect(served(after) - served(before)).toBeGreaterThan(0)
  })
})

describe('Postgres read replica dies', () => {
  it('reads reroute to the remaining replicas with zero errors', () => {
    const sim = dbPreset({ failover: false, replicas: 2 })
    sim.run(5 * SEC)
    const pg = sim.node('pg') as PostgresNode
    expect(pg.replicasUp.length).toBe(2)

    sim.applyFailure({ type: 'kill', nodeId: 'pg', machineIndex: 1 })
    sim.run(SEC) // let routing notice the dead replica
    expect(pg.replicasUp.length).toBe(1)

    const f0 = sim.metrics.snapshotFates()
    sim.run(2 * SEC)
    const f1 = sim.metrics.snapshotFates()
    // Reads keep flowing at full rate; nothing is dropped.
    expect(served(f1) - served(f0)).toBeGreaterThan(600)
    expect(f1.droppedNodeDown).toBe(f0.droppedNodeDown)
    expect(f1.rejectedQueueFull).toBe(f0.rejectedQueueFull)
  })
})
