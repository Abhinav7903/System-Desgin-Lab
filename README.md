# System Design Lab

An interactive **system design simulator and learning lab** that runs fully in the browser. Drag components onto a canvas, connect them, run simulated traffic, inject failures, and learn from post-mortems.

## Features

### 🎯 Core Simulation Engine
- **Discrete-event simulation** with virtual clock (no real-time dependencies)
- **Per-request simulation** - every request tracked individually, never averaged
- **Seeded RNG** - identical seed = identical results (deterministic)
- **Web Worker** - simulation runs in background thread, UI stays responsive
- **Resource cost vectors** - CPU, memory, disk, network per operation
- **Emergent behaviors** - cascading failures, retry storms, cache stampedes emerge from rules

### 🏗️ Components
| Component | Features |
|-----------|----------|
| **Client** | Traffic generator (RPS, patterns: constant/ramp/burst/spike/wave) |
| **API Server** | Thread pool, cache-aside, circuit breaker, autoscaling |
| **Load Balancer** | Round-robin, least-connections, consistent-hash, health checks |
| **Redis** | Single-threaded, TTL, LRU eviction, replicas, cache-aside |
| **Postgres** | Primary + replicas, connection pool, replication lag, failover |
| **Kafka** | Partitions, consumer groups, retention, consumer lag |
| **Queue** | Visibility timeout, retries, DLQ, max size |
| **MongoDB** | Shards, replication factor, consistency levels |
| **CDN** | Edge locations, TTL, LRU eviction, origin fallback |
| **Rate Limiter** | Token bucket, sliding/fixed window, key-based |

### 🔗 Networking
- **Drag & drop** connections between any components
- **Loose connection mode** - connect any handle to any handle
- **Per-edge latency** configuration
- **Delete edges** with Delete/Backspace key

### 📊 Observability
- **Live node cards** - RPS, CPU utilization ring, queue fill bar, counters
- **Global fate strip** - served/failed/lost/throttled/timeout/stale breakdown
- **Percentile charts** - p50/p95/p99 latency over time
- **Per-node metrics** - CPU, memory, connections, queue depth
- **Fate accounting** - every request ends in exactly one fate

### 🧪 Failure Injection
- Kill/restart any machine instance
- Network partition, packet loss, latency injection
- CPU spike, memory leak, disk fill
- Traffic spike, hot key
- Scripted incident timelines

### 🎓 Learning Mode
- **Lessons** - structured scenarios (URL shortener, rate limiter, news feed)
- **Story → Think First → Build → Test → Debrief → Quiz** flow
- **Checkpoints** with assertions (p99, error rate, throughput)
- **Reference solutions** for comparison

### 🎮 Modes
| Mode | Description |
|------|-------------|
| **🔨 Build** | Blank canvas - design any topology from scratch |
| **📊 Demo** | Pre-built scenarios (Cache-aside, No-cache, Load-balanced) |

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Production build
npm run build
```

Open `http://localhost:5173` in your browser.

---

## Architecture

```
src/
├── engine/                 # Pure TypeScript simulation engine (no React/DOM)
│   ├── core/               # Clock, event queue, RNG, types, simulator
│   ├── nodes/              # Component implementations
│   │   ├── ClientNode.ts
│   │   ├── ApiServerNode.ts
│   │   ├── LoadBalancerNode.ts
│   │   ├── RedisNode.ts
│   │   ├── PostgresNode.ts
│   │   ├── KafkaNode.ts
│   │   ├── QueueNode.ts
│   │   ├── MongoNode.ts
│   │   ├── CdnNode.ts
│   │   └── RateLimiterNode.ts
│   ├── mechanisms/         # Retry, circuit breaker, timeout, connection pool
│   ├── machine/            # CPU, Memory, Disk, NIC, OS, Machine, Instance types
│   ├── failures/           # Failure injector, timeline
│   ├── metrics/            # Collector, percentiles, fate accounting
│   ├── analysis/           # Event log, post-mortem generator
│   ├── lessons/            # Lesson schema, runner, data
│   └── presets.ts          # Built-in topology presets
├── worker/
│   └── sim.worker.ts       # Web Worker entry point
├── ui/                     # React + React Flow UI
│   ├── canvas/             # Canvas, node cards, edges
│   ├── panels/             # Palette, Inspector, GlobalStrip
│   ├── controls/           # TopBar
│   ├── lessons/            # Lesson player
│   └── lib/                # Formatters, formatters
├── store/                  # Zustand stores
├── shared/                 # Protocol types
└── App.tsx                 # Root component
```

---

## Key Design Principles

1. **No hardcoded outcomes** - failures emerge from resource exhaustion
2. **Discrete-event simulation** - priority queue by virtual time
3. **Resource cost vectors** - every operation has CPU/mem/disk/net costs
4. **Seeded randomness** - reproducible results
4. **Engine/UI separation** - engine runs in Web Worker, zero React imports
5. **Fate accounting** - every request = exactly one fate (served/failed/lost/etc.)

---

## Configuration

All component settings are editable in the **Inspector panel** (click any node):
- **Instance type** - micro/small/medium/large/xlarge (vCPU, RAM, disk, NIC, boot time)
- **Resource limits** - CPU, memory, connections, queue depth
- **Behavior** - timeouts, retries, circuit breaker, eviction policy
- **Autoscaling** - min/max instances, scale-up delay

---

## Development

```bash
# Type check
npm run typecheck

# Run tests (14 engine scenario tests)
npm test

# Watch mode
npm run test:watch

# Lint (via tsc --noEmit)
npm run typecheck
```

---

## Contributing

1. Engine changes: modify `src/engine/` (pure TS, fully tested)
2. UI changes: modify `src/ui/` (React + React Flow)
3. Add components: create in `src/engine/nodes/`, register in `registry.ts`
6. Add lessons: add JSON/TS to `src/engine/lessons/data/`

---

## License

MIT License - see LICENSE file for details.