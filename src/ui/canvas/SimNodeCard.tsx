// Live node card on the canvas: phase, request rate, CPU ring, queue fill,
// and the four counters that matter when something breaks.

import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { NodeKind, NodePhase } from '../../engine/core/types'
import { useSimStore } from '../../store/simStore'
import { NODE_META, PHASE_STYLE } from './nodeMeta'
import { fmtNum } from '../lib/format'

export type SimNodeData = Record<string, unknown> & { kind: NodeKind; label: string }

function UtilRing({ util, phase }: { util: number; phase: NodePhase }) {
  const R = 15
  const C = 2 * Math.PI * R
  const clamped = Math.max(0, Math.min(1, util))
  const color = phase === 'down' ? '#fb7185' : clamped > 0.9 ? '#fb7185' : clamped > 0.7 ? '#fbbf24' : '#34d399'
  return (
    <div className="relative h-11 w-11 shrink-0" title={`CPU utilization ${(clamped * 100).toFixed(0)}%`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
        <circle cx="22" cy="22" r={R} stroke="rgba(148,163,184,0.15)" strokeWidth="4" fill="none" />
        <circle
          cx="22"
          cy="22"
          r={R}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 120ms linear, stroke 200ms' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-slate-300">
        {Math.round(clamped * 100)}%
      </div>
    </div>
  )
}

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md bg-white/[0.03] px-1 py-1 text-center">
      <div className={`font-mono text-[11px] leading-tight ${tone}`}>{fmtNum(value)}</div>
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

export const SimNodeCard = memo(function SimNodeCard({ id, data, selected }: NodeProps<Node<SimNodeData>>) {
  const snap = useSimStore((s) => s.nodes[id])
  const rps = useSimStore((s) => s.nodeRps[id] ?? 0)
  const global = useSimStore((s) => s.global)
  const clientCfg = useSimStore((s) => (data.kind === 'client' ? s.graph.nodes.find((n) => n.id === id)?.config : undefined))

  const meta = NODE_META[data.kind]
  const Icon = meta.icon
  const phase: NodePhase = snap?.phase ?? 'healthy'
  const ps = PHASE_STYLE[phase]
  const util = snap?.cpuUtil ?? 0
  const queueDepth = snap?.queueDepth ?? 0
  const queueCap = snap?.queueCap ?? 0
  const fill = queueCap > 0 ? Math.min(1, queueDepth / queueCap) : 0
  const queueColor = fill >= 0.98 ? 'bg-rose-500' : fill > 0.7 ? 'bg-amber-400' : 'bg-emerald-400'
  const poolFull = snap !== undefined && snap.connMax > 0 && snap.connOpen >= snap.connMax

  const badge =
    phase === 'down'
      ? 'DOWN'
      : fill >= 0.98
        ? 'Queue full'
        : poolFull
          ? 'Conn limit'
          : null

  const isClient = data.kind === 'client'
  const clientFates = global?.fates
  // The client has no node-level counters worth showing: what users care
  // about is the final outcome distribution from the metrics fates.
  const counters = isClient
    ? [
        { label: 'ok', value: (clientFates?.served ?? 0) + (clientFates?.retriedOk ?? 0), tone: 'text-emerald-300' },
        { label: 'slow', value: clientFates?.servedSlow ?? 0, tone: 'text-amber-300' },
        {
          label: 'fail',
          value:
            (clientFates?.rejectedQueueFull ?? 0) +
            (clientFates?.rejectedPoolExhausted ?? 0) +
            (clientFates?.timeout ?? 0) +
            (clientFates?.droppedNodeDown ?? 0) +
            (clientFates?.throttled ?? 0),
          tone: 'text-rose-400',
        },
        { label: 'lost', value: clientFates?.droppedNoBuffer ?? 0, tone: 'text-red-400' },
      ]
    : [
        { label: 'ok', value: snap?.counters.ok ?? 0, tone: 'text-emerald-300' },
        { label: 'rej', value: snap?.counters.rejected ?? 0, tone: 'text-amber-300' },
        { label: 'drop', value: snap?.counters.dropped ?? 0, tone: 'text-rose-400' },
        { label: 't/o', value: snap?.counters.timeout ?? 0, tone: 'text-orange-300' },
      ]

  return (
    <div
      className={`relative w-[232px] rounded-xl border bg-[#0d121b]/95 shadow-lg shadow-black/40 backdrop-blur transition-shadow ${
        selected ? 'ring-2 ring-sky-400/80' : ''
      } ${ps.border}`}
    >
      {badge !== null && (
        <div className="absolute -top-2.5 left-3 z-10 rounded-full border border-rose-400/50 bg-rose-950 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-300 shadow">
          {badge}
        </div>
      )}

      {meta.hasTarget && <Handle id="target" type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-0 !bg-slate-500" />}

      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: meta.tile }}>
          <Icon size={15} style={{ color: meta.accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-slate-100">{data.label}</div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">{meta.kindLabel}</div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2 py-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${ps.dot}`} />
          <span className={`text-[9px] font-medium capitalize ${ps.text}`}>{ps.label}</span>
        </div>
      </div>

      <div className="px-3 pb-2.5 pt-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-wider text-slate-500">in</div>
            <div className="font-mono text-[22px] leading-none text-slate-100">
              {fmtNum(rps)}
              <span className="ml-1 text-[9px] font-normal text-slate-500">req/s</span>
            </div>
          </div>
          <UtilRing util={util} phase={phase} />
        </div>

        {queueCap > 0 ? (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[9px] text-slate-500">
              <span>queue</span>
              <span className="font-mono">
                {queueDepth} / {queueCap}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div className={`h-full rounded-full ${queueColor} transition-all duration-150`} style={{ width: `${fill * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between text-[9px] text-slate-500">
            <span>traffic source</span>
            <span className="font-mono">
              {clientCfg !== undefined ? `${Math.round(Number(clientCfg.writeRatio ?? 0) * 100)}% writes` : ''}
            </span>
          </div>
        )}

        <div className="mt-2 grid grid-cols-4 gap-1">
          {counters.map((c) => (
            <Counter key={c.label} label={c.label} value={c.value} tone={c.tone} />
          ))}
        </div>
      </div>

      {meta.hasSource && <Handle id="source" type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-0 !bg-slate-500" />}
    </div>
  )
})
