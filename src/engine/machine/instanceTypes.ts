// Cloud-style instance types, editable in the UI. Values are approximate
// defaults documented as "tune to your workload". Hourly cost lets learners
// see the capacity-vs-cost trade-off.

export interface InstanceType {
  id: string
  label: string
  vcpu: number
  ramGb: number
  /** SSD IOPS cap. */
  diskIops: number
  /** Disk throughput MB/s. */
  diskMbps: number
  /** NIC bandwidth in Mbps. */
  nicMbps: number
  /** Boot + warm-up seconds. */
  bootSec: number
  /** Approximate USD/hour. */
  hourlyCost: number
  shared: boolean
}

export const INSTANCE_TYPES: readonly InstanceType[] = [
  {
    id: 'micro',
    label: 'micro · 1 vCPU / 1 GB',
    vcpu: 1,
    ramGb: 1,
    diskIops: 3000,
    diskMbps: 80,
    nicMbps: 250,
    bootSec: 20,
    hourlyCost: 0.011,
    shared: true,
  },
  {
    id: 'small',
    label: 'small · 2 vCPU / 4 GB',
    vcpu: 2,
    ramGb: 4,
    diskIops: 6000,
    diskMbps: 120,
    nicMbps: 500,
    bootSec: 30,
    hourlyCost: 0.023,
    shared: false,
  },
  {
    id: 'medium',
    label: 'medium · 4 vCPU / 16 GB',
    vcpu: 4,
    ramGb: 16,
    diskIops: 12000,
    diskMbps: 200,
    nicMbps: 1000,
    bootSec: 45,
    hourlyCost: 0.047,
    shared: false,
  },
  {
    id: 'large',
    label: 'large · 8 vCPU / 32 GB',
    vcpu: 8,
    ramGb: 32,
    diskIops: 20000,
    diskMbps: 300,
    nicMbps: 2000,
    bootSec: 60,
    hourlyCost: 0.096,
    shared: false,
  },
  {
    id: 'xlarge',
    label: 'xlarge · 16 vCPU / 64 GB',
    vcpu: 16,
    ramGb: 64,
    diskIops: 40000,
    diskMbps: 500,
    nicMbps: 4000,
    bootSec: 90,
    hourlyCost: 0.192,
    shared: false,
  },
] as const

export function instanceType(id: string): InstanceType {
  return INSTANCE_TYPES.find((t) => t.id === id) ?? INSTANCE_TYPES[0]!
}

/** Default machine placement per node kind (all editable). */
export const DEFAULT_INSTANCE: Record<string, string> = {
  client: 'micro',
  loadbalancer: 'medium',
  api: 'small',
  redis: 'small',
  postgres: 'medium',
  mongo: 'medium',
  kafka: 'medium',
  queue: 'small',
  cdn: 'large',
  ratelimiter: 'micro',
}
