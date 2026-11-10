// Visual identity per node kind: icon, accent color, handles. Brand-agnostic
// generic icons per the spec.

import { Users, Server, Zap, Network, Waypoints, Inbox, Globe, Shield, Cpu, Database as DatabaseIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NodeKind, NodePhase } from '../../engine/core/types'

export interface NodeMeta {
  icon: LucideIcon
  /** Accent color for the icon tile + minimap. */
  accent: string
  /** Icon tile background. */
  tile: string
  hasTarget: boolean
  hasSource: boolean
  kindLabel: string
}

export const NODE_META: Record<NodeKind, NodeMeta> = {
  client: { icon: Users, accent: '#7dd3fc', tile: 'rgba(56,189,248,0.14)', hasTarget: false, hasSource: true, kindLabel: 'Client' },
  loadbalancer: { icon: Network, accent: '#c4b5fd', tile: 'rgba(167,139,250,0.14)', hasTarget: true, hasSource: true, kindLabel: 'Load balancer' },
  api: { icon: Server, accent: '#6ee7b7', tile: 'rgba(52,211,153,0.14)', hasTarget: true, hasSource: true, kindLabel: 'API server' },
  redis: { icon: Zap, accent: '#fca5a5', tile: 'rgba(248,113,113,0.14)', hasTarget: true, hasSource: false, kindLabel: 'Cache' },
  postgres: { icon: DatabaseIcon, accent: '#93c5fd', tile: 'rgba(96,165,250,0.14)', hasTarget: true, hasSource: false, kindLabel: 'Database' },
  mongo: { icon: Cpu, accent: '#86efac', tile: 'rgba(74,222,128,0.14)', hasTarget: true, hasSource: false, kindLabel: 'Document DB' },
  kafka: { icon: Waypoints, accent: '#fdba74', tile: 'rgba(251,146,60,0.14)', hasTarget: true, hasSource: false, kindLabel: 'Event log' },
  queue: { icon: Inbox, accent: '#fde68a', tile: 'rgba(250,204,21,0.14)', hasTarget: true, hasSource: false, kindLabel: 'Queue' },
  cdn: { icon: Globe, accent: '#a5b4fc', tile: 'rgba(129,140,248,0.14)', hasTarget: true, hasSource: false, kindLabel: 'CDN' },
  ratelimiter: { icon: Shield, accent: '#f9a8d4', tile: 'rgba(244,114,182,0.14)', hasTarget: true, hasSource: true, kindLabel: 'Rate limiter' },
}

export interface PhaseStyle {
  dot: string
  text: string
  border: string
  label: string
}

export const PHASE_STYLE: Record<NodePhase, PhaseStyle> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-300', border: 'border-emerald-500/40', label: 'healthy' },
  degraded: { dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-500/50', label: 'degraded' },
  down: { dot: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/60', label: 'down' },
  booting: { dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300', border: 'border-sky-500/40', label: 'booting' },
  recovering: { dot: 'bg-sky-400 animate-pulse', text: 'text-sky-300', border: 'border-sky-500/40', label: 'recovering' },
}
