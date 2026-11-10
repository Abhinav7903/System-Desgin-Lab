// Top bar: transport controls, speed, traffic rate, and SLO chips.

import { Activity, Pause, Play, RotateCcw, SkipForward, Timer, Wifi, WifiOff, LayoutDashboard, Hammer } from 'lucide-react'
import { useSimStore } from '../../store/simStore'
import { SPEEDS } from '../../shared/protocol'
import { fmtClock, fmtMs, fmtNum, fmtPct } from '../lib/format'

function Chip({ tone, children, title }: { tone: 'neutral' | 'good' | 'bad'; children: React.ReactNode; title?: string }) {
  const cls =
    tone === 'bad'
      ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
      : tone === 'good'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
        : 'border-white/10 bg-white/[0.04] text-slate-300'
  return (
    <div title={title} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${cls}`}>
      {children}
    </div>
  )
}

export function TopBar() {
  const running = useSimStore((s) => s.running)
  const speed = useSimStore((s) => s.speed)
  const connected = useSimStore((s) => s.connected)
  const global = useSimStore((s) => s.global)
  const graph = useSimStore((s) => s.graph)
  const mode = useSimStore((s) => s.mode)
  const toggleRunning = useSimStore((s) => s.toggleRunning)
  const step = useSimStore((s) => s.step)
  const setSpeed = useSimStore((s) => s.setSpeed)
  const setRps = useSimStore((s) => s.setRps)
  

  const clientCfg = graph.nodes.find((n) => n.kind === 'client')?.config
  const rps = Number(clientCfg?.rps ?? 100)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0b0f16] px-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500/30 to-emerald-500/20 ring-1 ring-white/10">
          <Activity size={17} className="text-sky-300" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-slate-100">System Design Lab</div>
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            {connected ? <Wifi size={9} className="text-emerald-400" /> : <WifiOff size={9} className="text-rose-400" />}
            {connected ? 'simulation worker online' : 'connecting…'}
          </div>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-white/[0.07]" />

      {/* Mode selector: Build vs Demo */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-2">Mode</span>
        <div className="flex rounded-lg ring-1 ring-white/10 overflow-hidden">
          <button
            onClick={() => useSimStore.getState().setMode('build')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              mode === 'build'
                ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/30'
                : 'bg-white/[0.02] text-slate-400 hover:bg-white/[0.06]'
            }`}
            title="Build your own system (drag & drop)"
          >
            <Hammer size={11} />
            Build
          </button>
          <button
            onClick={() => useSimStore.getState().setMode('demo')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
              mode === 'demo'
                ? 'bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/30'
                : 'bg-white/[0.02] text-slate-400 hover:bg-white/[0.06]'
            }`}
            title="View pre-built demo scenarios"
          >
            <LayoutDashboard size={11} />
            Demo
          </button>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-white/[0.07]" />

      <div className="flex items-center gap-1.5">
        <button
          onClick={toggleRunning}
          title={running ? 'Pause (Space)' : 'Run (Space)'}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            running
              ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/25'
              : 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-400/25'
          }`}
        >
          {running ? <Pause size={13} /> : <Play size={13} />}
          {running ? 'Pause' : 'Run'}
        </button>
        <button
          onClick={step}
          title="Step one 100 ms window"
          className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[12px] text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.08]"
        >
          <SkipForward size={13} />
        </button>
        <button
          onClick={() => useSimStore.getState().resetRun()}
          title="Reset run (keeps topology and settings)"
          className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-2 py-1.5 text-[12px] text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.08]"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div className="flex items-center overflow-hidden rounded-lg ring-1 ring-white/10">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2 py-1.5 font-mono text-[11px] transition-colors ${
              speed === s ? 'bg-sky-400/20 text-sky-200' : 'bg-white/[0.02] text-slate-400 hover:bg-white/[0.06]'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex min-w-[220px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">traffic</span>
        <input
          type="range"
          min={10}
          max={20000}
          step={10}
          value={rps}
          onChange={(e) => setRps(Number(e.target.value))}
          className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-slate-700 accent-sky-400"
          title="Requests per second (applies live)"
        />
        <span className="w-14 text-right font-mono text-[12px] text-sky-200">{fmtNum(rps)}</span>
        <span className="text-[9px] text-slate-500">rps</span>
      </div>

      <Chip tone="neutral" title="Virtual time">
        <Timer size={11} className="text-slate-500" />
        {global !== null ? fmtClock(global.at) : '0.0s'}
      </Chip>
      <Chip tone={global !== null && global.sloViolated ? 'bad' : 'good'} title="p99 latency vs target">
        p99 {global !== null ? fmtMs(global.p99) : '–'}
      </Chip>
      <Chip
        tone={global !== null && global.errorRate > 0.01 ? 'bad' : 'neutral'}
        title="Failed requests in the last window"
      >
        err {global !== null ? fmtPct(global.errorRate, 1) : '–'}
      </Chip>
    </header>
  )
}
