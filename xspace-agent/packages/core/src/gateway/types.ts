// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// API Gateway — Types
// =============================================================================

import type { TenantContext } from '../tenant/types'

// ---------------------------------------------------------------------------
// API Key Format & Scopes
// ---------------------------------------------------------------------------

/** Environment for an API key. */
export type ApiKeyEnvironment = 'live' | 'test'

/** Structured API key parts. */
export interface ParsedApiKey {
  prefix: string
  environment: ApiKeyEnvironment
  secret: string
  raw: string
}

/** All available API key scopes. */
export const API_SCOPES = {
  'agents:read': 'Read agent configurations',
  'agents:write': 'Create, update, delete agents',
  'agents:execute': 'Start, stop, and control agent sessions',
  'conversations:read': 'Read conversation history',
  'conversations:write': 'Delete or export conversations',
  'analytics:read': 'Access analytics and usage data',
  'webhooks:manage': 'Configure webhooks',
  'billing:read': 'View billing and usage information',
  'marketplace:read': 'Browse marketplace listings',
  'marketplace:install': 'Install and uninstall marketplace items',
  'marketplace:publish': 'Publish and manage marketplace listings',
  'marketplace:review': 'Submit and manage reviews',
  'marketplace:admin': 'Approve, reject, and suspend marketplace listings',
} as const

export type ApiScope = keyof typeof API_SCOPES

// ---------------------------------------------------------------------------
// API Versioning
// ---------------------------------------------------------------------------

/** Supported API versions. */
export type ApiVersion = 'v1'

/** Version lifecycle status. */
export type VersionStatus = 'current' | 'deprecated' | 'sunset'

export interface VersionInfo {
  version: ApiVersion
  status: VersionStatus
  sunsetDate?: string
}

/** All registered API versions with their lifecycle status. */
export const API_VERSIONS: Record<string, VersionInfo> = {
  v1: { version: 'v1', status: 'current' },
}

// ---------------------------------------------------------------------------
// API Error Types
// ---------------------------------------------------------------------------

/** Standardized API error types. */
export type ApiErrorType =
  | 'authentication_error'
  | 'authorization_error'
  | 'rate_limit_error'
  | 'validation_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'internal_error'

/** Standardized error response body. */
export interface ApiErrorBody {
  error: {
    type: ApiErrorType
    code: string
    message: string
    param?: string | null
    doc_url?: string
  }
  request_id: string
}

// ---------------------------------------------------------------------------
// Request/Response Logging
// ---------------------------------------------------------------------------

/** Logged metadata for every API request. */
export interface ApiRequestLog {
  requestId: string
  orgId: string
  apiKeyPrefix: string
  method: string
  path: string
  statusCode: number
  latencyMs: number
  requestSize: number
  responseSize: number
  userAgent: string
  ipAddress: string
  timestamp: Date
  apiVersion: string
  error?: string
}

// ---------------------------------------------------------------------------
// API Key Management DTOs
// ---------------------------------------------------------------------------

/** Body for POST /api-keys. */
export interface CreateApiKeyRequest {
  name: string
  scopes: ApiScope[]
  rateLimit?: number
  expiresAt?: string
}

/** Response from POST /api-keys (only time full key is shown). */
export interface CreateApiKeyResponse {
  id: string
  key: string
  prefix: string
  name: string
  scopes: string[]
  rateLimit: number
  createdAt: string
}

/** Body for PATCH /api-keys/:id. */
export interface UpdateApiKeyRequest {
  name?: string
  scopes?: ApiScope[]
  rateLimit?: number
}

/** Public key info (never exposes full key or hash). */
export interface ApiKeyInfo {
  id: string
  prefix: string
  name: string
  scopes: string[]
  rateLimit: number
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

/** Response from POST /api-keys/:id/rotate. */
export interface RotateApiKeyResponse {
  id: string
  key: string
  prefix: string
  name: string
  scopes: string[]
  rateLimit: number
  createdAt: string
  previousKeyValidUntil: string
}

// ---------------------------------------------------------------------------
// Middleware Types
// ---------------------------------------------------------------------------

/** Authenticated request context injected by auth middleware. */
export interface AuthenticatedRequest {
  requestId: string
  apiKeyId: string
  apiKeyPrefix: string
  scopes: string[]
  tenant: TenantContext
  apiVersion: string
  startTime: number
}

/** Options for configuring the API gateway. */
export interface GatewayConfig {
  /** Redis key TTL for cached API key lookups (seconds). Default: 300 (5 min). */
  keyCacheTtlSeconds?: number
  /** Default rate limit window in seconds. Default: 60. */
  rateLimitWindowSeconds?: number
  /** Base URL for error documentation. */
  docsBaseUrl?: string
  /** Enable request/response logging. Default: true. */
  enableRequestLogging?: boolean
}


