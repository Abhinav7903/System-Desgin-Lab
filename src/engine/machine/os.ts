// OS limits: file descriptors, TCP accept backlog, ephemeral ports, max
// connections. When the accept backlog is full, new connections are refused
// or time out at the client — the real "connection refused / timed out".

export class Os {
  maxFileDescriptors: number
  tcpBacklog: number
  ephemeralPortRange: number
  maxConnections: number

  openFds = 0
  connections = 0
  /** Half-open connections waiting to be accepted. */
  backlog = 0
  backlogFull = 0
  refused = 0

  constructor(maxFileDescriptors = 65_536, tcpBacklog = 128, maxConnections = 5_000) {
    this.maxFileDescriptors = maxFileDescriptors
    this.tcpBacklog = tcpBacklog
    this.ephemeralPortRange = 28_232
    this.maxConnections = maxConnections
  }

  get fdExhausted(): boolean {
    return this.openFds >= this.maxFileDescriptors
  }

  get connExhausted(): boolean {
    return this.connections >= this.maxConnections
  }

  /** Try to open an incoming connection; false = refused (backlog or limits). */
  tryAccept(): boolean {
    if (this.connections + this.backlog >= this.maxConnections + this.tcpBacklog) {
      this.refused++
      return false
    }
    if (this.backlog >= this.tcpBacklog) {
      this.backlogFull++
      return false
    }
    if (this.fdExhausted) {
      this.refused++
      return false
    }
    this.backlog++
    this.openFds++
    return true
  }

  /** A queued connection is picked up by the app. */
  accept(): boolean {
    if (this.backlog === 0) return false
    this.backlog--
    this.connections++
    return true
  }

  closeConnection(): void {
    this.connections = Math.max(0, this.connections - 1)
    this.openFds = Math.max(0, this.openFds - 1)
    // Anything waiting in backlog moves up.
    if (this.backlog > 0) {
      this.backlog--
      this.connections++
    }
  }

  reset(): void {
    this.openFds = 0
    this.connections = 0
    this.backlog = 0
    this.backlogFull = 0
    this.refused = 0
  }
}
