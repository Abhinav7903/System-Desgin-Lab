// Seeded RNG (mulberry32). All engine randomness goes through here so the
// same seed + config produces identical runs.

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) this.state = 0x9e3779b9
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(min: number, max: number): number {
    if (max <= min) return min
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Exponential with mean `meanMs`. */
  exp(meanMs: number): number {
    return -Math.log(1 - this.next()) * meanMs
  }

  /** Symmetric latency jitter around a base, as a fraction (0.2 = ±20%). */
  jitter(baseMs: number, spread = 0.2): number {
    return baseMs * (1 + (this.next() * 2 - 1) * spread)
  }

  /** Zipf s=1 over n keys (classic hot-key distribution). Returns index [0, n). */
  zipfIndex(n: number): number {
    if (n <= 1) return 0
    // Inverse of F(k) = ln(k+1)/ln(n+1): idx = (n+1)^u - 1.
    const idx = Math.floor(Math.pow(n + 1, this.next()) - 1)
    return Math.min(n - 1, Math.max(0, idx))
  }
}
