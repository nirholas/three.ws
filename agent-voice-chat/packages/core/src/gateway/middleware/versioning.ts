// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// API Gateway — API Versioning Middleware
// =============================================================================

import { API_VERSIONS, type VersionInfo } from '../types'
import { validationError } from '../errors'
import type { AuthenticatedRequest, GatewayConfig } from '../types'

interface Request {
  url?: string
  headers: Record<string, string | string[] | undefined>
  auth?: AuthenticatedRequest
}

interface Response {
  status(code: number): Response
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

type NextFunction = (err?: unknown) => void

/**
 * Extract API version from the URL path.
 * Matches /v1/..., /v2/..., etc.
 */
function extractVersionFromUrl(url?: string): string | null {
  if (!url) return null
  const match = url.match(/^\/(v\d+)\//)
  return match ? match[1] : null
}

/**
 * Extract API version from the X-API-Version header.
 */
function extractVersionFromHeader(headers: Record<string, string | string[] | undefined>): string | null {
  const header = headers['x-api-version'] ?? headers['X-API-Version']
  if (!header) return null
  return Array.isArray(header) ? header[0] : header
}

/**
 * Creates an Express-compatible API versioning middleware.
 *
 * Supports two versioning strategies:
 * 1. URL-based: /v1/agents, /v2/agents
 * 2. Header-based: X-API-Version: v1
 *
 * URL version takes precedence. If neither is specified, defaults to the
 * latest current version.
 *
 * Sets response headers:
 * - X-API-Version: the resolved version
 * - X-API-Deprecated: true (if using a deprecated version)
 * - X-API-Sunset: ISO date (if the version has a sunset date)
 */
export function createVersioningMiddleware(_config: GatewayConfig = {}) {
  // Find the default (latest current) version
  const defaultVersion = Object.values(API_VERSIONS).find((v) => v.status === 'current')?.version ?? 'v1'

  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = req.auth?.requestId ?? 'unknown'

    // 1. Try URL-based version
    let version = extractVersionFromUrl(req.url)

    // 2. Fall back to header-based version
    if (!version) {
      version = extractVersionFromHeader(req.headers)
    }

    // 3. Default to latest current version
    if (!version) {
      version = defaultVersion
    }

    // Validate version exists
    const versionInfo: VersionInfo | undefined = API_VERSIONS[version]
    if (!versionInfo) {
      const err = validationError(
        `Unsupported API version: "${version}". Supported versions: ${Object.keys(API_VERSIONS).join(', ')}`,
        'version',
      )
      res.status(err.statusCode)
      res.json(err.toBody(requestId))
      return
    }

    // Set version response headers
    res.setHeader('X-API-Version', version)

    if (versionInfo.status === 'deprecated') {
      res.setHeader('X-API-Deprecated', 'true')
      if (versionInfo.sunsetDate) {
        res.setHeader('X-API-Sunset', versionInfo.sunsetDate)
      }
    }

    if (versionInfo.status === 'sunset') {
      const err = validationError(
        `API version "${version}" has been sunset. Please migrate to a supported version.`,
        'version',
      )
      res.status(410)
      res.json(err.toBody(requestId))
      return
    }

    // Inject version into auth context
    if (req.auth) {
      req.auth.apiVersion = version
    }

    next()
  }
}


