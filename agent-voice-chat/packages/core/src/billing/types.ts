// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Billing Types — Usage Tracking, Quotas, and Metering
// =============================================================================

/** All billable metric types. */
export type UsageMetric =
  | 'session_minutes'
  | 'llm_input_tokens'
  | 'llm_output_tokens'
  | 'stt_minutes'
  | 'tts_characters'
  | 'api_calls'
  | 'storage_gb'
  | 'webhook_deliveries'

/** Result of a quota check. */
export interface QuotaResult {
  /** Whether the requested usage is allowed. */
  allowed: boolean
  /** Remaining quota for this metric in the current period. */
  remaining: number
  /** Total quota limit for this metric. */
  limit: number
  /** Amount already used in the current period. */
  used: number
  /** When the current billing period resets. */
  resetAt: Date
  /** If overage billing is enabled, the rate in cents per unit. */
  overageRate?: number
}

/** Summary of usage for a billing period. */
export interface UsageSummary {
  orgId: string
  period: string // YYYY-MM
  metrics: Record<UsageMetric, number>
  estimatedCostCents: number
  periodStart: Date
  periodEnd: Date
}

/** Breakdown of usage by agent and metric. */
export interface UsageBreakdown {
  agentId: string
  agentName?: string
  metrics: Partial<Record<UsageMetric, number>>
  costCents: number
}

/** Configuration for alert thresholds. */
export interface AlertThreshold {
  /** Percentage of quota used (0-100). */
  percent: number
  /** Notification channels to trigger. */
  channels: ('email' | 'in_app' | 'webhook')[]
}

/** Default alert thresholds. */
export const DEFAULT_ALERT_THRESHOLDS: AlertThreshold[] = [
  { percent: 50, channels: ['email'] },
  { percent: 75, channels: ['email', 'in_app'] },
  { percent: 90, channels: ['email', 'in_app', 'webhook'] },
  { percent: 100, channels: ['email', 'in_app', 'webhook'] },
]

/** Rate limit tiers by plan (requests per minute). */
export const RATE_LIMITS_BY_PLAN: Record<string, number> = {
  free: 10,
  developer: 100,
  pro: 500,
  business: 2000,
  enterprise: 10000,
}

/** Endpoint group rate limit percentages (of org total). */
export const ENDPOINT_GROUP_LIMITS: Record<string, number> = {
  agents: 0.5,
  conversations: 0.3,
  billing: 10, // flat 10 req/min for all plans
}


