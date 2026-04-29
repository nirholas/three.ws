// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

// =============================================================================
// Managed Hosting — Lifecycle Manager Interface
// =============================================================================

import type { ResourceUsage } from './types'

export interface LifecycleStartInput {
  deploymentId: string
  imageTag: string
  config: Record<string, unknown>
  secrets: Record<string, string>
  domain?: string
}

export interface SleepInput {
  deploymentId: string
  reason: string
}

export interface WakeInput {
  deploymentId: string
  reason: string
}

export interface LifecycleManager {
  start(input: LifecycleStartInput): Promise<string>
  stop(deploymentId: string): Promise<void>
  restart(deploymentId: string): Promise<void>
  getStatus(deploymentId: string): Promise<string>
  sleep(input: SleepInput): Promise<void>
  wake(input: WakeInput): Promise<void>
  getLogs(deploymentId: string, tail?: number): Promise<string[]>
  getMetrics(deploymentId: string): Promise<ResourceUsage>
}


