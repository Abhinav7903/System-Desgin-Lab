// Virtual clock. The engine NEVER reads real time; this is just the current
// virtual simulation time in milliseconds, advanced only by the event loop.

export class VirtualClock {
  nowMs = 0

  reset(): void {
    this.nowMs = 0
  }

  advanceTo(t: number): void {
    if (t > this.nowMs) this.nowMs = t
  }

  get nowSec(): number {
    return this.nowMs / 1000
  }
}
