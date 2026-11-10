// Display formatting for the UI. Numbers are always monospace in the UI.

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '–'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 100) return String(Math.round(n))
  if (n >= 10) return n.toFixed(0)
  return n.toFixed(1)
}

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '–'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

export function fmtPct(f: number, digits = 0): string {
  if (!Number.isFinite(f)) return '–'
  return `${(f * 100).toFixed(digits)}%`
}

export function fmtClock(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${(s % 60).toFixed(0).padStart(2, '0')}s`
}
