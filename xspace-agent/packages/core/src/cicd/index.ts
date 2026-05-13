// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// CI/CD — Main exports
// =============================================================================

export { CICDService } from './service'
export type { CICDServiceConfig } from './service'

export { AgentTestRunner } from './test-runner'
export type { TestRunnerProvider } from './test-runner'

export type {
  VersionStatus,
  DeploymentEnvironment,
  DeploymentStatus,
  AgentTest,
  AgentTestResult,
  TestSuiteResult,
  PromotionRequest,
  RollbackRequest,
  CanaryConfig,
  DeploymentMetrics,
  CreateVersionInput,
  DeployVersionInput,
} from './types'


