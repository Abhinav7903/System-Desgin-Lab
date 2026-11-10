// Priority queue of events ordered by virtual time, FIFO for equal times.
// Storage: parallel typed arrays (no per-event object allocations) for speed.

export interface SimEvent {
  at: number
  seq: number
  run: () => void
}

export class EventQueue {
  private at: Float64Array
  private seq: Uint32Array
  private cb: (() => void)[]
  private size = 0
  private nextSeq = 0

  constructor(initialCapacity = 1024) {
    this.at = new Float64Array(initialCapacity)
    this.seq = new Uint32Array(initialCapacity)
    this.cb = []
  }

  /** Number of scheduled events. */
  get length(): number {
    return this.size
  }

  /** Total events ever scheduled (deterministic per seed) — event-volume meter. */
  get scheduled(): number {
    return this.nextSeq
  }

  schedule(atMs: number, run: () => void): void {
    if (this.size === this.at.length) this.grow()
    let i = this.size
    this.at[i] = atMs
    this.seq[i] = this.nextSeq++
    this.cb[i] = run
    this.size++
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.at[i]! < this.at[parent]! || (this.at[i] === this.at[parent]! && this.seq[i]! < this.seq[parent]!)) {
        this.swap(i, parent)
        i = parent
      } else break
    }
  }

  /** Earliest event time, or undefined when empty (no allocation). */
  peekAt(): number | undefined {
    return this.size === 0 ? undefined : this.at[0]!
  }

  /** Remove and run-bookkeeping: returns the earliest callback, or undefined. */
  popRun(): (() => void) | undefined {
    if (this.size === 0) return undefined
    const run = this.cb[0]!
    this.size--
    if (this.size > 0) {
      this.at[0] = this.at[this.size]!
      this.seq[0] = this.seq[this.size]!
      this.cb[0] = this.cb[this.size]!
      this.cb[this.size] = undefined as unknown as () => void
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let m = i
        if (l < this.size && (this.at[l]! < this.at[m]! || (this.at[l] === this.at[m]! && this.seq[l]! < this.seq[m]!))) m = l
        if (r < this.size && (this.at[r]! < this.at[m]! || (this.at[r] === this.at[m]! && this.seq[r]! < this.seq[m]!))) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    } else {
      this.cb[0] = undefined as unknown as () => void
    }
    return run
  }

  clear(): void {
    this.size = 0
    this.cb.length = 0
    this.nextSeq = 0
  }

  private grow(): void {
    const cap = this.at.length * 2
    const at = new Float64Array(cap)
    at.set(this.at)
    const seq = new Uint32Array(cap)
    seq.set(this.seq)
    this.at = at
    this.seq = seq
  }

  private swap(a: number, b: number): void {
    const tAt = this.at[a]!
    this.at[a] = this.at[b]!
    this.at[b] = tAt
    const tSeq = this.seq[a]!
    this.seq[a] = this.seq[b]!
    this.seq[b] = tSeq
    const tCb = this.cb[a]!
    this.cb[a] = this.cb[b]!
    this.cb[b] = tCb
  }
}
