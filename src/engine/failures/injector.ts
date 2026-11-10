// Failure injector: kill, restart, slow, packet loss, traffic spike, hot key,
// fill disk, memory leak, cpu spike, network throttle. Actions mutate live
// machines/clients — consequences emerge from the node rules.

import type { FailureAction } from '../core/types'
import type { Simulator } from '../core/simulator'
import { ClientNode } from '../nodes/ClientNode'

export class FailureInjector {
  constructor(private readonly sim: Simulator) {}

  apply(action: FailureAction): void {
    switch (action.type) {
      case 'kill': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        if (action.machineIndex === undefined) {
          for (const m of node.machines) m.kill()
          this.sim.log.emit(this.sim.now(), node.id, 'kill', `${node.label} killed (user)`, 'fatal')
        } else {
          const m = node.machines[action.machineIndex]
          if (m !== undefined) {
            m.kill()
            this.sim.log.emit(this.sim.now(), node.id, 'kill', `${m.label} killed (user)`, 'fatal')
          }
        }
        break
      }
      case 'restart': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        if (action.machineIndex === undefined) {
          for (const m of node.machines) m.restartNow()
          this.sim.log.emit(this.sim.now(), node.id, 'restart', `${node.label} restarting`, 'info')
        } else {
          const m = node.machines[action.machineIndex]
          if (m !== undefined) {
            m.restartNow()
            this.sim.log.emit(this.sim.now(), node.id, 'restart', `${m.label} restarting`, 'info')
          }
        }
        break
      }
      case 'slow': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        // factor N => ops take ~N times longer (CPU steal consumes N-1/N).
        const load = 1 - 1 / Math.max(1.05, action.factor)
        for (const m of node.machines) m.cpu.externalLoad = load
        this.sim.log.emit(this.sim.now(), node.id, 'slow', `${node.label} slowed x${action.factor}`, 'warn')
        break
      }
      case 'packetLoss': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        for (const m of node.machines) m.nic.packetLoss = Math.min(1, action.rate)
        this.sim.log.emit(this.sim.now(), node.id, 'packet_loss', `${node.label} NIC loss ${Math.round(action.rate * 100)}%`, 'warn')
        break
      }
      case 'spike': {
        const node = this.sim.node(action.clientId)
        if (node instanceof ClientNode) {
          node.config.spikeAtMs = this.sim.now()
          node.config.spikeFactor = action.factor
          node.config.spikeDurationMs = action.durationMs
          node.config.pattern = 'spike'
          this.sim.log.emit(this.sim.now(), node.id, 'spike', `traffic spike x${action.factor} for ${action.durationMs}ms`, 'warn')
        }
        break
      }
      case 'hotKey': {
        const node = this.sim.node(action.clientId)
        if (node instanceof ClientNode) {
          node.config.keyDistribution = 'hotkey'
          this.sim.log.emit(this.sim.now(), node.id, 'hotkey', 'all traffic now hits one key', 'warn')
        }
        break
      }
      case 'fillDisk': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        for (const m of node.machines) {
          m.disk.usedGb = m.disk.totalGb
          m.log('ERROR', 'disk filled (user)')
        }
        break
      }
      case 'leakMemory': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        for (const m of node.machines) {
          m.memory.leakKbPerSec = action.on ? m.memory.totalKb / 40 : 0
          if (action.on) m.log('WARN', 'memory leak injected')
        }
        break
      }
      case 'cpuSpike': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        const end = this.sim.now() + action.durationMs
        for (const m of node.machines) m.cpu.externalLoad = 0.9
        this.sim.schedule(end, () => {
          for (const m of node.machines) m.cpu.externalLoad = 0
        })
        break
      }
      case 'networkThrottle': {
        const node = this.sim.node(action.nodeId)
        if (node === undefined) return
        for (const m of node.machines) m.nic.throttledMbps = action.mbps
        this.sim.log.emit(this.sim.now(), node.id, 'network_throttle', `NIC throttled to ${action.mbps} Mbps`, 'warn')
        break
      }
    }
  }
}
