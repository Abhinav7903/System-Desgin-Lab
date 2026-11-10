// Lesson 1: Single Server to Scale
// Start with one server, learn why it fails under load, then add components.

import type { Lesson } from '../schema'
import { loadBalancedPreset } from '../../presets'

export const lesson1: Lesson = {
  id: 'single-server-to-scale',
  title: 'Single Server to Scale',
  difficulty: 'beginner',
  story: `You're launching a new API service. The team wants to start simple: a single server handling all requests.

But as traffic grows, the server struggles. Requests queue up, latency spikes, and eventually requests are dropped entirely.

Your job: understand WHY a single server fails, then progressively add components (load balancer, cache, database replicas) to handle 10x the load with <100ms p99.`,
  requirements: {
    functional: [
      'Handle 1,000 RPS with 10% writes',
      'Serve reads from cache when possible',
      'Persist writes to database',
    ],
    traffic: {
      writesPerSec: 100,
      readsPerSec: 900,
    },
    targets: {
      p99LatencyMs: 100,
      availability: '99.9%',
    },
  },
  allowedComponents: ['client', 'api', 'redis', 'postgres', 'loadbalancer'],
  thinkFirstQuestions: [
    {
      q: 'With a single API server at 1000 RPS, what resource runs out first: CPU, memory, or connections?',
      hint: 'Check the instance type: 2 vCPU, 8 threads. Each request takes ~0.5ms CPU.',
      answerNotes: 'At 1000 RPS × 0.5ms = 500ms CPU per second. With 2 vCPU × 8 threads, theoretical capacity is ~32,000 RPS. But the bounded queue (256) and connection limits will bottleneck first.',
    },
    {
      q: 'What happens to latency as the queue fills up?',
      hint: 'Think about queueing theory - not a formula, but the actual mechanism.',
      answerNotes: 'Each request waits for threads ahead of it to complete. Latency grows linearly with queue depth, then explodes when queue is full and requests are rejected.',
    },
    {
      q: 'If the database has 20 connections but the API has 8 threads × 3 instances = 24 threads, what happens?',
      hint: 'Connection pool exhaustion is a distinct fate from queue full.',
      answerNotes: 'API threads will block waiting for DB connections. You\'ll see "rejected_pool_exhausted" fate even if API queue has space.',
    },
  ],
  checkpoints: [
    {
      name: 'Baseline: Single server at 100 RPS',
      scenario: {
        durationSec: 10,
        rps: 100,
        pattern: 'constant',
        writeRatio: 0.1,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 50, message: 'p99 should be under 50ms at low load' },
        { metric: 'errorRate', op: 'eq', value: 0, message: 'Zero errors at baseline' },
      ],
    },
    {
      name: 'Single server at 1000 RPS (target load)',
      scenario: {
        durationSec: 15,
        rps: 1000,
        pattern: 'constant',
        writeRatio: 0.1,
      },
      pass: [
        { metric: 'p99', op: 'gt', value: 100, message: 'p99 should exceed 100ms - single server cannot handle this' },
        { metric: 'errorRate', op: 'gt', value: 0.01, message: 'Errors should appear (queue full or pool exhausted)' },
      ],
    },
    {
      name: 'Add load balancer + 3 API servers',
      scenario: {
        durationSec: 15,
        rps: 1000,
        pattern: 'constant',
        writeRatio: 0.1,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 50, message: 'p99 should be under 50ms with 3x API' },
        { metric: 'errorRate', op: 'eq', value: 0, message: 'Zero errors with load balanced API' },
      ],
    },
    {
      name: 'Add Redis cache (cache-aside pattern)',
      scenario: {
        durationSec: 15,
        rps: 1000,
        pattern: 'constant',
        writeRatio: 0.1,
      },
      pass: [
        { metric: 'hitRatio', op: 'gt', value: 0.8, message: 'Cache hit ratio should exceed 80%' },
        { metric: 'p99', op: 'lt', value: 30, message: 'p99 should drop further with cache' },
      ],
    },
    {
      name: 'Traffic spike: 5x for 10 seconds',
      scenario: {
        durationSec: 30,
        rps: 1000,
        pattern: 'constant',
        writeRatio: 0.1,
        failures: [
          { atSec: 10, action: { type: 'spike', clientId: 'client', factor: 5, durationMs: 10000 } },
        ],
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 200, message: 'p99 should stay under 200ms during spike' },
        { metric: 'servedPercent', op: 'gte', value: 0.95, message: 'At least 95% of requests served' },
      ],
    },
  ],
  hints: [
    'Start with the "No cache" preset to see raw DB load',
    'Use "With cache" preset to see cache-aside in action',
    'Use "With LB (3x API)" to see horizontal scaling',
    'Watch the queue depth on the API node - that\'s your bottleneck indicator',
    'Kill Redis during the spike to see the "cache stampede" effect',
  ],
  referenceSolution: loadBalancedPreset({
    rps: 1000,
    writeRatio: 0.1,
    latencyTargetMs: 100,
  }),
  quiz: [
    {
      q: 'What is the PRIMARY cause of request failures when a single server\'s queue is full?',
      options: [
        'CPU saturation',
        'Memory exhaustion',
        'Bounded queue backpressure (rejected_queue_full)',
        'Network bandwidth',
      ],
      answerIndex: 2,
      explanation: 'When the queue is full, new requests are immediately rejected with fate "rejected_queue_full" - this is backpressure, not resource exhaustion.',
    },
    {
      q: 'How does adding a load balancer with 3 API servers improve throughput?',
      options: [
        'Each server gets 1/3 the traffic, so queue depth stays lower',
        'Load balancer caches responses',
        'Load balancer compresses requests',
        'Database connections are shared',
      ],
      answerIndex: 0,
      explanation: 'The LB distributes requests round-robin. Each API server sees ~333 RPS instead of 1000, keeping queues shallow and latency low.',
    },
    {
      q: 'In cache-aside pattern, what happens on a cache miss?',
      options: [
        'Request fails immediately',
        'Request goes to database, then cache is populated',
        'Request waits for cache to warm up',
        'Load balancer retries another cache node',
      ],
      answerIndex: 1,
      explanation: 'Cache-aside: on miss, API queries DB, then writes result to cache for next time. This is why the first request after a miss is slower.',
    },
    {
      q: 'What is a "cache stampede" and how does it happen?',
      options: [
        'Too many requests hit the cache at once',
        'Cache dies, all traffic floods the database simultaneously',
        'Cache keys are too large',
        'Cache eviction policy removes hot keys',
      ],
      answerIndex: 1,
      explanation: 'When Redis dies, all read traffic that would have been cache hits now goes directly to Postgres. The sudden DB load spike can overwhelm it.',
    },
  ],
}