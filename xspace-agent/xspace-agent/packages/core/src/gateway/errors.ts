// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// API Gateway — Standardized Error Handling
// =============================================================================

import type { ApiErrorType, ApiErrorBody } from './types'

const DEFAULT_DOCS_BASE = 'https://docs.xspaceagent.com/errors'

/** Structured API error with HTTP status code and standardized body. */
export class ApiError extends Error {
  public readonly statusCode: number
  public readonly type: ApiErrorType
  public readonly code: string
  public readonly param?: string | null
  public readonly docUrl?: string

  constructor(
    statusCode: number,
    type: ApiErrorType,
    code: string,
    message: string,
    param?: string | null,
    docsBaseUrl?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.type = type
    this.code = code
    this.param = param
    this.docUrl = `${docsBaseUrl ?? DEFAULT_DOCS_BASE}/${code}`
  }

  /** Serialize to the standardized error response format. */
  toBody(requestId: string): ApiErrorBody {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        param: this.param ?? null,
        doc_url: this.docUrl,
      },
      request_id: requestId,
    }
  }
}

// ---------------------------------------------------------------------------
// Pre-built error factories
// ---------------------------------------------------------------------------

export function invalidApiKey(docsBase?: string): ApiError {
  return new ApiError(
    401,
    'authentication_error',
    'invalid_api_key',
    'The API key provided is invalid or has been revoked.',
    null,
    docsBase,
  )
}

export function missingApiKey(docsBase?: string): ApiError {
  return new ApiError(
    401,
    'authentication_error',
    'missing_api_key',
    'No API key was provided. Include your key in the Authorization header as "Bearer xsa_...".',
    null,
    docsBase,
  )
}

export function expiredApiKey(docsBase?: string): ApiError {
  return new ApiError(
    401,
    'authentication_error',
    'expired_api_key',
    'The API key has expired. Rotate your key or create a new one.',
    null,
    docsBase,
  )
}

export function insufficientScope(requiredScope: string, docsBase?: string): ApiError {
  return new ApiError(
    403,
    'authorization_error',
    'insufficient_scope',
    `This action requires the "${requiredScope}" scope. Your API key does not have this permission.`,
    'scopes',
    docsBase,
  )
}

export function rateLimitExceeded(retryAfterSeconds: number, docsBase?: string): ApiError {
  return new ApiError(
    429,
    'rate_limit_error',
    'rate_limit_exceeded',
    `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
    null,
    docsBase,
  )
}

export function validationError(message: string, param?: string, docsBase?: string): ApiError {
  return new ApiError(400, 'validation_error', 'invalid_request', message, param, docsBase)
}

export function notFoundError(resource: string, docsBase?: string): ApiError {
  return new ApiError(
    404,
    'not_found_error',
    'resource_not_found',
    `The requested ${resource} was not found.`,
    null,
    docsBase,
  )
}

export function conflictError(message: string, docsBase?: string): ApiError {
  return new ApiError(409, 'conflict_error', 'conflict', message, null, docsBase)
}

export function internalError(docsBase?: string): ApiError {
  return new ApiError(
    500,
    'internal_error',
    'internal_server_error',
    'An unexpected error occurred. Please try again later.',
    null,
    docsBase,
  )
}


