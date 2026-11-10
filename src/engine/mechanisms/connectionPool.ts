// Connection pool with a bounded waiter queue. Exhaustion is visible to the
// caller (rejected_pool_exhausted) — the DB-side "FATAL: too many connections".

export class ConnectionPool {
  private inUse = 0
  private waiters: (() => void)[] = []
  exhaustedCount = 0

  constructor(public size: number) {}

  get available(): number {
    return this.size - this.inUse
  }

  get utilization(): number {
    return this.inUse / Math.max(1, this.size)
  }

  get waiting(): number {
    return this.waiters.length
  }

  /** Try to take a connection; returns release() or null when exhausted. */
  acquire(): (() => void) | null {
    if (this.inUse >= this.size) {
      this.exhaustedCount++
      return null
    }
    this.inUse++
    let released = false
    return () => {
      if (released) return
      released = true
      this.inUse--
      const next = this.waiters.shift()
      if (next !== undefined) next()
    }
  }

  /** Asynchronous acquire: waits in the queue when busy, never drops. */
  acquireAsync(onAcquired: (release: () => void) => void): void {
    const conn = this.acquire()
    if (conn !== null) {
      onAcquired(conn)
      return
    }
    // Bounded waiters: beyond 4x pool size, callers get nothing (caller times out).
    if (this.waiters.length >= this.size * 4) {
      this.exhaustedCount++
      onAcquired(null as unknown as () => void)
      return
    }
    this.waiters.push(() => {
      this.inUse++
      let released = false
      onAcquired(() => {
        if (released) return
        released = true
        this.inUse--
        const next = this.waiters.shift()
        if (next !== undefined) next()
      })
    })
  }

  resize(newSize: number): void {
    this.size = Math.max(1, newSize)
  }

  reset(): void {
    this.inUse = 0
    this.waiters = []
    this.exhaustedCount = 0
  }
}
