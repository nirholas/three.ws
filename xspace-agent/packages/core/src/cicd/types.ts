// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// CI/CD — Types
// =============================================================================

export type VersionStatus = 'draft' | 'testing' | 'staging' | 'production' | 'archived'
export type DeploymentEnvironment = 'development' | 'staging' | 'production'
export type DeploymentStatus = 'pending' | 'deploying' | 'active' | 'failed' | 'rolled_back'

/** An individual agent test case. */
export interface AgentTest {
  name: string
  input: string
  expectedBehavior: {
    shouldRespond: boolean
    responseContains?: string[]
    responseExcludes?: string[]
    sentimentRange?: [number, number]
    maxLatencyMs?: number
    shouldHandoff?: string
  }
}

/** Result of a single test execution. */
export interface AgentTestResult {
  name: string
  passed: boolean
  durationMs: number
  actualResponse?: string
  error?: string
  checks: {
    shouldRespond?: { expected: boolean; actual: boolean; passed: boolean }
    responseContains?: { expected: string[]; found: string[]; missing: string[]; passed: boolean }
    responseExcludes?: { expected: string[]; violations: string[]; passed: boolean }
    sentimentRange?: { expected: [number, number]; actual: number; passed: boolean }
    maxLatencyMs?: { expected: number; actual: number; passed: boolean }
    shouldHandoff?: { expected: string; actual: string | null; passed: boolean }
  }
}

/** Summary of a full test suite run. */
export interface TestSuiteResult {
  total: number
  passed: number
  failed: number
  durationMs: number
  results: AgentTestResult[]
  ranAt: string
}

/** Promotion request from one environment to another. */
export interface PromotionRequest {
  agentId: string
  versionId: string
  targetEnvironment: DeploymentEnvironment
  deployedBy?: string
}

/** Rollback request. */
export interface RollbackRequest {
  agentId: string
  environment: DeploymentEnvironment
  reason: string
  rolledBackBy?: string
}

/** Canary deployment configuration. */
export interface CanaryConfig {
  initialPercentage: number
  steps: number[]
  monitorDurationMs: number
  errorRateThreshold: number
  latencyMultiplierThreshold: number
  sentimentDropThreshold: number
}

/** Deployment metrics for comparison. */
export interface DeploymentMetrics {
  errorRate: number
  avgLatencyMs: number
  sentimentAvg: number
  requestCount: number
  collectedAt: string
}

/** Create version input. */
export interface CreateVersionInput {
  agentId: string
  orgId: string
  config: unknown
  changelog?: string
  createdBy?: string
}

/** Deploy version input. */
export interface DeployVersionInput {
  agentId: string
  versionId: string
  environment: DeploymentEnvironment
  deployedBy?: string
}


