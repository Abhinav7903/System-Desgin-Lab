// Minimal scheduling interface that machine components need. Keeps machine/
// decoupled from the full simulator.

export interface SimScheduler {
  now(): number
  schedule(atMs: number, run: () => void): void
}
