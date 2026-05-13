// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Queue System — Type Definitions
// =============================================================================

export interface QueueConfig {
  /** Redis connection URL (defaults to REDIS_URL env var). */
  redisUrl?: string
  /** Redis host (default: localhost). */
  redisHost?: string
  /** Redis port (default: 6379). */
  redisPort?: number
  /** Redis password. */
  redisPassword?: string
  /** Key prefix for all queue keys (default: xspace:queue:). */
  prefix?: string
  /** Whether to register default queues on init (default: true). */
  registerDefaults?: boolean
}

// ---------------------------------------------------------------------------
// Queue definitions
// ---------------------------------------------------------------------------

export interface QueueDefinition {
  name: string
  concurrency: number
  maxRetries: number
  backoffType: 'exponential' | 'fixed'
  backoffDelay: number
  /** Rate limit: max jobs per duration (ms). */
  rateLimit?: { max: number; duration: number }
}

export const DEFAULT_QUEUES: QueueDefinition[] = [
  {
    name: 'webhooks',
    concurrency: 10,
    maxRetries: 7,
    backoffType: 'exponential',
    backoffDelay: 1_000,
  },
  {
    name: 'usage-aggregation',
    concurrency: 5,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 2_000,
  },
  {
    name: 'emails',
    concurrency: 5,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 5_000,
  },
  {
    name: 'reports',
    concurrency: 2,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 10_000,
  },
  {
    name: 'agent-lifecycle',
    concurrency: 20,
    maxRetries: 1,
    backoffType: 'fixed',
    backoffDelay: 1_000,
  },
  {
    name: 'scheduled',
    concurrency: 5,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 5_000,
  },
  {
    name: 'notifications',
    concurrency: 10,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 2_000,
  },
]

// ---------------------------------------------------------------------------
// Job payload types
// ---------------------------------------------------------------------------

export interface WebhookJob {
  webhookId: string
  deliveryId: string
  url: string
  payload: Record<string, unknown>
  secret: string
  attempt: number
}

export interface UsageAggregationJob {
  orgId: string
  periodStart: string
  periodEnd: string
  metrics: string[]
}

export interface EmailJob {
  to: string
  template: string
  subject?: string
  data: Record<string, unknown>
}

export interface ReportJob {
  orgId: string
  reportType: 'csv' | 'pdf' | 'analytics'
  parameters: Record<string, unknown>
  requestedBy: string
}

export interface AgentLifecycleJob {
  action: 'start' | 'stop' | 'health-check' | 'cleanup'
  agentId: string
  orgId: string
  config?: Record<string, unknown>
}

export interface NotificationJob {
  type: 'in-app' | 'push' | 'slack' | 'email'
  recipientId: string
  orgId: string
  title: string
  body: string
  data?: Record<string, unknown>
  channel?: string
}

export interface ScheduledJob {
  task: string
  params?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Job type map
// ---------------------------------------------------------------------------

export interface JobTypeMap {
  webhooks: WebhookJob
  'usage-aggregation': UsageAggregationJob
  emails: EmailJob
  reports: ReportJob
  'agent-lifecycle': AgentLifecycleJob
  notifications: NotificationJob
  scheduled: ScheduledJob
}

export type QueueName = keyof JobTypeMap

// ---------------------------------------------------------------------------
// Stats / monitoring
// ---------------------------------------------------------------------------

export interface QueueStats {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: boolean
}

export interface JobInfo {
  id: string
  name: string
  data: unknown
  status: string
  attemptsMade: number
  failedReason?: string
  processedOn?: number
  finishedOn?: number
  timestamp: number
}

// ---------------------------------------------------------------------------
// Scheduled cron job definition
// ---------------------------------------------------------------------------

export interface CronJobDefinition {
  name: string
  cron: string
  handler: (params?: Record<string, unknown>) => Promise<void>
  description?: string
}


