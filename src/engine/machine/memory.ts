// Memory model: total RAM, process usage, page cache, swap, OOM kill.
// Under pressure the machine swaps (everything slows) and finally OOM-kills
// the biggest process, which restarts later with a cold cache.

export class Memory {
  totalKb: number
  usedKb = 0
  swapUsedKb = 0
  /** Optional leak, KB per virtual second. */
  leakKbPerSec = 0
  onSwap = false

  constructor(totalGb: number) {
    this.totalKb = Math.max(128, totalGb) * 1024 * 1024
  }

  get freeKb(): number {
    return Math.max(0, this.totalKb - this.usedKb)
  }

  get pressure(): number {
    return Math.min(1, this.usedKb / this.totalKb)
  }

  /** Swap makes ALL work on this machine slower. */
  get slowFactor(): number {
    if (!this.onSwap) return 1
    return 1 + 6 * Math.min(1, this.swapUsedKb / Math.max(1, this.totalKb / 2))
  }

  allocate(kb: number): boolean {
    if (this.usedKb + kb > this.totalKb) {
      if (!this.onSwap) this.onSwap = true
      this.swapUsedKb += kb
      return true // served, but from swap: slow
    }
    this.usedKb += kb
    return true
  }

  release(kb: number): void {
    this.usedKb = Math.max(0, this.usedKb - kb)
    if (this.usedKb < this.totalKb * 0.8 && this.swapUsedKb > 0) {
      this.swapUsedKb = Math.max(0, this.swapUsedKb - this.totalKb / 10)
      if (this.swapUsedKb === 0) this.onSwap = false
    }
  }

  /** Called each virtual tick; returns true when a leak is consuming memory. */
  tickLeak(dtSec: number): number {
    if (this.leakKbPerSec <= 0) return 0
    const grow = Math.min(this.leakKbPerSec * dtSec, this.freeKb)
    this.usedKb += grow
    if (this.usedKb >= this.totalKb) this.onSwap = true
    return grow
  }

  reset(coldCache: boolean): void {
    this.usedKb = coldCache ? 0 : Math.floor(this.totalKb * 0.35)
    this.swapUsedKb = 0
    this.onSwap = false
  }
}
