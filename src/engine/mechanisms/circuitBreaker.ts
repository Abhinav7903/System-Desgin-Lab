// Circuit breaker: after N consecutive failures, OPEN (fail fast) for a
// cooldown, then HALF-OPEN (let one probe through). Toggled per node.

export type BreakerState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private failures = 0
  private state: BreakerState = 'closed'
  private openedAtMs = 0
  /** Notifications for the event log. */
  onTransition?: (from: BreakerState, to: BreakerState, atMs: number) => void

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number,
  ) {}

  get isOpen(): boolean {
    if (this.state === 'open' && this.now() - this.openedAtMs >= this.cooldownMs) {
      this.transition('half-open')
    }
    return this.state === 'open'
  }

  get currentState(): BreakerState {
    return this.state
  }

  /** May we attempt the downstream call right now? */
  allow(): boolean {
    return !this.isOpen
  }

  recordSuccess(): void {
    if (this.state !== 'closed') this.transition('closed')
    this.failures = 0
  }

  recordFailure(): void {
    this.failures++
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.transition('open')
    }
  }

  reset(): void {
    this.failures = 0
    this.state = 'closed'
  }

  private transition(to: BreakerState): void {
    const from = this.state
    this.state = to
    if (to === 'open') this.openedAtMs = this.now()
    this.onTransition?.(from, to, this.now())
  }
}
