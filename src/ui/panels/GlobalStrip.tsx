// Bottom dock: live request-fate distribution and the big outcome counters.

import { useSimStore } from '../../store/simStore'
import { fmtMs, fmtNum, fmtPct } from '../lib/format'
import type { FateCounts } from '../../engine/core/types'

interface Segment {
  key: string
  label: string
  value: number
  color: string
}

function segments(f: FateCounts): Segment[] {
  return [
    { key: 'served', label: 'served', value: f.served + f.retriedOk, color: 'bg-emerald-400' },
    { key: 'slow', label: 'slow', value: f.servedSlow, color: 'bg-amber-300' },
    {
      key: 'rejected',
      label: 'rejected',
      value: f.rejectedQueueFull + f.rejectedPoolExhausted + f.throttled,
      color: 'bg-orange-400',
    },
    { key: 'timeout', label: 'timeout', value: f.timeout, color: 'bg-rose-400' },
    { key: 'dropped', label: 'dropped', value: f.droppedNodeDown, color: 'bg-rose-600' },
    { key: 'lost', label: 'LOST', value: f.droppedNoBuffer, color: 'bg-red-800' },
    { key: 'stale', label: 'stale', value: f.staleRead, color: 'bg-slate-500' },
  ]
}

function Big({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'good' | 'bad' }) {
  const color =
    tone === 'bad' ? 'text-rose-300' : tone === 'good' ? 'text-emerald-300' : 'text-slate-200'
  return (
    <div className="min-w-[64px]">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`font-mono text-[16px] leading-tight ${color}`}>{value}</div>
    </div>
  )
}

export function GlobalStrip() {
  const global = useSimStore((s) => s.global)

  if (global === null) {
    return (
      <div className="flex h-[88px] shrink-0 items-center justify-center border-t border-white/[0.07] bg-[#0a0e15]">
        <span className="text-[11px] text-slate-600">Waiting for traffic… press Run</span>
      </div>
    )
  }

  const f = global.fates
  const segs = segments(f)
  const total = segs.reduce((a, s) => a + s.value, 0)
  const failed = f.rejectedQueueFull + f.rejectedPoolExhausted + f.timeout + f.droppedNodeDown + f.droppedNoBuffer + f.throttled
  const servedPct = total > 0 ? (f.served + f.retriedOk + f.servedSlow) / total : 0
  const failedPct = total > 0 ? failed / total : 0

  return (
    <div className="flex h-[88px] shrink-0 items-center gap-6 border-t border-white/[0.07] bg-[#0a0e15] px-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            request fate · last window
          </span>
          <span className="font-mono text-[10px] text-slate-500">{fmtNum(total)} requests</span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.05]">
          {total > 0 &&
            segs.map((s) =>
              s.value > 0 ? (
                <div
                  key={s.key}
                  title={`${s.label}: ${s.value}`}
                  className={`h-full ${s.color}`}
                  style={{ width: `${(s.value / total) * 100}%` }}
                />
              ) : null,
            )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {segs.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[9px] text-slate-500">
              <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
              {s.label}
              <span className="font-mono text-slate-400">{fmtNum(s.value)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-5 border-l border-white/[0.07] pl-6">
        <Big label="throughput" value={`${fmtNum(global.rps)}/s`} tone="neutral" />
        <Big label="served" value={fmtPct(servedPct)} tone={servedPct > 0.99 ? 'good' : 'neutral'} />
        <Big label="failed" value={fmtPct(failedPct, 1)} tone={failedPct > 0.01 ? 'bad' : 'neutral'} />
        <Big label="lost (no buffer)" value={fmtNum(f.droppedNoBuffer)} tone={f.droppedNoBuffer > 0 ? 'bad' : 'neutral'} />
        <Big label="in flight" value={fmtNum(f.inFlight)} tone="neutral" />
        <Big label="p99" value={fmtMs(global.p99)} tone={global.sloViolated ? 'bad' : 'good'} />
      </div>
    </div>
  )
}
