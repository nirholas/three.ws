// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Managed Hosting — Secrets Manager Interface
// =============================================================================

export interface SecretsManager {
  get(orgId: string, key: string): Promise<string | undefined>
  set(orgId: string, key: string, value: string): Promise<void>
  delete(orgId: string, key: string): Promise<void>
  list(orgId: string): Promise<string[]>
}


