// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// Stub mock for xspace-agent/rbac/permissions sub-path
import { vi } from 'vitest'

export const hasPermission = vi.fn(() => true)
export type Permission = string
export type BuiltInRole = string


