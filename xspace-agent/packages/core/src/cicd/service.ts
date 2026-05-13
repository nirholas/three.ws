// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// CI/CD — Deployment Service
// =============================================================================

import { EventEmitter } from 'events'
import type { AgentVersionRepository } from '../db/repositories/agent-version'
import type { AgentDeploymentRepository } from '../db/repositories/agent-deployment'
import type { AgentRepository } from '../db/repositories/agent'
import type {
  CreateVersionInput,
  DeployVersionInput,
  PromotionRequest,
  RollbackRequest,
  CanaryConfig,
  DeploymentMetrics,
  DeploymentEnvironment,
  TestSuiteResult,
  AgentTest,
} from './types'
import { AgentTestRunner, type TestRunnerProvider } from './test-runner'

const DEFAULT_CANARY_CONFIG: CanaryConfig = {
  initialPercentage: 10,
  steps: [10, 50, 100],
  monitorDurationMs: 5 * 60 * 1000,
  errorRateThreshold: 0.1,
  latencyMultiplierThreshold: 2,
  sentimentDropThreshold: 0.2,
}

const VALID_PROMOTION_PATHS: Record<string, DeploymentEnvironment> = {
  'draft': 'development',
  'testing': 'staging',
  'staging': 'production',
}

export interface CICDServiceConfig {
  versionRepo: AgentVersionRepository
  deploymentRepo: AgentDeploymentRepository
  agentRepo: AgentRepository
  canaryConfig?: Partial<CanaryConfig>
  testRunnerProvider?: TestRunnerProvider
}

export class CICDService extends EventEmitter {
  private versionRepo: AgentVersionRepository
  private deploymentRepo: AgentDeploymentRepository
  private agentRepo: AgentRepository
  private canaryConfig: CanaryConfig
  private testRunner: AgentTestRunner | null

  constructor(config: CICDServiceConfig) {
    super()
    this.versionRepo = config.versionRepo
    this.deploymentRepo = config.deploymentRepo
    this.agentRepo = config.agentRepo
    this.canaryConfig = { ...DEFAULT_CANARY_CONFIG, ...config.canaryConfig }
    this.testRunner = config.testRunnerProvider
      ? new AgentTestRunner(config.testRunnerProvider)
      : null
  }

  // ---------------------------------------------------------------------------
  // Version Management
  // ---------------------------------------------------------------------------

  /** Create a new version from the current agent config. */
  async createVersion(input: CreateVersionInput) {
    const agent = await this.agentRepo.findById(input.agentId)
    if (!agent) throw new Error(`Agent ${input.agentId} not found`)

    const nextVersion = (await this.versionRepo.getLatestVersion(input.agentId)) + 1

    const version = await this.versionRepo.create({
      agentId: input.agentId,
      orgId: input.orgId,
      version: nextVersion,
      config: input.config ?? agent.config,
      changelog: input.changelog,
      createdBy: input.createdBy,
      status: 'draft',
    })

    this.emit('version:created', { agentId: input.agentId, version: nextVersion, versionId: version.id })
    return version
  }

  /** List all versions for an agent. */
  async listVersions(agentId: string) {
    return this.versionRepo.findByAgentId(agentId)
  }

  /** Get a specific version by agent ID and version number. */
  async getVersion(agentId: string, version: number) {
    return this.versionRepo.findByAgentAndVersion(agentId, version)
  }

  /** Get a version by ID. */
  async getVersionById(versionId: string) {
    return this.versionRepo.findById(versionId)
  }

  // ---------------------------------------------------------------------------
  // Testing
  // ---------------------------------------------------------------------------

  /** Run automated tests against a version's config. */
  async runTests(versionId: string, tests: AgentTest[]): Promise<TestSuiteResult> {
    const version = await this.versionRepo.findById(versionId)
    if (!version) throw new Error(`Version ${versionId} not found`)

    if (!this.testRunner) {
      throw new Error('No test runner provider configured')
    }

    // Mark version as testing
    await this.versionRepo.updateStatus(versionId, 'testing')
    this.emit('version:testing', { versionId, agentId: version.agentId })

    const results = await this.testRunner.runSuite(tests, version.config)

    // Store test results
    await this.versionRepo.updateTestResults(versionId, results)

    // If all tests pass, keep status as testing (ready for promotion)
    // If any fail, revert to draft
    if (results.failed > 0) {
      await this.versionRepo.updateStatus(versionId, 'draft')
    }

    this.emit('version:tested', {
      versionId,
      agentId: version.agentId,
      passed: results.failed === 0,
      results,
    })

    return results
  }

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  /** Deploy a version to a specific environment. */
  async deploy(input: DeployVersionInput) {
    const version = await this.versionRepo.findById(input.versionId)
    if (!version) throw new Error(`Version ${input.versionId} not found`)

    // Deactivate current deployment in this environment
    const current = await this.deploymentRepo.findActiveByEnvironment(input.agentId, input.environment)
    if (current) {
      await this.deploymentRepo.updateStatus(current.id, 'rolled_back')
    }

    // Create new deployment
    const deployment = await this.deploymentRepo.create({
      agentId: input.agentId,
      versionId: input.versionId,
      orgId: version.orgId,
      environment: input.environment,
      status: 'deploying',
      deployedBy: input.deployedBy,
    })

    // Mark deployment as active
    await this.deploymentRepo.updateStatus(deployment.id, 'active')

    // Update version status to match environment
    const statusMap: Record<DeploymentEnvironment, string> = {
      development: 'testing',
      staging: 'staging',
      production: 'production',
    }
    await this.versionRepo.updateStatus(version.id, statusMap[input.environment] as any)

    this.emit('deployment:created', {
      deploymentId: deployment.id,
      agentId: input.agentId,
      versionId: input.versionId,
      environment: input.environment,
    })

    return deployment
  }

  /** Get deployment history for an agent. */
  async listDeployments(agentId: string) {
    return this.deploymentRepo.findByAgentId(agentId)
  }

  /** Get the active deployment for a specific environment. */
  async getActiveDeployment(agentId: string, environment: DeploymentEnvironment) {
    return this.deploymentRepo.findActiveByEnvironment(agentId, environment)
  }

  // ---------------------------------------------------------------------------
  // Promotion
  // ---------------------------------------------------------------------------

  /** Promote a version from staging to production. */
  async promote(request: PromotionRequest) {
    const version = await this.versionRepo.findById(request.versionId)
    if (!version) throw new Error(`Version ${request.versionId} not found`)

    // Validate promotion path
    const expectedTarget = VALID_PROMOTION_PATHS[version.status]
    if (!expectedTarget) {
      throw new Error(`Cannot promote version in status "${version.status}"`)
    }
    if (request.targetEnvironment !== expectedTarget) {
      throw new Error(
        `Version in "${version.status}" can only be promoted to "${expectedTarget}", not "${request.targetEnvironment}"`,
      )
    }

    // Deploy to target
    const deployment = await this.deploy({
      agentId: request.agentId,
      versionId: request.versionId,
      environment: request.targetEnvironment,
      deployedBy: request.deployedBy,
    })

    this.emit('version:promoted', {
      versionId: request.versionId,
      agentId: request.agentId,
      environment: request.targetEnvironment,
    })

    return deployment
  }

  // ---------------------------------------------------------------------------
  // Rollback
  // ---------------------------------------------------------------------------

  /** Roll back to the previous active deployment in an environment. */
  async rollback(request: RollbackRequest) {
    const current = await this.deploymentRepo.findActiveByEnvironment(request.agentId, request.environment)
    if (!current) {
      throw new Error(`No active deployment found for agent ${request.agentId} in ${request.environment}`)
    }

    // Mark current as rolled back
    await this.deploymentRepo.rollback(current.id, request.reason)

    // Find the previous deployment to reactivate
    const history = await this.deploymentRepo.findByAgentId(request.agentId)
    const previousDeployments = history.filter(
      (d) =>
        d.environment === request.environment &&
        d.id !== current.id &&
        d.status !== 'rolled_back' &&
        d.status !== 'failed',
    )

    let reactivated: Awaited<ReturnType<typeof this.deploymentRepo.updateStatus>> | null = null
    if (previousDeployments.length > 0) {
      // Reactivate the most recent previous deployment
      const prev = previousDeployments[0]
      reactivated = await this.deploymentRepo.updateStatus(prev.id, 'active')

      // Revert the rolled-back version status
      const prevVersion = await this.versionRepo.findById(prev.versionId)
      if (prevVersion) {
        const statusMap: Record<string, string> = {
          development: 'testing',
          staging: 'staging',
          production: 'production',
        }
        await this.versionRepo.updateStatus(prevVersion.id, statusMap[request.environment] as any)
      }
    }

    this.emit('deployment:rolledback', {
      deploymentId: current.id,
      agentId: request.agentId,
      environment: request.environment,
      reason: request.reason,
      reactivatedDeploymentId: reactivated?.id ?? null,
    })

    return { rolledBack: current, reactivated }
  }

  // ---------------------------------------------------------------------------
  // Canary Analysis
  // ---------------------------------------------------------------------------

  /** Check if metrics indicate the deployment is healthy. */
  evaluateCanaryHealth(
    current: DeploymentMetrics,
    previous: DeploymentMetrics | null,
  ): { healthy: boolean; reasons: string[] } {
    const reasons: string[] = []

    // Check error rate
    if (current.errorRate > this.canaryConfig.errorRateThreshold) {
      reasons.push(
        `Error rate ${(current.errorRate * 100).toFixed(1)}% exceeds threshold ${(this.canaryConfig.errorRateThreshold * 100).toFixed(1)}%`,
      )
    }

    if (previous) {
      // Check latency multiplier
      if (previous.avgLatencyMs > 0) {
        const multiplier = current.avgLatencyMs / previous.avgLatencyMs
        if (multiplier > this.canaryConfig.latencyMultiplierThreshold) {
          reasons.push(
            `Latency ${current.avgLatencyMs.toFixed(0)}ms is ${multiplier.toFixed(1)}x previous ${previous.avgLatencyMs.toFixed(0)}ms (threshold: ${this.canaryConfig.latencyMultiplierThreshold}x)`,
          )
        }
      }

      // Check sentiment drop
      if (previous.sentimentAvg !== 0) {
        const drop = previous.sentimentAvg - current.sentimentAvg
        if (drop > this.canaryConfig.sentimentDropThreshold) {
          reasons.push(
            `Sentiment dropped ${drop.toFixed(2)} (from ${previous.sentimentAvg.toFixed(2)} to ${current.sentimentAvg.toFixed(2)}, threshold: ${this.canaryConfig.sentimentDropThreshold})`,
          )
        }
      }
    }

    return { healthy: reasons.length === 0, reasons }
  }

  /** Get the canary configuration. */
  getCanaryConfig(): CanaryConfig {
    return { ...this.canaryConfig }
  }
}


