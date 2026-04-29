// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// API Gateway — Authentication Middleware
// =============================================================================

import { randomUUID } from 'crypto'
import { ApiKeyService } from '../api-key-service'
import { OrganizationRepository } from '../../db/repositories/organization'
import { getPlan } from '../../tenant/plans'
import { getDefaultQuotas } from '../../tenant/plans'
import { createFeatureFlags } from '../../tenant/feature-flags'
import { runWithTenant } from '../../tenant/context'
import { missingApiKey, invalidApiKey } from '../errors'
import type { TenantContext, PlanTier } from '../../tenant/types'
import type { AuthenticatedRequest, GatewayConfig } from '../types'
import type { ApiKey } from '../../db/repositories/api-key'

export interface Request {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
}

export interface Response {
  status(code: number): Response
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

export type NextFunction = (err?: unknown) => void

const apiKeyService = new ApiKeyService()
const orgRepo = new OrganizationRepository()

/**
 * Extract the API key from the Authorization header.
 * Supports: "Bearer xsa_..." or raw "xsa_..." value.
 */
function extractApiKey(req: Request): string | null {
  const header = req.headers['authorization'] ?? req.headers['Authorization']
  if (!header) return null

  const value = Array.isArray(header) ? header[0] : header
  if (!value) return null

  if (value.startsWith('Bearer ')) {
    return value.slice(7).trim()
  }

  // Accept raw key if it has the xsa_ prefix
  if (value.startsWith('xsa_')) {
    return value.trim()
  }

  return null
}

/**
 * Build a TenantContext from a validated API key and its organization.
 */
async function buildTenantContext(apiKey: ApiKey): Promise<TenantContext> {
  const org = await orgRepo.findById(apiKey.orgId!)
  if (!org) {
    throw new Error(`Organization not found for API key: ${apiKey.id}`)
  }

  const planTier = (org.plan ?? 'free') as PlanTier
  const plan = getPlan(planTier)
  const quotas = getDefaultQuotas(planTier)
  const features = createFeatureFlags(plan.features)

  return {
    orgId: org.id,
    plan,
    quotas,
    features,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      ownerId: '',
      plan: planTier,
      status: 'active',
      createdAt: org.createdAt ?? new Date(),
      updatedAt: org.updatedAt ?? new Date(),
    },
  }
}

/**
 * Creates an Express-compatible authentication middleware.
 *
 * Extracts the API key from the Authorization header, validates it
 * (with Redis caching), resolves the tenant context, and injects
 * both into the request for downstream handlers.
 */
export function createAuthMiddleware(config: GatewayConfig = {}) {
  const cacheTtl = config.keyCacheTtlSeconds ?? 300

  return async (req: Request & { auth?: AuthenticatedRequest }, res: Response, next: NextFunction) => {
    const requestId = randomUUID()
    res.setHeader('X-Request-Id', requestId)

    // Extract API key
    const rawKey = extractApiKey(req)
    if (!rawKey) {
      const err = missingApiKey(config.docsBaseUrl)
      res.status(err.statusCode)
      res.json(err.toBody(requestId))
      return
    }

    // Validate key (Redis cache → DB fallback)
    const apiKey = await apiKeyService.validate(rawKey, cacheTtl)
    if (!apiKey) {
      const err = invalidApiKey(config.docsBaseUrl)
      res.status(err.statusCode)
      res.json(err.toBody(requestId))
      return
    }

    // Build tenant context
    let tenant: TenantContext
    try {
      tenant = await buildTenantContext(apiKey)
    } catch {
      const err = invalidApiKey(config.docsBaseUrl)
      res.status(err.statusCode)
      res.json(err.toBody(requestId))
      return
    }

    // Inject auth context
    req.auth = {
      requestId,
      apiKeyId: apiKey.id,
      apiKeyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes ?? [],
      tenant,
      apiVersion: 'v1',
      startTime: Date.now(),
    }

    // Run downstream handlers within tenant context
    runWithTenant(tenant, () => next())
  }
}

/**
 * Scope-checking middleware factory.
 * Ensures the authenticated API key has the required scope.
 */
export function requireScope(scope: string) {
  return (req: Request & { auth?: AuthenticatedRequest }, res: Response, next: NextFunction) => {
    if (!req.auth) {
      const err = missingApiKey()
      res.status(err.statusCode)
      res.json(err.toBody('unknown'))
      return
    }

    const { insufficientScope } = require('../errors')
    if (!req.auth.scopes.includes(scope)) {
      const err = insufficientScope(scope)
      res.status(err.statusCode)
      res.json(err.toBody(req.auth.requestId))
      return
    }

    next()
  }
}


