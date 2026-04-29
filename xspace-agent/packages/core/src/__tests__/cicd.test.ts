// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CICDService } from '../cicd/service'
import { AgentTestRunner, type TestRunnerProvider } from '../cicd/test-runner'
import type { AgentTest, DeploymentMetrics } from '../cicd/types'

// ---------------------------------------------------------------------------
// Mock repositories
// ---------------------------------------------------------------------------

function createMockVersionRepo() {
  const versions: any[] = []
  let nextId = 1

  return {
    create: vi.fn(async (data: any) => {
      const v = { id: `v-${nextId++}`, ...data, createdAt: new Date() }
      versions.push(v)
      return v
    }),
    findById: vi.fn(async (id: string) => versions.find((v) => v.id === id)),
    findByAgentId: vi.fn(async (agentId: string) =>
      versions.filter((v) => v.agentId === agentId).sort((a: any, b: any) => b.version - a.version),
    ),
    findByAgentAndVersion: vi.fn(async (agentId: string, version: number) =>
      versions.find((v) => v.agentId === agentId && v.version === version),
    ),
    findByStatus: vi.fn(async (agentId: string, status: string) =>
      versions.filter((v) => v.agentId === agentId && v.status === status),
    ),
    getLatestVersion: vi.fn(async (agentId: string) => {
      const agentVersions = versions.filter((v) => v.agentId === agentId)
      return agentVersions.length > 0 ? Math.max(...agentVersions.map((v: any) => v.version)) : 0
    }),
    updateStatus: vi.fn(async (id: string, status: string) => {
      const v = versions.find((v) => v.id === id)
      if (v) {
        v.status = status
        if (status === 'production') v.promotedAt = new Date()
      }
      return v
    }),
    updateTestResults: vi.fn(async (id: string, testResults: any) => {
      const v = versions.find((v) => v.id === id)
      if (v) v.testResults = testResults
      return v
    }),
    delete: vi.fn(async () => {}),
    _versions: versions,
  }
}

function createMockDeploymentRepo() {
  const deployments: any[] = []
  let nextId = 1

  return {
    create: vi.fn(async (data: any) => {
      const d = { id: `d-${nextId++}`, ...data, createdAt: new Date() }
      deployments.push(d)
      return d
    }),
    findById: vi.fn(async (id: string) => deployments.find((d) => d.id === id)),
    findByAgentId: vi.fn(async (agentId: string) =>
      deployments.filter((d) => d.agentId === agentId).sort((a: any, b: any) => {
        const aTime = a.deployedAt?.getTime() ?? 0
        const bTime = b.deployedAt?.getTime() ?? 0
        return bTime - aTime
      }),
    ),
    findActiveByEnvironment: vi.fn(async (agentId: string, environment: string) =>
      deployments.find((d) => d.agentId === agentId && d.environment === environment && d.status === 'active'),
    ),
    updateStatus: vi.fn(async (id: string, status: string) => {
      const d = deployments.find((d) => d.id === id)
      if (d) d.status = status
      return d
    }),
    rollback: vi.fn(async (id: string, reason: string) => {
      const d = deployments.find((d) => d.id === id)
      if (d) {
        d.status = 'rolled_back'
        d.rolledBackAt = new Date()
        d.rollbackReason = reason
      }
      return d
    }),
    updateMetrics: vi.fn(async (id: string, metrics: any) => {
      const d = deployments.find((d) => d.id === id)
      if (d) d.metrics = metrics
      return d
    }),
    delete: vi.fn(async () => {}),
    _deployments: deployments,
  }
}

function createMockAgentRepo() {
  const agents: any[] = [
    { id: 'agent-1', orgId: 'org-1', name: 'Test Agent', config: { ai: { provider: 'openai' } }, status: 'idle', version: 1 },
  ]

  return {
    findById: vi.fn(async (id: string) => agents.find((a) => a.id === id)),
    create: vi.fn(async (data: any) => {
      agents.push(data)
      return data
    }),
    update: vi.fn(async () => agents[0]),
    delete: vi.fn(async () => {}),
  }
}

// ---------------------------------------------------------------------------
// Test Runner Tests
// ---------------------------------------------------------------------------

describe('AgentTestRunner', () => {
  const mockProvider: TestRunnerProvider = {
    generateResponse: vi.fn(async (input: string) => {
      if (input.toLowerCase().includes('hello')) {
        return { response: 'Hello there! How can I help you?', latencyMs: 500, sentiment: 0.8 }
      }
      if (input.toLowerCase().includes('competitor')) {
        return { response: 'I focus on our own products and services.', latencyMs: 800, sentiment: 0.3 }
      }
      if (input.toLowerCase().includes('refund')) {
        return { response: "I'm sorry to hear that. Let me connect you with our support team.", latencyMs: 1200, sentiment: -0.5, handoffTarget: 'escalation-agent' }
      }
      return { response: '', latencyMs: 100, sentiment: 0 }
    }),
  }

  let runner: AgentTestRunner

  beforeEach(() => {
    runner = new AgentTestRunner(mockProvider)
    vi.clearAllMocks()
  })

  it('passes a greeting test', async () => {
    const test: AgentTest = {
      name: 'Responds to greeting',
      input: 'Hello, how are you?',
      expectedBehavior: {
        shouldRespond: true,
        responseContains: ['hello'],
        maxLatencyMs: 3000,
      },
    }

    const result = await runner.runTest(test, {})
    expect(result.passed).toBe(true)
    expect(result.checks.shouldRespond?.passed).toBe(true)
    expect(result.checks.responseContains?.passed).toBe(true)
    expect(result.checks.maxLatencyMs?.passed).toBe(true)
  })

  it('passes an exclusion test', async () => {
    const test: AgentTest = {
      name: 'Does not mention competitors',
      input: 'What about CompetitorX?',
      expectedBehavior: {
        shouldRespond: true,
        responseExcludes: ['CompetitorX is better', 'switch to'],
      },
    }

    const result = await runner.runTest(test, {})
    expect(result.passed).toBe(true)
    expect(result.checks.responseExcludes?.violations).toHaveLength(0)
  })

  it('passes a handoff test', async () => {
    const test: AgentTest = {
      name: 'Escalates angry customer',
      input: 'This is terrible! I want a refund right now!',
      expectedBehavior: {
        shouldRespond: true,
        sentimentRange: [-1, -0.3],
        shouldHandoff: 'escalation-agent',
      },
    }

    const result = await runner.runTest(test, {})
    expect(result.passed).toBe(true)
    expect(result.checks.sentimentRange?.passed).toBe(true)
    expect(result.checks.shouldHandoff?.passed).toBe(true)
  })

  it('runs a full test suite', async () => {
    const tests: AgentTest[] = [
      {
        name: 'Greeting',
        input: 'Hello!',
        expectedBehavior: { shouldRespond: true, responseContains: ['hello'] },
      },
      {
        name: 'No competitor mention',
        input: 'Tell me about CompetitorX',
        expectedBehavior: { shouldRespond: true, responseExcludes: ['switch to'] },
      },
    ]

    const suite = await runner.runSuite(tests, {})
    expect(suite.total).toBe(2)
    expect(suite.passed).toBe(2)
    expect(suite.failed).toBe(0)
    expect(suite.results).toHaveLength(2)
    expect(suite.ranAt).toBeDefined()
  })

  it('detects a failing test', async () => {
    const test: AgentTest = {
      name: 'Fails latency check',
      input: 'I want a refund!',
      expectedBehavior: {
        shouldRespond: true,
        maxLatencyMs: 100, // The mock returns 1200ms for refund
      },
    }

    const result = await runner.runTest(test, {})
    expect(result.passed).toBe(false)
    expect(result.checks.maxLatencyMs?.passed).toBe(false)
  })

  it('handles provider errors gracefully', async () => {
    const errorProvider: TestRunnerProvider = {
      generateResponse: vi.fn(async () => {
        throw new Error('Provider unavailable')
      }),
    }
    const errorRunner = new AgentTestRunner(errorProvider)

    const test: AgentTest = {
      name: 'Error test',
      input: 'Hello',
      expectedBehavior: { shouldRespond: true },
    }

    const result = await errorRunner.runTest(test, {})
    expect(result.passed).toBe(false)
    expect(result.error).toBe('Provider unavailable')
  })
})

// ---------------------------------------------------------------------------
// CICDService Tests
// ---------------------------------------------------------------------------

describe('CICDService', () => {
  let service: CICDService
  let versionRepo: ReturnType<typeof createMockVersionRepo>
  let deploymentRepo: ReturnType<typeof createMockDeploymentRepo>
  let agentRepo: ReturnType<typeof createMockAgentRepo>

  beforeEach(() => {
    versionRepo = createMockVersionRepo()
    deploymentRepo = createMockDeploymentRepo()
    agentRepo = createMockAgentRepo()

    service = new CICDService({
      versionRepo: versionRepo as any,
      deploymentRepo: deploymentRepo as any,
      agentRepo: agentRepo as any,
    })
  })

  describe('Version Management', () => {
    it('creates a new version with auto-incremented number', async () => {
      const v1 = await service.createVersion({
        agentId: 'agent-1',
        orgId: 'org-1',
        config: { ai: { provider: 'openai' } },
        changelog: 'Initial version',
      })

      expect(v1.version).toBe(1)
      expect(v1.status).toBe('draft')
      expect(v1.changelog).toBe('Initial version')

      const v2 = await service.createVersion({
        agentId: 'agent-1',
        orgId: 'org-1',
        config: { ai: { provider: 'claude' } },
        changelog: 'Switched to Claude',
      })

      expect(v2.version).toBe(2)
    })

    it('throws when creating version for non-existent agent', async () => {
      await expect(
        service.createVersion({
          agentId: 'non-existent',
          orgId: 'org-1',
          config: {},
        }),
      ).rejects.toThrow('Agent non-existent not found')
    })

    it('lists versions for an agent', async () => {
      await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })

      const versions = await service.listVersions('agent-1')
      expect(versions).toHaveLength(2)
    })

    it('gets a specific version by number', async () => {
      await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 1 } })
      await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 2 } })

      const version = await service.getVersion('agent-1', 2)
      expect(version).toBeDefined()
      expect((version as any).config).toEqual({ v: 2 })
    })
  })

  describe('Deployment', () => {
    it('deploys a version to an environment', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      const deployment = await service.deploy({
        agentId: 'agent-1',
        versionId: v.id,
        environment: 'development',
      })

      expect(deployment).toBeDefined()
      expect(deployment.environment).toBe('development')
      expect(deployment.status).toBe('active')
    })

    it('deactivates previous deployment when deploying new version', async () => {
      const v1 = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 1 } })
      const v2 = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 2 } })

      await service.deploy({ agentId: 'agent-1', versionId: v1.id, environment: 'staging' })
      await service.deploy({ agentId: 'agent-1', versionId: v2.id, environment: 'staging' })

      // The first deployment should have been rolled back
      const active = await service.getActiveDeployment('agent-1', 'staging')
      expect(active?.versionId).toBe(v2.id)
    })

    it('lists deployment history', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      await service.deploy({ agentId: 'agent-1', versionId: v.id, environment: 'development' })
      await service.deploy({ agentId: 'agent-1', versionId: v.id, environment: 'staging' })

      const deployments = await service.listDeployments('agent-1')
      expect(deployments.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Promotion', () => {
    it('promotes a draft version to development', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })

      const deployment = await service.promote({
        agentId: 'agent-1',
        versionId: v.id,
        targetEnvironment: 'development',
      })

      expect(deployment.environment).toBe('development')
    })

    it('rejects invalid promotion path', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })

      await expect(
        service.promote({
          agentId: 'agent-1',
          versionId: v.id,
          targetEnvironment: 'production', // Can't go from draft to production
        }),
      ).rejects.toThrow('can only be promoted to "development"')
    })

    it('promotes testing → staging', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      // Move to testing status
      versionRepo._versions[0].status = 'testing'

      const deployment = await service.promote({
        agentId: 'agent-1',
        versionId: v.id,
        targetEnvironment: 'staging',
      })

      expect(deployment.environment).toBe('staging')
    })

    it('promotes staging → production', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      versionRepo._versions[0].status = 'staging'

      const deployment = await service.promote({
        agentId: 'agent-1',
        versionId: v.id,
        targetEnvironment: 'production',
      })

      expect(deployment.environment).toBe('production')
    })
  })

  describe('Rollback', () => {
    it('rolls back an active deployment', async () => {
      const v1 = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 1 } })
      const v2 = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: { v: 2 } })

      await service.deploy({ agentId: 'agent-1', versionId: v1.id, environment: 'production' })
      // Manually set first deployment to a non-rolled_back status for the test
      deploymentRepo._deployments[0].status = 'active'
      await service.deploy({ agentId: 'agent-1', versionId: v2.id, environment: 'production' })

      const result = await service.rollback({
        agentId: 'agent-1',
        environment: 'production',
        reason: 'Error rate too high',
      })

      expect(result.rolledBack).toBeDefined()
      expect(result.rolledBack.status).toBe('rolled_back')
      expect(result.rolledBack.rollbackReason).toBe('Error rate too high')
    })

    it('throws when no active deployment exists', async () => {
      await expect(
        service.rollback({
          agentId: 'agent-1',
          environment: 'production',
          reason: 'test',
        }),
      ).rejects.toThrow('No active deployment')
    })
  })

  describe('Canary Health Evaluation', () => {
    it('reports healthy when metrics are within thresholds', () => {
      const current: DeploymentMetrics = {
        errorRate: 0.01,
        avgLatencyMs: 500,
        sentimentAvg: 0.7,
        requestCount: 100,
        collectedAt: new Date().toISOString(),
      }
      const previous: DeploymentMetrics = {
        errorRate: 0.02,
        avgLatencyMs: 450,
        sentimentAvg: 0.75,
        requestCount: 1000,
        collectedAt: new Date().toISOString(),
      }

      const result = service.evaluateCanaryHealth(current, previous)
      expect(result.healthy).toBe(true)
      expect(result.reasons).toHaveLength(0)
    })

    it('detects high error rate', () => {
      const current: DeploymentMetrics = {
        errorRate: 0.15, // 15% > 10% threshold
        avgLatencyMs: 500,
        sentimentAvg: 0.7,
        requestCount: 100,
        collectedAt: new Date().toISOString(),
      }

      const result = service.evaluateCanaryHealth(current, null)
      expect(result.healthy).toBe(false)
      expect(result.reasons[0]).toContain('Error rate')
    })

    it('detects latency regression', () => {
      const current: DeploymentMetrics = {
        errorRate: 0.01,
        avgLatencyMs: 2000,
        sentimentAvg: 0.7,
        requestCount: 100,
        collectedAt: new Date().toISOString(),
      }
      const previous: DeploymentMetrics = {
        errorRate: 0.01,
        avgLatencyMs: 500, // 2000/500 = 4x > 2x threshold
        sentimentAvg: 0.7,
        requestCount: 1000,
        collectedAt: new Date().toISOString(),
      }

      const result = service.evaluateCanaryHealth(current, previous)
      expect(result.healthy).toBe(false)
      expect(result.reasons[0]).toContain('Latency')
    })

    it('detects sentiment drop', () => {
      const current: DeploymentMetrics = {
        errorRate: 0.01,
        avgLatencyMs: 500,
        sentimentAvg: 0.3,
        requestCount: 100,
        collectedAt: new Date().toISOString(),
      }
      const previous: DeploymentMetrics = {
        errorRate: 0.01,
        avgLatencyMs: 500,
        sentimentAvg: 0.7, // Drop of 0.4 > 0.2 threshold
        requestCount: 1000,
        collectedAt: new Date().toISOString(),
      }

      const result = service.evaluateCanaryHealth(current, previous)
      expect(result.healthy).toBe(false)
      expect(result.reasons[0]).toContain('Sentiment')
    })
  })

  describe('Testing Integration', () => {
    it('throws when no test runner is configured', async () => {
      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })

      await expect(
        service.runTests(v.id, [
          { name: 'test', input: 'hello', expectedBehavior: { shouldRespond: true } },
        ]),
      ).rejects.toThrow('No test runner provider configured')
    })

    it('runs tests when provider is configured', async () => {
      const mockProvider: TestRunnerProvider = {
        generateResponse: vi.fn(async () => ({
          response: 'Hello!',
          latencyMs: 200,
          sentiment: 0.8,
        })),
      }

      const serviceWithTests = new CICDService({
        versionRepo: versionRepo as any,
        deploymentRepo: deploymentRepo as any,
        agentRepo: agentRepo as any,
        testRunnerProvider: mockProvider,
      })

      const v = await serviceWithTests.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      const results = await serviceWithTests.runTests(v.id, [
        { name: 'Greeting', input: 'Hi', expectedBehavior: { shouldRespond: true } },
      ])

      expect(results.total).toBe(1)
      expect(results.passed).toBe(1)
    })
  })

  describe('Events', () => {
    it('emits version:created event', async () => {
      const handler = vi.fn()
      service.on('version:created', handler)

      await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', version: 1 }),
      )
    })

    it('emits deployment:created event', async () => {
      const handler = vi.fn()
      service.on('deployment:created', handler)

      const v = await service.createVersion({ agentId: 'agent-1', orgId: 'org-1', config: {} })
      await service.deploy({ agentId: 'agent-1', versionId: v.id, environment: 'development' })

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-1', environment: 'development' }),
      )
    })
  })
})


