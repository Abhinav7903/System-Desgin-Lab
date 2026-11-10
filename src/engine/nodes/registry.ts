// Node registry: adding a new node type never touches the simulator core.
// Each entry provides a factory + editable default config + panel fields.

import type { NodeKind } from '../core/types'
import type { SimContext } from '../core/context'
import type { BaseNode, BaseNodeConfig } from './BaseNode'
import { ClientNode, type ClientConfig } from './ClientNode'
import { LoadBalancerNode, type LoadBalancerConfig } from './LoadBalancerNode'
import { KafkaNode, type KafkaConfig } from './KafkaNode'
import { QueueNode, type QueueConfig } from './QueueNode'
import { MongoNode, type MongoConfig } from './MongoNode'
import { CdnNode, type CdnConfig } from './CdnNode'
import { RateLimiterNode, type RateLimiterConfig } from './RateLimiterNode'
import { ApiServerNode, type ApiServerConfig } from './ApiServerNode'
import { RedisNode, type RedisConfig } from './RedisNode'
import { PostgresNode, type PostgresConfig } from './PostgresNode'
import { DEFAULT_INSTANCE } from '../machine/instanceTypes'

export type AnyNodeConfig = ClientConfig | LoadBalancerConfig | KafkaConfig | QueueConfig | MongoConfig | CdnConfig | RateLimiterConfig | ApiServerConfig | RedisConfig | PostgresConfig

const COMMON = { instanceId: DEFAULT_INSTANCE.api, queueSize: 128 }

export function defaultConfigFor(kind: NodeKind): Record<string, unknown> {
  switch (kind) {
    case 'client':
      return {
        label: 'Client',
        instanceId: DEFAULT_INSTANCE.client,
        queueSize: 0,
        rps: 100,
        pattern: 'constant',
        writeRatio: 0.1,
        keyDistribution: 'zipf',
        keyspace: 1_000,
        payloadBytes: 2048,
        timeoutMs: 3000,
        maxRetries: 1,
        retryDelayMs: 50,
        backoff: true,
        rampSec: 30,
        burstFactor: 3,
        burstPeriodMs: 10_000,
        burstDurationMs: 2000,
        spikeAtMs: 30_000,
        spikeFactor: 10,
        spikeDurationMs: 10_000,
      }
    case 'api':
      return {
        label: 'API Server',
        instanceId: DEFAULT_INSTANCE.api,
        queueSize: 256,
        instances: 1,
        threadsPerInstance: 8,
        cpuMsPerRequest: 0.5,
        timeoutMs: 1000,
        downstreamTimeoutMs: 100,
        maxRetries: 2,
        backoff: true,
        circuitBreaker: false,
        cbThreshold: 5,
        cbCooldownMs: 5000,
        useCache: true,
        autoscale: false,
        autoscaleMin: 1,
        autoscaleMax: 6,
        autoscaleDelayMs: 60_000,
      }
    case 'redis':
      return {
        label: 'Redis',
        instanceId: DEFAULT_INSTANCE.redis,
        queueSize: 1024,
        instances: 1,
        maxMemoryMb: 256,
        ttlMs: 30_000,
        eviction: 'lru',
        maxConnections: 2000,
        replicas: 1,
      }
    case 'postgres':
      return {
        label: 'Postgres',
        instanceId: DEFAULT_INSTANCE.postgres,
        queueSize: 512,
        replicas: 1,
        writeReplicas: 0,
        maxConnections: 100,
        failover: false,
        electionMs: 10_000,
        replicationLagMs: 150,
        connectionPool: 20,
      }
    case 'loadbalancer':
      return {
        label: 'Load Balancer',
        instanceId: DEFAULT_INSTANCE.api,
        algorithm: 'round-robin',
        healthCheckIntervalMs: 5_000,
        healthCheckThreshold: 3,
        maxConnections: 1000,
        autoscale: false,
        autoscaleMax: 10,
        autoscaleDelayMs: 30_000,
        queueSize: 512,
      }
    case 'kafka':
      return {
        label: 'Kafka',
        instanceId: DEFAULT_INSTANCE.kafka,
        brokers: 3,
        partitions: 12,
        replicationFactor: 3,
        consumerGroups: 2,
        retentionMs: 604_800_000, // 7 days
        maxLag: 100_000,
        queueSize: 1024,
      }
    case 'queue':
      return {
        label: 'Queue',
        instanceId: DEFAULT_INSTANCE.queue,
        visibilityTimeoutMs: 30_000,
        maxRetries: 3,
        dlqEnabled: true,
        maxSize: 10_000,
        queueSize: 512,
      }
    case 'mongo':
      return {
        label: 'MongoDB',
        instanceId: DEFAULT_INSTANCE.mongo,
        shards: 3,
        replicationFactor: 3,
        consistencyLevel: 'majority',
        queueSize: 512,
        maxConnections: 1000,
      }
    case 'cdn':
      return {
        label: 'CDN',
        instanceId: DEFAULT_INSTANCE.cdn,
        edgeLocations: 10,
        cacheSizeGb: 100,
        defaultTtlMs: 3_600_000, // 1 hour
        originLatencyMs: 50,
        queueSize: 1024,
      }
    case 'ratelimiter':
      return {
        label: 'Rate Limiter',
        instanceId: DEFAULT_INSTANCE.ratelimiter,
        algorithm: 'token-bucket',
        requestsPerSecond: 1000,
        burstAllowance: 100,
        keyPrefix: 'api',
        queueSize: 256,
      }
    default:
      return { ...COMMON, label: kind }
  }
}

export function createNode(
  id: string,
  kind: NodeKind,
  config: BaseNodeConfig,
  ctx: SimContext,
): BaseNode {
  switch (kind) {
    case 'client':
      return new ClientNode(id, config as unknown as ClientConfig, ctx)
    case 'loadbalancer':
      return new LoadBalancerNode(id, config as unknown as LoadBalancerConfig, ctx)
    case 'kafka':
      return new KafkaNode(id, config as unknown as KafkaConfig, ctx)
    case 'queue':
      return new QueueNode(id, config as unknown as QueueConfig, ctx)
    case 'mongo':
      return new MongoNode(id, config as unknown as MongoConfig, ctx)
    case 'cdn':
      return new CdnNode(id, config as unknown as CdnConfig, ctx)
    case 'ratelimiter':
      return new RateLimiterNode(id, config as unknown as RateLimiterConfig, ctx)
    case 'api':
      return new ApiServerNode(id, config as unknown as ApiServerConfig, ctx)
    case 'redis':
      return new RedisNode(id, config as unknown as RedisConfig, ctx)
    case 'postgres':
      return new PostgresNode(id, config as unknown as PostgresConfig, ctx)
    default:
      throw new Error(`Node kind not implemented yet: ${kind}`)
  }
}
