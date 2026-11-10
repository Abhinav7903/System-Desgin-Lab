// Scenario tests: traffic spikes, autoscaling, and retry storms. Behaviors
// emerge from the rules (bounded queues + resource contention), never scripted.

import { describe, it, expect } from 'vitest'
import { Simulator } from '../../src/engine/core/simulator'
import { cacheAsidePreset } from '../../src/engine/presets'
import type { FateCounts } from '../../src/engine/core/types'

const SEC = 1000

function badFates(f: FateCounts): number {
  return f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout + f.droppedNodeDown + f.droppedNoBuffer
}

/** Sum of per-window error counts between two virtual times. */
function errorsBetween(sim: Simulator, fromMs: number, toMs: number): number {
  let sum = 0
  for (const w of sim.metrics.history) {
    if (w.at > fromMs && w.at <= toMs) sum += w.errors
  }
  return sum
}

describe('traffic spike', () => {
  it('10x spike: queues fill, requests rejected, latency rises, then recovers', () => {
    const sim = new Simulator(cacheAsidePreset({ seed: 11, rps: 1000, latencyTargetMs: 50 }))
    sim.run(5 * SEC)
    const p99Before = sim.metrics.p99
    const badBefore = badFates(sim.metrics.snapshotFates())

    // 10x spike for 5 seconds.
    sim.applyFailure({ type: 'spike', clientId: 'client', factor: 10, durationMs: 5 * SEC })
    sim.run(3 * SEC) // t=8, spike active t=5..10
    const fDuring = sim.metrics.snapshotFates()
    const badDuring = badFates(fDuring)
    expect(badDuring - badBefore).toBeGreaterThan(0)
    expect(sim.metrics.p99).toBeGreaterThan(p99Before)
    const errorsDuring = errorsBetween(sim, 6 * SEC, 8 * SEC)
    expect(errorsDuring).toBeGreaterThan(0)

    // Spike ends at t=10; run past it so the system drains.
    sim.run(8 * SEC) // t=16
    const errorsAfter = errorsBetween(sim, 14 * SEC, 16 * SEC)
    expect(errorsAfter).toBeLessThan(errorsDuring)
    // In-flight drained back to near-idle levels.
    expect(sim.metrics.snapshotFates().inFlight).toBeLessThan(100)
  })

  it('autoscaling recovers capacity after the boot/warm-up delay', () => {
    // Autoscale delay 2s; the API instance type (small) boots in 30s, so
    // recovery can only appear well after the trigger — like real clouds.
    const sim = new Simulator(cacheAsidePreset({
      seed: 11,
      rps: 1500,
      latencyTargetMs: 50,
      overrides: {
        api: { autoscale: true, autoscaleMax: 4, autoscaleDelayMs: 2 * SEC, queueSize: 512 },
      },
    }))
    sim.run(5 * SEC)
    // 6x spike that outlasts the boot time: only added capacity can save it.
    sim.applyFailure({ type: 'spike', clientId: 'client', factor: 6, durationMs: 60 * SEC })
    sim.run(3 * SEC) // t=8: peak overload on one instance
    const peakErrors = errorsBetween(sim, 6 * SEC, 8 * SEC)
    expect(peakErrors).toBeGreaterThan(0)

    const api = sim.node('api') as unknown as { machines: unknown[] }
    expect(api.machines.length).toBeGreaterThan(1)

    // Run past all boot/warm-up delays (instances added ~every 2s, each
    // boots 30s: instances 2..4 are up by ~t=41).
    sim.run(42 * SEC) // t=50
    const lateErrors = errorsBetween(sim, 48 * SEC, 50 * SEC)
    // With 3-4 instances the excess is absorbed: near-zero rejections.
    expect(lateErrors).toBeLessThan(peakErrors)
    const f = sim.metrics.snapshotFates()
    expect(badFates(f)).toBeGreaterThan(0) // the spike did hurt before scaling
  })
})

describe('retry storm', () => {
  it('retries without backoff make a transient overload worse than with backoff', () => {
    const runWith = (backoff: boolean): number => {
      const sim = new Simulator(cacheAsidePreset({
        seed: 11,
        rps: 1200,
        latencyTargetMs: 50,
        overrides: {
          client: { maxRetries: 3, backoff, retryDelayMs: backoff ? 100 : 5 },
          pg: { connectionPool: 4, replicas: 0 },
        },
      }))
      sim.run(5 * SEC)
      // A short 10x spike: requests fail, clients retry into the mess.
      sim.applyFailure({ type: 'spike', clientId: 'client', factor: 10, durationMs: 2 * SEC })
      sim.run(3 * SEC)
      return badFates(sim.metrics.snapshotFates())
    }
    const withBackoff = runWith(true)
    const withoutBackoff = runWith(false)
    // Immediate retries pile duplicate load onto the saturated queue: more
    // requests end in a bad fate than with exponential backoff + jitter.
    expect(withoutBackoff).toBeGreaterThan(withBackoff)
  })
})
