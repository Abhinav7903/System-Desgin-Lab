// Right inspector: live metrics, config, and failure injection for the
// selected node — including per-machine kills (primary vs replica).

import { RotateCcw, Skull } from 'lucide-react'
import { useSimStore } from '../../store/simStore'
import { NODE_META, PHASE_STYLE } from '../canvas/nodeMeta'
import { fmtMs, fmtNum, fmtPct } from '../lib/format'
import type { NodeKind } from '../../engine/core/types'

const CONFIG_FIELDS: Record<NodeKind, string[]> = {
  client: ['pattern', 'writeRatio', 'timeoutMs', 'maxRetries', 'backoff', 'payloadBytes', 'instanceId'],
  api: ['instances', 'threadsPerInstance', 'cpuMsPerRequest', 'queueSize', 'timeoutMs', 'circuitBreaker', 'instanceId'],
  redis: ['instances', 'maxMemoryMb', 'ttlMs', 'eviction', 'maxConnections', 'replicas', 'instanceId'],
  postgres: ['replicas', 'writeReplicas', 'connectionPool', 'failover', 'electionMs', 'replicationLagMs', 'maxConnections', 'queueSize', 'instanceId'],
  loadbalancer: ['algorithm', 'healthCheckIntervalMs', 'healthCheckThreshold', 'maxConnections', 'autoscale', 'autoscaleMax', 'autoscaleDelayMs', 'queueSize', 'instanceId'],
  kafka: ['brokers', 'partitions', 'replicationFactor', 'consumerGroups', 'retentionMs', 'maxLag', 'queueSize', 'instanceId'],
  queue: ['visibilityTimeoutMs', 'maxRetries', 'dlqEnabled', 'maxSize', 'queueSize', 'instanceId'],
  mongo: ['shards', 'replicationFactor', 'consistencyLevel', 'maxConnections', 'queueSize', 'instanceId'],
  cdn: ['edgeLocations', 'cacheSizeGb', 'defaultTtlMs', 'originLatencyMs', 'queueSize', 'instanceId'],
  ratelimiter: ['algorithm', 'requestsPerSecond', 'burstAllowance', 'keyPrefix', 'queueSize', 'instanceId'],
}

function fmtValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('en-US')
    return String(v)
  }
  return String(v)
}

function machineLabel(kind: NodeKind, i: number): string {
  if (kind === 'postgres') return i === 0 ? 'Primary' : `Replica ${i}`
  if (kind === 'api') return `Instance ${i + 1}`
  if (kind === 'loadbalancer') return `LB ${i + 1}`
  if (kind === 'mongo') return `Shard ${i}`
  if (kind === 'kafka') return `Broker ${i + 1}`
  if (kind === 'cdn') return `Edge ${i + 1}`
  return i === 0 ? 'Instance' : `Instance ${i + 1}`
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-mono text-[12px] ${warn === true ? 'text-rose-300' : 'text-slate-200'}`}>{value}</div>
    </div>
  )
}

export function Inspector() {
  const selectedId = useSimStore((s) => s.selectedId)
  const graph = useSimStore((s) => s.graph)
  const snap = useSimStore((s) => (s.selectedId !== null ? s.nodes[s.selectedId] : undefined))
  const killNode = useSimStore((s) => s.killNode)
  const restartNode = useSimStore((s) => s.restartNode)
  const p99 = useSimStore((s) => s.global?.p99 ?? 0)

  const node = selectedId !== null ? graph.nodes.find((n) => n.id === selectedId) : undefined

  if (node === undefined) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-l border-white/[0.07] bg-[#0a0e15]">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <div className="text-[12px] text-slate-500">Select a node on the canvas to inspect it.</div>
          <div className="text-[10px] leading-relaxed text-slate-600">
            Kill the cache, crash the primary, or watch queues fill as traffic rises.
          </div>
        </div>
      </aside>
    )
  }

  const meta = NODE_META[node.kind]
  const Icon = meta.icon
  const phase = snap?.phase ?? 'healthy'
  const ps = PHASE_STYLE[phase]
  const cfg = node.config
  const fields = CONFIG_FIELDS[node.kind]

  const machineCount =
    node.kind === 'postgres' ? Number(cfg.replicas ?? 0) + 1 : Math.max(1, Number(cfg.instances ?? 1))

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/[0.07] bg-[#0a0e15]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: meta.tile }}>
          <Icon size={16} style={{ color: meta.accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-100">{node.label}</div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">{meta.kindLabel}</div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2 py-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${ps.dot}`} />
          <span className={`text-[9px] font-medium capitalize ${ps.text}`}>{ps.label}</span>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <section>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Live</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="cpu" value={fmtPct(snap?.cpuUtil ?? 0)} warn={(snap?.cpuUtil ?? 0) > 0.9} />
            <Stat
              label="queue"
              value={`${snap?.queueDepth ?? 0} / ${snap?.queueCap ?? 0}`}
              warn={snap !== undefined && snap.queueCap > 0 && snap.queueDepth >= snap.queueCap}
            />
            <Stat label="threads" value={`${snap?.threadsBusy ?? 0} / ${snap?.threadsTotal ?? 0}`} />
            <Stat
              label="conns"
              value={`${snap?.connOpen ?? 0} / ${snap?.connMax ?? 0}`}
              warn={snap !== undefined && snap.connMax > 0 && snap.connOpen >= snap.connMax}
            />
            <Stat label="memory" value={`${Math.round(snap?.memUsedMb ?? 0)} / ${Math.round(snap?.memTotalMb ?? 0)} MB`} />
            <Stat label="p99" value={fmtMs(p99)} />
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Counters</div>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="in" value={fmtNum(snap?.counters.in ?? 0)} />
            <Stat label="ok" value={fmtNum(snap?.counters.ok ?? 0)} />
            <Stat label="rejected" value={fmtNum(snap?.counters.rejected ?? 0)} />
            <Stat label="timeout" value={fmtNum(snap?.counters.timeout ?? 0)} />
            <Stat label="dropped" value={fmtNum(snap?.counters.dropped ?? 0)} />
            <Stat label="errors" value={fmtNum(snap?.counters.errors ?? 0)} />
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">Config</div>
          <div className="space-y-1 rounded-lg bg-white/[0.02] px-2.5 py-2 ring-1 ring-white/[0.05]">
            {fields.map((key) => (
              <div key={key} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500">{key}</span>
                <span className="font-mono text-slate-300">{fmtValue(cfg[key])}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Failure injection
          </div>
          <div className="space-y-1">
            {Array.from({ length: Math.min(machineCount, 6) }, (_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-1.5 ring-1 ring-white/[0.05]"
              >
                <span className="text-[11px] text-slate-400">{machineLabel(node.kind, i)}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => killNode(node.id, i)}
                    title={`Kill ${machineLabel(node.kind, i).toLowerCase()}`}
                    className="rounded-md bg-rose-500/10 p-1 text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/25"
                  >
                    <Skull size={12} />
                  </button>
                  <button
                    onClick={() => restartNode(node.id, i)}
                    title={`Restart ${machineLabel(node.kind, i).toLowerCase()}`}
                    className="rounded-md bg-white/[0.04] p-1 text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.1]"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {machineCount > 6 && (
            <div className="mt-1 text-[9px] text-slate-600">+{machineCount - 6} more machines</div>
          )}
        </section>
      </div>
    </aside>
  )
}
