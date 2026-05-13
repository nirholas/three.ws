// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// API Gateway — API Key Management Routes
// =============================================================================

import { ApiKeyService } from '../api-key-service'
import { validationError, notFoundError } from '../errors'
import { API_SCOPES, type ApiScope, type AuthenticatedRequest, type ApiKeyInfo } from '../types'

interface Request {
  method?: string
  body?: unknown
  params?: Record<string, string>
  auth?: AuthenticatedRequest
}

interface Response {
  status(code: number): Response
  json(body: unknown): void
}

type NextFunction = (err?: unknown) => void

const keyService = new ApiKeyService()
const validScopes = new Set(Object.keys(API_SCOPES))

function validateScopes(scopes: unknown): ApiScope[] | string {
  if (!Array.isArray(scopes)) return 'scopes must be an array'
  if (scopes.length === 0) return 'scopes must contain at least one scope'
  for (const s of scopes) {
    if (typeof s !== 'string' || !validScopes.has(s)) {
      return `Invalid scope: "${s}". Valid scopes: ${[...validScopes].join(', ')}`
    }
  }
  return scopes as ApiScope[]
}

function toApiKeyInfo(key: {
  id: string
  keyPrefix: string
  name: string
  scopes: string[] | null
  rateLimit: number | null
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date | null
}): ApiKeyInfo {
  return {
    id: key.id,
    prefix: key.keyPrefix,
    name: key.name,
    scopes: key.scopes ?? [],
    rateLimit: key.rateLimit ?? 1000,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    expiresAt: key.expiresAt?.toISOString() ?? null,
    createdAt: key.createdAt?.toISOString() ?? new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/** POST /api-keys — Create a new API key. */
export async function createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object') {
      throw validationError('Request body is required')
    }

    const { name, scopes, rateLimit, expiresAt } = body as {
      name?: string
      scopes?: unknown
      rateLimit?: number
      expiresAt?: string
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw validationError('name is required and must be a non-empty string', 'name')
    }

    const validatedScopes = validateScopes(scopes)
    if (typeof validatedScopes === 'string') {
      throw validationError(validatedScopes, 'scopes')
    }

    if (rateLimit !== undefined && (typeof rateLimit !== 'number' || rateLimit < 1)) {
      throw validationError('rateLimit must be a positive integer', 'rateLimit')
    }

    let parsedExpiry: Date | undefined
    if (expiresAt) {
      parsedExpiry = new Date(expiresAt)
      if (isNaN(parsedExpiry.getTime())) {
        throw validationError('expiresAt must be a valid ISO 8601 date string', 'expiresAt')
      }
      if (parsedExpiry <= new Date()) {
        throw validationError('expiresAt must be in the future', 'expiresAt')
      }
    }

    const orgId = req.auth!.tenant.orgId
    const { record, rawKey } = await keyService.create({
      orgId,
      name: name.trim(),
      scopes: validatedScopes,
      rateLimit,
      expiresAt: parsedExpiry,
    })

    res.status(201)
    res.json({
      id: record.id,
      key: rawKey,
      prefix: record.keyPrefix,
      name: record.name,
      scopes: record.scopes ?? [],
      rateLimit: record.rateLimit ?? 1000,
      createdAt: record.createdAt?.toISOString() ?? new Date().toISOString(),
    })
  } catch (err) {
    next(err)
  }
}

/** GET /api-keys — List all API keys for the organization. */
export async function listApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.auth!.tenant.orgId
    const keys = await keyService.listByOrg(orgId)
    res.status(200)
    res.json({ data: keys.map(toApiKeyInfo) })
  } catch (err) {
    next(err)
  }
}

/** GET /api-keys/:id — Get a single API key's details. */
export async function getApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.auth!.tenant.orgId
    const keyId = req.params?.id
    if (!keyId) throw validationError('API key ID is required', 'id')

    const key = await keyService.findById(keyId, orgId)
    if (!key) throw notFoundError('API key')

    res.status(200)
    res.json(toApiKeyInfo(key))
  } catch (err) {
    next(err)
  }
}

/** PATCH /api-keys/:id — Update an API key. */
export async function updateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.auth!.tenant.orgId
    const keyId = req.params?.id
    if (!keyId) throw validationError('API key ID is required', 'id')

    const body = req.body as Record<string, unknown> | undefined
    if (!body || typeof body !== 'object') {
      throw validationError('Request body is required')
    }

    const updates: { name?: string; scopes?: ApiScope[]; rateLimit?: number } = {}

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || (body.name as string).trim().length === 0) {
        throw validationError('name must be a non-empty string', 'name')
      }
      updates.name = (body.name as string).trim()
    }

    if (body.scopes !== undefined) {
      const validatedScopes = validateScopes(body.scopes)
      if (typeof validatedScopes === 'string') {
        throw validationError(validatedScopes, 'scopes')
      }
      updates.scopes = validatedScopes
    }

    if (body.rateLimit !== undefined) {
      if (typeof body.rateLimit !== 'number' || (body.rateLimit as number) < 1) {
        throw validationError('rateLimit must be a positive integer', 'rateLimit')
      }
      updates.rateLimit = body.rateLimit as number
    }

    if (Object.keys(updates).length === 0) {
      throw validationError('At least one field (name, scopes, rateLimit) must be provided')
    }

    const updated = await keyService.update(keyId, orgId, updates)
    if (!updated) throw notFoundError('API key')

    res.status(200)
    res.json(toApiKeyInfo(updated))
  } catch (err) {
    next(err)
  }
}

/** DELETE /api-keys/:id — Revoke an API key immediately. */
export async function deleteApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.auth!.tenant.orgId
    const keyId = req.params?.id
    if (!keyId) throw validationError('API key ID is required', 'id')

    const deleted = await keyService.revoke(keyId, orgId)
    if (!deleted) throw notFoundError('API key')

    res.status(200)
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
}

/** POST /api-keys/:id/rotate — Rotate an API key with 24h grace period. */
export async function rotateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.auth!.tenant.orgId
    const keyId = req.params?.id
    if (!keyId) throw validationError('API key ID is required', 'id')

    const result = await keyService.rotate(keyId, orgId)
    if (!result) throw notFoundError('API key')

    res.status(200)
    res.json({
      id: result.newRecord.id,
      key: result.rawKey,
      prefix: result.newRecord.keyPrefix,
      name: result.newRecord.name,
      scopes: result.newRecord.scopes ?? [],
      rateLimit: result.newRecord.rateLimit ?? 1000,
      createdAt: result.newRecord.createdAt?.toISOString() ?? new Date().toISOString(),
      previousKeyValidUntil: result.previousKeyValidUntil.toISOString(),
    })
  } catch (err) {
    next(err)
  }
}

/** GET /v1/status — API health status. */
export async function getApiStatus(_req: Request, res: Response): Promise<void> {
  res.status(200)
  res.json({
    status: 'operational',
    services: {
      api: 'up',
      agents: 'up',
      billing: 'up',
    },
  })
}


