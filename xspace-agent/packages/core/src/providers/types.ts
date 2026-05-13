// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Provider Intelligence — Enhanced Provider Interfaces
// =============================================================================

import type { ProviderMetrics } from '../types'

// ---------------------------------------------------------------------------
// Health Check Result
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  ok: boolean
  latencyMs: number
  error?: string
}

// ---------------------------------------------------------------------------
// Routable Provider (base constraint for the router)
// ---------------------------------------------------------------------------

/** Any provider that can be used with ProviderRouter must satisfy this shape. */
export interface RoutableProvider {
  readonly name: string
  getMetrics(): ProviderMetrics
  checkHealth(): Promise<HealthCheckResult>
  estimateCost(units: number, outputUnits?: number): number
}

// ---------------------------------------------------------------------------
// Routing Hints
// ---------------------------------------------------------------------------

export type RoutingPriority = 'speed' | 'quality' | 'cost'

export type RoutingStrategy =
  | 'primary-fallback'
  | 'latency-based'
  | 'cost-based'
  | 'smart'

// ---------------------------------------------------------------------------
// Router Configuration
// ---------------------------------------------------------------------------

export interface RouterConfig<T extends RoutableProvider = RoutableProvider> {
  providers: T[]
  strategy: RoutingStrategy
  /** Index of the primary provider (default: 0). Used by primary-fallback & smart/quality. */
  primaryIndex?: number
  /** Milliseconds before a failed provider is re-checked (default: 30_000). */
  healthRecheckMs?: number
}

// ---------------------------------------------------------------------------
// Provider Status (returned by admin endpoints)
// ---------------------------------------------------------------------------

export interface ProviderStatus {
  name: string
  healthy: boolean
  enabled: boolean
  metrics: ProviderMetrics
}

// ---------------------------------------------------------------------------
// Cost Tracking
// ---------------------------------------------------------------------------

export interface CostEntry {
  provider: string
  type: 'llm' | 'stt' | 'tts'
  costUSD: number
  timestamp: number
}

export interface CostSummary {
  total: number
  byProvider: Record<string, number>
  byType: Record<string, number>
  requestCount: number
}


