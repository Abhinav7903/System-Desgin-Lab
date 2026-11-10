// Lesson schema: lessons are DATA, not code.
// Each lesson: Story -> Think first -> Build -> Test -> Debrief -> Compare -> Quiz.

import type { GraphConfig } from '../graph'

export type Difficulty = 'beginner' | 'intermediate' | 'advanced'

export interface Requirement {
  functional: string[]
  traffic: {
    writesPerSec: number
    readsPerSec: number
  }
  targets: {
    p99LatencyMs: number
    availability: string
  }
}

export interface ThinkFirstQuestion {
  q: string
  hint?: string
  answerNotes: string
}

export interface ScenarioConfig {
  durationSec: number
  rps?: number
  pattern?: 'constant' | 'ramp' | 'burst' | 'spike' | 'wave'
  writeRatio?: number
  failures?: Array<{
    atSec: number
    action: import('../core/types').FailureAction
  }>
}

export interface Assertion {
  metric: 'p99' | 'errorRate' | 'throughput' | 'hitRatio' | 'lostRequests' | 'servedPercent'
  op: 'lt' | 'gt' | 'lte' | 'gte' | 'eq'
  value: number
  message: string
}

export interface Checkpoint {
  name: string
  scenario: ScenarioConfig
  pass: Assertion[]
}

export interface Lesson {
  id: string
  title: string
  difficulty: Difficulty
  story: string
  requirements: Requirement
  allowedComponents: string[]
  thinkFirstQuestions: ThinkFirstQuestion[]
  checkpoints: Checkpoint[]
  hints: string[]
  referenceSolution: GraphConfig
  quiz: QuizQuestion[]
}

export interface QuizQuestion {
  q: string
  options: string[]
  answerIndex: number
  explanation: string
}