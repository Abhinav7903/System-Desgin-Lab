// Lesson index and runner

import type { Lesson, Checkpoint, ScenarioConfig, Assertion } from './schema'
import { lesson1 } from './data/lesson1'
import { lesson2 } from './data/lesson2'
import { lesson3 } from './data/lesson3'
import { Simulator } from '../core/simulator'
import type { GlobalSnapshot } from '../core/types'

export type { Lesson, Checkpoint, ScenarioConfig, Assertion }

export const LESSONS: Lesson[] = [lesson1, lesson2, lesson3]

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id)
}

export function getAllLessons(): Lesson[] {
  return LESSONS
}

// Run a single checkpoint scenario and return pass/fail
export async function runCheckpoint(
  lesson: Lesson,
  checkpoint: Checkpoint
): Promise<{ passed: boolean; results: AssertionResult[]; snapshots: GlobalSnapshot[] }> {
  const scenario = checkpoint.scenario
  const sim = new Simulator(lesson.referenceSolution, {
    windowMs: 100,
  })

  // Apply scenario config
  const clientNode = sim.node('client') as any
  if (clientNode) {
    clientNode.config.rps = scenario.rps ?? 1000
    clientNode.config.writeRatio = scenario.writeRatio ?? 0.1
    clientNode.config.pattern = scenario.pattern ?? 'constant'
  }

  // Run scenario
  const snapshots: GlobalSnapshot[] = []

  sim.onSnapshot((g) => {
    snapshots.push(g)
  })

  // Apply scheduled failures (note: virtual time scheduling would be needed for real implementation)
  if (scenario.failures) {
    for (const f of scenario.failures) {
      // Simplified: apply at the beginning for now
      sim.applyFailure(f.action)
    }
  }

  // Run simulation
  sim.run(scenario.durationSec * 1000)

  // Evaluate assertions
  const finalSnapshot = snapshots[snapshots.length - 1]
  if (!finalSnapshot) {
    return { passed: false, results: [], snapshots }
  }
  const results = checkpoint.pass.map((assertion) => {
    const actual = getMetricValue(finalSnapshot, assertion.metric)
    const passed = evaluateAssertion(actual, assertion.op, assertion.value)
    return {
      assertion,
      actual,
      passed,
    }
  })

  const allPassed = results.every((r) => r.passed)

  return { passed: allPassed, results, snapshots }
}

function getMetricValue(snapshot: GlobalSnapshot, metric: string): number {
  switch (metric) {
    case 'p99':
      return snapshot.p99
    case 'errorRate':
      return snapshot.errorRate
    case 'throughput':
      return snapshot.rps
    case 'servedPercent': {
      const f = snapshot.fates
      const total = f.served + f.servedSlow + f.rejectedQueueFull + f.rejectedPoolExhausted +
        f.timeout + f.droppedNodeDown + f.droppedNoBuffer + f.throttled + f.staleRead + f.retriedOk
      return total > 0 ? (f.served + f.servedSlow + f.retriedOk) / total : 1
    }
    case 'hitRatio': {
      // Need to get from node snapshots - simplified
      return 0
    }
    case 'lostRequests': {
      const f = snapshot.fates
      return f.droppedNoBuffer
    }
    default:
      return 0
  }
}

function evaluateAssertion(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case 'lt': return actual < expected
    case 'gt': return actual > expected
    case 'lte': return actual <= expected
    case 'gte': return actual >= expected
    case 'eq': return Math.abs(actual - expected) < 0.001
    default: return false
  }
}

export interface AssertionResult {
  assertion: Assertion
  actual: number
  passed: boolean
}