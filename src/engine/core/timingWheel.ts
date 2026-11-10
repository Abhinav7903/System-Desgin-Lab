// Timing wheel for high-frequency timeouts (request deadlines, downstream
// call timeouts). O(1) schedule, amortized O(1) fire — millions of timeouts
// are fine. Granularity is coarser than the event queue (25 ms), which is
// acceptable for timeout semantics (a 100 ms timeout fires within 100-125 ms).

const GRANULARITY_MS = 25
const BUCKETS = 1024 // ~25.6 s horizon

export class TimingWheel {
  private buckets: (() => void)[][] = Array.from({ length: BUCKETS }, () => [])
  private processedUntilMs = 0
  private nowMs = 0

  constructor(private readonly fallback: (atMs: number, run: () => void) => void) {}

  setNow(nowMs: number): void {
    this.nowMs = nowMs
  }

  /** Schedule a timeout at virtual time atMs (fires within granularity). */
  schedule(atMs: number, run: () => void): void {
    if (atMs <= this.nowMs) {
      run()
      return
    }
    const idx = Math.floor(atMs / GRANULARITY_MS)
    const cur = Math.floor(this.nowMs / GRANULARITY_MS)
    if (idx - cur >= BUCKETS) {
      // Beyond the horizon: use the precise event queue instead.
      this.fallback(atMs, run)
      return
    }
    this.buckets[idx % BUCKETS]!.push(run)
  }

  /** Fire everything due up to (and including) nowMs. Cheap when nothing due. */
  drain(nowMs: number): void {
    this.nowMs = Math.max(this.nowMs, nowMs)
    const dueIdx = Math.floor(nowMs / GRANULARITY_MS)
    let cur = Math.floor(this.processedUntilMs / GRANULARITY_MS)
    if (dueIdx <= cur) return
    while (cur < dueIdx && cur - Math.floor(this.nowMs / GRANULARITY_MS) < BUCKETS) {
      cur++
      const bucket = this.buckets[cur % BUCKETS]!
      if (bucket.length > 0) {
        const runs = bucket.slice()
        bucket.length = 0
        for (const r of runs) r()
      }
    }
    this.processedUntilMs = nowMs
  }

  reset(): void {
    for (const b of this.buckets) b.length = 0
    this.processedUntilMs = 0
  }
}
