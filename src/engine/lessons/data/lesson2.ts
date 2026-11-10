// Lesson 2: URL Shortener
// Design a URL shortener like bit.ly - high read, low write, cacheable.

import type { Lesson } from '../schema'
import { loadBalancedPreset } from '../../presets'

export const lesson2: Lesson = {
  id: 'url-shortener',
  title: 'URL Shortener',
  difficulty: 'intermediate',
  story: `Build a URL shortener service (like bit.ly). Requirements:
- Shorten URL: POST /shorten → returns short code (write)
- Redirect: GET /:code → 302 to original URL (read)
- 100M URLs stored, 10K RPS reads, 100 RPS writes
- Redirect latency < 10ms p99 (cache hit)
- 99.99% availability

Key insight: Redirects are perfect for caching - same short code → same destination.`,
  requirements: {
    functional: [
      'Create short URL (write to DB, return code)',
      'Redirect short code → original URL (read from cache/DB)',
      'Handle custom short codes',
      'Analytics: track click counts',
    ],
    traffic: {
      writesPerSec: 100,
      readsPerSec: 10_000,
    },
    targets: {
      p99LatencyMs: 10,
      availability: '99.99%',
    },
  },
  allowedComponents: ['client', 'api', 'redis', 'postgres', 'loadbalancer', 'kafka'],
  thinkFirstQuestions: [
    {
      q: 'With 10K RPS reads and 100 RPS writes, what read/write ratio is that?',
      hint: '100 / 10,100 ≈ 1% writes',
      answerNotes: '99% reads, 1% writes. This is extremely read-heavy - perfect for caching. Almost all redirects should be cache hits.',
    },
    {
      q: 'If you use Redis for the redirect lookup, how much memory for 100M URLs?',
      hint: 'Each entry: key (8 bytes) + value (avg 50 bytes) + overhead ≈ 100 bytes',
      answerNotes: '100M × 100 bytes = 10 GB. A "large" Redis instance (32 GB) handles this comfortably with room for OS and replication.',
    },
    {
      q: 'What happens to redirect latency if Redis dies?',
      hint: 'Without cache, every redirect hits Postgres. What\'s the latency difference?',
      answerNotes: 'Redis hit: ~1ms. Postgres point read: ~5-10ms. At 10K RPS, Postgres will saturate. You NEED the cache for p99 < 10ms.',
    },
    {
      q: 'How do you handle click analytics without slowing down redirects?',
      hint: 'Async write to Kafka, consumer aggregates to DB',
      answerNotes: 'Fire-and-forget to Kafka on redirect. Consumer batches writes to Postgres. Redirect stays fast.',
    },
  ],
  checkpoints: [
    {
      name: 'Baseline: cache-aside at 1000 RPS (scaled down for sim)',
      scenario: {
        durationSec: 15,
        rps: 1000,
        pattern: 'constant',
        writeRatio: 0.01,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 20, message: 'p99 under 20ms with cache' },
        { metric: 'hitRatio', op: 'gt', value: 0.95, message: 'Hit ratio > 95%' },
      ],
    },
    {
      name: 'Scale to 10K RPS reads',
      scenario: {
        durationSec: 20,
        rps: 10000,
        pattern: 'constant',
        writeRatio: 0.01,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 30, message: 'p99 under 30ms at full load' },
        { metric: 'errorRate', op: 'eq', value: 0, message: 'Zero errors' },
      ],
    },
    {
      name: 'Redis failure: cache stampede',
      scenario: {
        durationSec: 30,
        rps: 5000,
        pattern: 'constant',
        writeRatio: 0.01,
        failures: [
          { atSec: 10, action: { type: 'kill', nodeId: 'redis' } },
        ],
      },
      pass: [
        { metric: 'p99', op: 'gt', value: 100, message: 'p99 spikes when Redis dies' },
        { metric: 'errorRate', op: 'gt', value: 0.05, message: 'Errors appear under stampede' },
      ],
    },
    {
      name: 'Add Kafka for async analytics',
      scenario: {
        durationSec: 20,
        rps: 5000,
        pattern: 'constant',
        writeRatio: 0.01,
      },
      pass: [
        { metric: 'p99', op: 'lt', value: 15, message: 'p99 stays low with async analytics' },
      ],
    },
  ],
  hints: [
    'Use 99% read / 1% write ratio - redirects are cacheable',
    'Redis cluster with 3 shards handles 100M keys',
    'Kafka decouples analytics from redirect path',
    'Watch Postgres connection pool - it\'s the bottleneck if cache dies',
    'Circuit breaker on Redis prevents stampede from killing DB',
  ],
  referenceSolution: loadBalancedPreset({
    rps: 10000,
    writeRatio: 0.01,
    latencyTargetMs: 10,
    overrides: {
      api: { instances: 5, useCache: true, circuitBreaker: true },
      redis: { instances: 3, maxMemoryMb: 8192 },
      pg: { replicas: 2, connectionPool: 100, failover: true },
    },
  }),
  quiz: [
    {
      q: 'Why is a URL shortener redirect path ideal for caching?',
      options: [
        'URLs change frequently',
        'Same short code always maps to same destination',
        'Redirects need to be slow',
        'Cache invalidation is complex',
      ],
      answerIndex: 1,
      explanation: 'Short codes are immutable - once created, the mapping never changes. Perfect for indefinite caching.',
    },
    {
      q: 'What is the latency budget for a 10ms p99 redirect at 10K RPS?',
      options: [
        'All 10ms for network',
        '~1ms Redis + ~1ms network + ~8ms headroom',
        '~5ms DB + ~5ms network',
        '~10ms for DB only',
      ],
      answerIndex: 1,
      explanation: 'Redis hit is ~1ms. You need headroom for network variance. DB read at 5-10ms would exceed budget.',
    },
    {
      q: 'How do you track click counts without adding latency to redirects?',
      options: [
        'Synchronous DB update on each redirect',
        'Async write to Kafka, batch consumer writes to DB',
        'Redis INCR on every redirect',
        'Log to file and process nightly',
      ],
      answerIndex: 1,
      explanation: 'Fire-and-forget to Kafka keeps redirect fast. Consumer batches analytics writes to DB.',
    },
  ],
}