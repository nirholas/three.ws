// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Managed Hosting Platform — Deployment Manager
// =============================================================================

import { EventEmitter } from 'events'
import type {
  CreateHostedDeploymentInput,
  HostedDeployment,
  HostedDeploymentStatus,
  RollbackHostedDeploymentInput,
  HostingPricing,
  ResourceUsage,
} from './types'
import { DEFAULT_HOSTING_PRICING } from './types'
import { validateHostedConfig } from './config'
import type { BuildSystem, LifecycleManager, SecretsManager } from './types'

// ---------------------------------------------------------------------------
// Repository interface (implemented by DB layer)
// ---------------------------------------------------------------------------

export interface HostedDeploymentRepository {
  create(data: Record<string, unknown>): Promise<HostedDeployment>
  findById(id: string): Promise<HostedDeployment | undefined>
  findByOrgId(orgId: string): Promise<HostedDeployment[]>
  findByAgentId(agentId: string): Promise<HostedDeployment[]>
  findActive(orgId: string): Promise<HostedDeployment[]>
  updateStatus(id: string, status: HostedDeploymentStatus): Promise<HostedDeployment | undefined>
  updateResource(id: string, usage: ResourceUsage): Promise<HostedDeployment | undefined>
  updateImageTag(id: string, imageTag: string, podName?: string): Promise<HostedDeployment | undefined>
  delete(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Service Config
// ---------------------------------------------------------------------------

export interface DeploymentManagerConfig {
  deploymentRepo: HostedDeploymentRepository
  buildSystem: BuildSystem
  lifecycleManager: LifecycleManager
  secretsManager: SecretsManager
  pricing?: Partial<HostingPricing>
  defaultDomainSuffix?: string
}

// ---------------------------------------------------------------------------
// Deployment Manager
// ---------------------------------------------------------------------------

export class DeploymentManager extends EventEmitter {
  private repo: HostedDeploymentRepository
  private buildSystem: BuildSystem
  private lifecycle: LifecycleManager
  private secrets: SecretsManager
  private pricing: HostingPricing
  private domainSuffix: string

  constructor(config: DeploymentManagerConfig) {
    super()
    this.repo = config.deploymentRepo
    this.buildSystem = config.buildSystem
    this.lifecycle = config.lifecycleManager
    this.secrets = config.secretsManager
    this.pricing = { ...DEFAULT_HOSTING_PRICING, ...config.pricing }
    this.domainSuffix = config.defaultDomainSuffix ?? 'xspaceagent.com'
  }

  // -------------------------------------------------------------------------
  // Create & Deploy
  // -------------------------------------------------------------------------

  async deploy(input: CreateHostedDeploymentInput): Promise<HostedDeployment> {
    // Validate config
    const errors = validateHostedConfig(input.config)
    if (errors.length > 0) {
      throw new Error(`Invalid agent config: ${errors.join('; ')}`)
    }

    // Generate subdomain from agent name
    const slug = input.config.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
    const domain = `${slug}.${this.domainSuffix}`

    // Create deployment record
    const deployment = await this.repo.create({
      orgId: input.orgId,
      agentId: input.agentId,
      deployMethod: input.deployMethod,
      status: 'queued',
      config: input.config,
      domain,
      deployedBy: input.deployedBy,
    })

    this.emit('deployment.created', {
      type: 'deployment.created',
      deploymentId: deployment.id,
      orgId: input.orgId,
      timestamp: new Date().toISOString(),
    })

    // Start async build & deploy pipeline
    this.executePipeline(deployment, input).catch((err) => {
      this.emit('deployment.failed', {
        type: 'deployment.failed',
        deploymentId: deployment.id,
        orgId: input.orgId,
        timestamp: new Date().toISOString(),
        data: { error: err.message },
      })
    })

    return deployment
  }

  private async executePipeline(
    deployment: HostedDeployment,
    input: CreateHostedDeploymentInput,
  ): Promise<void> {
    // Step 1: Build
    await this.repo.updateStatus(deployment.id, 'building')
    this.emit('deployment.building', {
      type: 'deployment.building',
      deploymentId: deployment.id,
      orgId: input.orgId,
      timestamp: new Date().toISOString(),
    })

    const buildResult = await this.buildSystem.build({
      orgId: input.orgId,
      agentId: input.agentId,
      deploymentId: deployment.id,
      config: input.config as unknown as Record<string, unknown>,
      sourceType: input.sourceRef ? 'git' : 'config',
      sourceRef: input.sourceRef,
    })

    if (buildResult.status === 'failed') {
      await this.repo.updateStatus(deployment.id, 'failed')
      throw new Error(`Build failed: ${buildResult.logs}`)
    }

    // Step 2: Deploy to infrastructure
    await this.repo.updateStatus(deployment.id, 'deploying')
    this.emit('deployment.deployed', {
      type: 'deployment.deployed',
      deploymentId: deployment.id,
      orgId: input.orgId,
      timestamp: new Date().toISOString(),
    })

    // Resolve secrets for environment variables
    const envSecrets = await this.resolveSecrets(input.orgId, deployment.id, input.config)

    // Start the agent via lifecycle manager
    const podName = await this.lifecycle.start({
      deploymentId: deployment.id,
      imageTag: buildResult.imageTag!,
      config: input.config as unknown as Record<string, unknown>,
      secrets: envSecrets,
      domain: deployment.domain,
    })

    // Update deployment with image and pod info
    await this.repo.updateImageTag(deployment.id, buildResult.imageTag!, podName)
    await this.repo.updateStatus(deployment.id, 'running')

    this.emit('deployment.running', {
      type: 'deployment.running',
      deploymentId: deployment.id,
      orgId: input.orgId,
      timestamp: new Date().toISOString(),
      data: { podName, imageTag: buildResult.imageTag },
    })
  }

  private async resolveSecrets(
    orgId: string,
    deploymentId: string,
    config: CreateHostedDeploymentInput['config'],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {}

    if (!config.environment) return result

    for (const [key, value] of Object.entries(config.environment)) {
      if (typeof value === 'string') {
        result[key] = value
      } else if (value && typeof value === 'object' && 'secret' in value) {
        const secret = await this.secrets.get(orgId, value.secret)
        if (secret) {
          result[key] = secret
        }
      }
    }

    return result
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  async get(deploymentId: string): Promise<HostedDeployment | undefined> {
    return this.repo.findById(deploymentId)
  }

  async listByOrg(orgId: string): Promise<HostedDeployment[]> {
    return this.repo.findByOrgId(orgId)
  }

  async listByAgent(agentId: string): Promise<HostedDeployment[]> {
    return this.repo.findByAgentId(agentId)
  }

  async listActive(orgId: string): Promise<HostedDeployment[]> {
    return this.repo.findActive(orgId)
  }

  // -------------------------------------------------------------------------
  // Lifecycle Operations
  // -------------------------------------------------------------------------

  async stop(deploymentId: string): Promise<HostedDeployment | undefined> {
    const deployment = await this.repo.findById(deploymentId)
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`)

    await this.lifecycle.stop(deploymentId)
    const updated = await this.repo.updateStatus(deploymentId, 'stopped')

    this.emit('deployment.stopped', {
      type: 'deployment.stopped',
      deploymentId,
      orgId: deployment.orgId,
      timestamp: new Date().toISOString(),
    })

    return updated
  }

  async sleep(deploymentId: string): Promise<HostedDeployment | undefined> {
    const deployment = await this.repo.findById(deploymentId)
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`)

    await this.lifecycle.sleep({ deploymentId, reason: 'manual' })
    const updated = await this.repo.updateStatus(deploymentId, 'sleeping')

    this.emit('deployment.sleeping', {
      type: 'deployment.sleeping',
      deploymentId,
      orgId: deployment.orgId,
      timestamp: new Date().toISOString(),
    })

    return updated
  }

  async wake(deploymentId: string, reason: 'api' | 'schedule' | 'webhook' = 'api'): Promise<HostedDeployment | undefined> {
    const deployment = await this.repo.findById(deploymentId)
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`)

    if (deployment.status !== 'sleeping') {
      throw new Error(`Deployment ${deploymentId} is not sleeping (status: ${deployment.status})`)
    }

    await this.lifecycle.wake({ deploymentId, reason })
    const updated = await this.repo.updateStatus(deploymentId, 'running')

    this.emit('deployment.waking', {
      type: 'deployment.waking',
      deploymentId,
      orgId: deployment.orgId,
      timestamp: new Date().toISOString(),
      data: { reason },
    })

    return updated
  }

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  async rollback(input: RollbackHostedDeploymentInput): Promise<HostedDeployment> {
    const current = await this.repo.findById(input.deploymentId)
    if (!current) throw new Error(`Deployment ${input.deploymentId} not found`)

    const target = await this.repo.findById(input.targetDeploymentId)
    if (!target) throw new Error(`Target deployment ${input.targetDeploymentId} not found`)

    // Stop current deployment
    await this.lifecycle.stop(input.deploymentId)
    await this.repo.updateStatus(input.deploymentId, 'rolled_back')

    // Re-deploy target version
    const redeployed = await this.deploy({
      orgId: current.orgId,
      agentId: current.agentId,
      config: target.config,
      deployMethod: 'api',
      deployedBy: input.rolledBackBy,
    })

    this.emit('deployment.rolled_back', {
      type: 'deployment.rolled_back',
      deploymentId: input.deploymentId,
      orgId: current.orgId,
      timestamp: new Date().toISOString(),
      data: {
        reason: input.reason,
        targetDeploymentId: input.targetDeploymentId,
        newDeploymentId: redeployed.id,
      },
    })

    return redeployed
  }

  // -------------------------------------------------------------------------
  // Logs & Metrics
  // -------------------------------------------------------------------------

  async getLogs(deploymentId: string, tail?: number): Promise<string[]> {
    return this.lifecycle.getLogs(deploymentId, tail)
  }

  async getMetrics(deploymentId: string): Promise<ResourceUsage> {
    return this.lifecycle.getMetrics(deploymentId)
  }

  // -------------------------------------------------------------------------
  // Cost Estimation
  // -------------------------------------------------------------------------

  estimateMonthlyCost(activeMinutesPerDay: number, alwaysOn: boolean): number {
    const daysPerMonth = 30
    const totalMinutes = activeMinutesPerDay * daysPerMonth

    if (alwaysOn) {
      // Always-on includes idle time
      const totalMinutesInMonth = 24 * 60 * daysPerMonth
      const idleMinutes = totalMinutesInMonth - totalMinutes
      return (
        totalMinutes * this.pricing.computePerMinCents +
        idleMinutes * this.pricing.alwaysOnPerMinCents
      )
    }

    // Scale-to-zero: only pay for active time
    return totalMinutes * this.pricing.computePerMinCents
  }
}


