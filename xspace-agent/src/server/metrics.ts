// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import client from "prom-client"

// Use a custom registry to avoid polluting the global default
export const registry = new client.Registry()

// Collect default Node.js metrics (GC, heap, event loop, etc.)
client.collectDefaultMetrics({ register: registry, prefix: "xspace_" })

// ===== COUNTERS =====

export const messagesTotal = new client.Counter({
  name: "xspace_messages_total",
  help: "Total messages processed",
  labelNames: ["type"] as const,
  registers: [registry],
})

export const providerRequestsTotal = new client.Counter({
  name: "xspace_provider_requests_total",
  help: "Total provider API calls",
  labelNames: ["provider", "type", "status"] as const,
  registers: [registry],
})

export const errorsTotal = new client.Counter({
  name: "xspace_errors_total",
  help: "Total errors",
  labelNames: ["source"] as const,
  registers: [registry],
})

export const authAttemptsTotal = new client.Counter({
  name: "xspace_auth_attempts_total",
  help: "Total authentication attempts",
  labelNames: ["result"] as const,
  registers: [registry],
})

// ===== GAUGES =====

export const activeAgents = new client.Gauge({
  name: "xspace_agents_active",
  help: "Number of currently active agents",
  registers: [registry],
})

export const websocketConnections = new client.Gauge({
  name: "xspace_websocket_connections",
  help: "Active WebSocket connections",
  labelNames: ["namespace"] as const,
  registers: [registry],
})

export const uptimeSeconds = new client.Gauge({
  name: "xspace_uptime_seconds",
  help: "Server uptime in seconds",
  registers: [registry],
  collect() {
    this.set(process.uptime())
  },
})

export const providerCostUsd = new client.Counter({
  name: "xspace_provider_cost_usd",
  help: "Estimated provider costs in USD",
  labelNames: ["provider"] as const,
  registers: [registry],
})

// ===== HISTOGRAMS =====

export const providerLatency = new client.Histogram({
  name: "xspace_provider_latency_seconds",
  help: "Provider response latency in seconds",
  labelNames: ["provider", "type"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
})

export const audioPipelineDuration = new client.Histogram({
  name: "xspace_audio_pipeline_duration_seconds",
  help: "Audio pipeline processing time in seconds",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
})

export const requestDuration = new client.Histogram({
  name: "xspace_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [registry],
})


