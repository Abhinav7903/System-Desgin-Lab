// Lesson 3: Rate Limiter
// Build a distributed rate limiter - token bucket, sliding window, key-based.

import type { Lesson } from '../schema'
import { loadBalancedPreset } from '../../presets'

export const lesson3: Lesson = {
  id: 'rate-limiter',
  title: 'Distributed Rate Limiter',
  difficulty: 'advanced',
  story: `Build a rate limiter for a public API. Requirements:
- 1000 requests/second per API key (configurable)
- Burst allowance: 100 requests
- Support 100K active API keys
- Latency overhead < 1ms p99
- Survive Redis failure (fail open or fail closed?)
- Distributed: multiple API instances share limit state

This is a classic distributed systems problem - how to enforce limits across multiple machines.`,
  requirements: {
    functional: [
      'Enforce per-key rate limit (token bucket)',
      'Allow burst up to configured allowance',
      'Return 429 with retry-after header when limited',
      'Track limit state across all API instances',
    ],
    traffic: {
      writesPerSec: 0, // Rate limiting is a check, not a write
      readsPerSec: 50_000,
    },
    targets: {
      p99LatencyMs: 1,
      availability: '99.99%',
    },
  },
  allowedComponents: ['client', 'api', 'redis', 'postgres', 'loadbalancer', 'ratelimiter'],
  thinkFirstQuestions: [
    {
      q: 'Token bucket vs sliding window: which allows bursts better?',
      hint: 'Token bucket accumulates tokens over time; sliding window counts recent requests',
      answerNotes: 'Token bucket naturally allows bursts (up to bucket capacity). Sliding window is stricter - it counts exact requests in the window.',
    },
    {
      q: 'How do you share rate limit state across 5 API instances?',
      hint: 'Centralized Redis vs local with sync',
      answerNotes: 'Centralized Redis: all instances read/write same keys. Consistent but adds latency. Local with periodic sync: faster but eventual consistency.',
    },
    {
      q: 'Redis fails - fail open (allow all) or fail closed (deny all)?',
      hint: 'Depends on threat model. Public API vs internal service.',
      answerNotes: 'Fail open: if limiter is down, allow traffic (better availability, risk abuse). Fail closed: deny all (secure, but outage = total block). Most public APIs fail open with local fallback.',
    },
    {
      q: 'With 100K active keys and 1000 RPS each, how many tokens/second to refill?',
      hint: 'Total refill rate = keys × rate per key',
      answerNotes: '100K × 1000 = 100M tokens/second refill. Redis can handle this, but you need efficient Lua script or Redis module to avoid round trips per request.',
    },
  ],
  checkpoints: [
    {
      name: 'Token bucket limiter at 10K RPS',
      scenario: {
        durationSec: 15,
        rps: 10000,
        pattern: 'constant',
        writeRatio: 0,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 1, message: 'Rate limiter overhead < 1ms' },
        { metric: 'servedPercent', op: 'gte', value: 0.9, message: '90%+ requests allowed (under limit)' },
      ],
    },
    {
      name: 'Burst test: spike to 5x for 5 seconds',
      scenario: {
        durationSec: 20,
        rps: 2000,
        pattern: 'constant',
        writeRatio: 0,
        failures: [
          { atSec: 5, action: { type: 'spike', clientId: 'client', factor: 5, durationMs: 5000 } },
        ],
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 2, message: 'Limiter stays fast during burst' },
        { metric: 'servedPercent', op: 'lt', value: 0.5, message: 'Burst requests get throttled' },
      ],
    },
    {
      name: 'Redis failure: fail-open behavior',
      scenario: {
        durationSec: 30,
        rps: 5000,
        pattern: 'constant',
        writeRatio: 0,
        failures: [
          { atSec: 10, action: { type: 'kill', nodeId: 'redis' } },
        ],
      },
      pass: [
        { metric: 'servedPercent', op: 'gt', value: 0.9, message: 'Fail open: traffic continues' },
        { metric: 'p99', op: 'lt', value: 1, message: 'No latency spike on limiter failure' },
      ],
    },
    {
      name: 'Hot key: one API key at 10x limit',
      scenario: {
        durationSec: 15,
        rps: 5000,
        pattern: 'constant',
        writeRatio: 0,
        // Simulated by client config with hotKey distribution
      },
      pass: [
        { metric: 'servedPercent', op: 'lt', value: 0.2, message: 'Hot key gets throttled' },
      ],
    },
  ],
  hints: [
    'Use Redis Lua script for atomic check-and-increment',
    'Limiter node in front of API: checks limit, passes or returns 429',
    'For fail-open: local in-memory fallback when Redis is down',
    'Watch the "throttled" fate counter - that\'s your 429s',
    'Circuit breaker on Redis connection prevents cascading failure',
  ],
  referenceSolution: loadBalancedPreset({
    rps: 50000,
    writeRatio: 0,
    latencyTargetMs: 1,
    overrides: {
      api: { instances: 10 },
      redis: { instances: 3, maxConnections: 10000 },
      ratelimiter: { algorithm: 'token-bucket', requestsPerSecond: 1000, burstAllowance: 100 },
    },
  }),
  quiz: [
    {
      q: 'What is the main advantage of token bucket over fixed window for rate limiting?',
      options: [
        'Simpler to implement',
        'Allows smooth burst handling up to bucket capacity',
        'Uses less memory',
        'Works without Redis',
      ],
      answerIndex: 1,
      explanation: 'Token bucket accumulates tokens over time. A client idle for a while accumulates full bucket, allowing a natural burst. Fixed window resets abruptly at window boundary.',
    },
    {
      q: 'How does a distributed rate limiter avoid a single point of failure?',
      options: [
        'Run limiter on each API instance locally',
        'Redis cluster with replication + fail-open fallback',
        'Don\'t use rate limiting',
        'Use sticky sessions',
      ],
      answerIndex: 1,
      explanation: 'Redis cluster provides HA. Fail-open (allow traffic when Redis is down) prevents limiter outage from becoming total service outage.',
    },
    {
      q: 'What is the "throttled" fate in the simulator?',
      options: [
        'Request dropped due to queue full',
        'Request rejected by rate limiter (429)',
        'Request timed out',
        'Request failed due to node down',
      ],
      answerIndex: 1,
      explanation: 'The "throttled" fate specifically means the rate limiter rejected the request. This maps to HTTP 429 Too Many Requests.',
    },
  ],
}