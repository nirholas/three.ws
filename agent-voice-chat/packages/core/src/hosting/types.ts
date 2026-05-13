// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Managed Hosting Platform — Types
// =============================================================================

// ---------------------------------------------------------------------------
// Agent Configuration (xspace.config.ts)
// ---------------------------------------------------------------------------

export interface HostedAgentConfig {
  name: string
  version: string

  personality: {
    name: string
    systemPrompt: string
    voice?: string
  }

  providers: {
    llm: { provider: string; model: string }
    stt?: { provider: string; model?: string }
    tts?: { provider: string; voice?: string }
  }

  triggers?: {
    schedule?: ScheduleTrigger[]
    webhook?: boolean
    api?: boolean
  }

  scaling?: ScalingConfig

  environment?: Record<string, string | SecretRef>

  plugins?: string[]
}

export interface SecretRef {
  secret: string
}

export interface ScheduleTrigger {
  cron: string
  spaceUrl: string
  duration?: string
}

export interface ScalingConfig {
  minInstances?: number
  maxInstances?: number
  idleTimeoutMinutes?: number
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export type DeployMethod = 'dashboard' | 'git' | 'cli' | 'api'
export type HostedDeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'running'
  | 'sleeping'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'rolled_back'

export interface HostedDeployment {
  id: string
  orgId: string
  agentId: string
  versionId?: string
  deployMethod: DeployMethod
  status: HostedDeploymentStatus
  config: HostedAgentConfig
  imageTag?: string
  podName?: string
  domain?: string
  customDomain?: string
  buildId?: string
  buildLogs?: string
  resourceUsage?: ResourceUsage
  previousDeploymentId?: string
  deployedBy?: string
  deployedAt?: string
  stoppedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface ResourceUsage {
  cpuMillicores?: number
  memoryMB?: number
  activeSessions?: number
  uptimeMinutes?: number
  costCents?: number
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export type BuildStatus = 'queued' | 'building' | 'success' | 'failed' | 'cancelled'

export interface BuildRecord {
  id: string
  orgId: string
  agentId: string
  deploymentId: string
  status: BuildStatus
  sourceType: 'upload' | 'git' | 'config'
  sourceRef?: string
  imageTag?: string
  logs: string
  durationMs?: number
  cachedLayers?: number
  startedAt?: string
  completedAt?: string
  createdAt?: string
}

export interface BuildRequest {
  orgId: string
  agentId: string
  deploymentId: string
  config: HostedAgentConfig
  sourceType: 'upload' | 'git' | 'config'
  sourceRef?: string
}

export interface BuildResult {
  buildId: string
  status: BuildStatus
  imageTag?: string
  logs: string
  durationMs: number
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

export interface EncryptedSecret {
  id: string
  orgId: string
  deploymentId?: string
  name: string
  encryptedValue: string
  createdAt?: string
  updatedAt?: string
}

export interface SecretInput {
  name: string
  value: string
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type LifecycleState = 'sleeping' | 'starting' | 'running' | 'stopping'

export interface LifecycleTransition {
  deploymentId: string
  from: LifecycleState
  to: LifecycleState
  reason: string
  timestamp: string
}

export interface WakeRequest {
  deploymentId: string
  reason: 'api' | 'schedule' | 'webhook'
}

export interface SleepRequest {
  deploymentId: string
  reason: 'idle_timeout' | 'manual' | 'scaling'
}

// ---------------------------------------------------------------------------
// Create/Deploy Inputs
// ---------------------------------------------------------------------------

export interface CreateHostedDeploymentInput {
  orgId: string
  agentId: string
  config: HostedAgentConfig
  deployMethod: DeployMethod
  sourceRef?: string
  deployedBy?: string
}

export interface RollbackHostedDeploymentInput {
  deploymentId: string
  targetDeploymentId: string
  reason: string
  rolledBackBy?: string
}

// ---------------------------------------------------------------------------
// Hosting Pricing
// ---------------------------------------------------------------------------

export interface HostingPricing {
  computePerMinCents: number
  idlePerMinCents: number
  alwaysOnPerMinCents: number
  buildFreeTier: number
  buildPerBuildCents: number
  bandwidthFreeGB: number
  bandwidthPerGBCents: number
  storageFreeGB: number
  storagePerGBMonthCents: number
}

export const DEFAULT_HOSTING_PRICING: HostingPricing = {
  computePerMinCents: 1,       // $0.01/min
  idlePerMinCents: 0,          // Free (scale-to-zero)
  alwaysOnPerMinCents: 0.5,    // $0.005/min
  buildFreeTier: 100,          // First 100 builds/mo free
  buildPerBuildCents: 1,       // $0.01/build after
  bandwidthFreeGB: 10,         // First 10GB/mo free
  bandwidthPerGBCents: 5,      // $0.05/GB after
  storageFreeGB: 1,            // First 1GB free
  storagePerGBMonthCents: 10,  // $0.10/GB/mo after
}

export const DEFAULT_SCALING_CONFIG: Required<ScalingConfig> = {
  minInstances: 0,
  maxInstances: 5,
  idleTimeoutMinutes: 30,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface HostingEvent {
  type: HostingEventType
  deploymentId: string
  orgId: string
  timestamp: string
  data?: Record<string, unknown>
}

export type HostingEventType =
  | 'deployment.created'
  | 'deployment.building'
  | 'deployment.deployed'
  | 'deployment.running'
  | 'deployment.sleeping'
  | 'deployment.waking'
  | 'deployment.stopped'
  | 'deployment.failed'
  | 'deployment.rolled_back'
  | 'build.started'
  | 'build.completed'
  | 'build.failed'
  | 'secret.created'
  | 'secret.updated'
  | 'secret.deleted'

// ---------------------------------------------------------------------------
// Service Interfaces (re-exported from dedicated modules)
// ---------------------------------------------------------------------------

export type { BuildSystem } from './build-system'
export type { LifecycleManager } from './lifecycle-manager'
export type { SecretsManager } from './secrets-manager'


