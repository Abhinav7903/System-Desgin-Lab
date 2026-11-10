// Documented approximate default costs per operation. Marked "approximate;
// tune to your workload" — users can edit every value in the UI.
// Sources: rough orders of magnitude from public benchmarks (Redis ~100k
// ops/s/core, Postgres ~10k simple queries/s/core, etc.).

import type { ResourceCost } from '../core/types'

export interface OpCostTable {
  /** One JSON HTTP handler on a small vCPU: parse, auth, serialize. */
  apiHandler: ResourceCost
  /** Redis GET/SET ~ 0.01 ms CPU, tiny memory churn. */
  redisGet: ResourceCost
  /** Redis expensive command (KEYS / big value): blocks the single thread. */
  redisHeavy: ResourceCost
  /** SQL point read hitting page cache. */
  sqlPointRead: ResourceCost
  /** SQL read that misses cache -> disk. */
  sqlDiskRead: ResourceCost
  /** SQL write: WAL record + fsync for durability. */
  sqlWrite: ResourceCost
  /** Kafka produce (batched, fsync per produce call). */
  kafkaProduce: ResourceCost
  /** Kafka consume one message. */
  kafkaConsume: ResourceCost
  /** Rate limiter token check (local). */
  rateLimitCheck: ResourceCost
  /** CDN edge cache hit. */
  cdnHit: ResourceCost
  /** Client-side work to build/send a request. */
  clientSend: ResourceCost
}

const cost = (
  cpuMs: number,
  diskReads = 0,
  diskWrites = 0,
  fsync = 0,
  netBytesIn = 0,
  netBytesOut = 0,
  memKb = 0,
): ResourceCost => ({
  cpuMs,
  memKb,
  diskReads,
  diskWrites,
  fsync,
  netBytesIn,
  netBytesOut,
})

export const DEFAULT_COSTS: OpCostTable = {
  // apiHandler: ~0.5 ms CPU per request on 1 vCPU -> ~2000 rps/core.
  apiHandler: cost(0.5, 0, 0, 0, 2 * 1024, 4 * 1024, 32),
  redisGet: cost(0.01, 0, 0, 0, 512, 512, 1),
  redisHeavy: cost(50, 0, 0, 0, 1024, 65_536, 1),
  sqlPointRead: cost(0.15, 2, 0, 0, 512, 512, 8),
  sqlDiskRead: cost(0.2, 6, 0, 0, 512, 512, 8),
  sqlWrite: cost(0.2, 0, 2, 1, 512, 512, 8),
  kafkaProduce: cost(0.05, 0, 1, 1, 1024, 128, 4),
  kafkaConsume: cost(0.02, 1, 0, 0, 128, 128, 2),
  rateLimitCheck: cost(0.005, 0, 0, 0, 128, 128, 0),
  cdnHit: cost(0.002, 0, 0, 0, 256, 8192, 0),
  clientSend: cost(0.01, 0, 0, 0, 64, 512, 0),
}

export function cloneCosts(table: OpCostTable): OpCostTable {
  return JSON.parse(JSON.stringify(table)) as OpCostTable
}
