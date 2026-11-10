// Performance and determinism of the engine — runs in its own worker file
// so JIT inline caches are clean (like a fresh browser Web Worker).
//
// Timing on dev machines is unreliable: sustained load triggers CPU thermal/
// power throttling (verified: identical deterministic work measured 1.3s
// wall when cool, 4-6s when throttled). So the STRONG assertions here are
// deterministic (work counts + event volume), and time is a generous budget
// that still proves "much faster than real time".

// Local ambient declaration (avoids a @types/node dev dependency): the test
// runner is Node, and CPU time is less noisy than wall clock.
declare const process: {
  cpuUsage(prev?: { user: number; system: number }): { user: number; system: number }
}

import { describe, it, expect } from 'vitest'
import { Simulator } from '../../src/engine/core/simulator'
import { cacheAsidePreset } from '../../src/engine/presets'

const SEC = 1000

describe('performance', () => {
  it('60 virtual seconds at 10k RPS: deterministic work, bounded event volume, well under real time', () => {
    // Warm the JIT with short runs first (workers are long-lived in prod).
    for (let i = 0; i < 3; i++) {
      new Simulator(cacheAsidePreset({ seed: 5, rps: 10_000 })).run(4 * SEC)
    }
    const sim = new Simulator(cacheAsidePreset({ seed: 5, rps: 10_000 }))
    const c0 = process.cpuUsage()
    const t0 = performance.now()
    sim.run(60 * SEC)
    const cpuMs = (() => {
      const cpu = process.cpuUsage(c0)
      return (cpu.user + cpu.system) / 1000
    })()
    const wallMs = performance.now() - t0

    const f = sim.metrics.snapshotFates()
    const done =
      f.served + f.servedSlow + f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout +
      f.droppedNodeDown + f.droppedNoBuffer + f.throttled + f.staleRead + f.retriedOk
    const sent = done + f.inFlight
    // ~600k requests must have been issued and fully accounted.
    expect(sent).toBeGreaterThan(590_000)
    expect(sent).toBeLessThan(610_000)

    // Event volume is deterministic per seed and bounded: ~3.9 events per
    // request normally. A self-perpetuating retry/dispatch loop (the class
    // of bug we guard against) explodes this to ~150+ per request.
    const perRequest = sim.scheduledEvents / sent
    expect(perRequest).toBeLessThan(20)

    // Time budget: clean-machine wall is ~1.4s; even a thermally throttled
    // dev CPU must stay far below the 60s of simulated traffic.
    // Increased budget because vitest runs tests sequentially in same process
    // after other heavy tests may have thermally throttled the CPU.
    console.log(`perf: wall=${Math.round(wallMs)}ms cpu=${Math.round(cpuMs)}ms events=${sim.scheduledEvents}`)
    expect(wallMs).toBeLessThan(60_000)
    expect(cpuMs).toBeLessThan(30_000)
  })
})

describe('determinism', () => {
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

  it('a different seed gives different results', () => {
    const a = new Simulator(cacheAsidePreset({ seed: 1, rps: 150 }))
    const b = new Simulator(cacheAsidePreset({ seed: 2, rps: 150 }))
    let sa = ''
    let sb = ''
    a.onSnapshot((g) => (sa = JSON.stringify(g)))
    b.onSnapshot((g) => (sb = JSON.stringify(g)))
    a.run(5 * SEC)
    b.run(5 * SEC)
    expect(sa).not.toBe(sb)
  })
})
