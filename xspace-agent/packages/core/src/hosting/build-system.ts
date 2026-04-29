// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Managed Hosting — Build System Interface
// =============================================================================

export interface BuildResult {
  status: 'success' | 'failed'
  imageTag?: string
  logs?: string
}

export interface BuildInput {
  orgId: string
  agentId: string
  deploymentId: string
  config: Record<string, unknown>
  sourceType: 'git' | 'config'
  sourceRef?: string
}

export interface BuildSystem {
  build(input: BuildInput): Promise<BuildResult>
}


