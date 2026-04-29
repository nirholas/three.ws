// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// API Gateway — Main exports
// =============================================================================

// Types
export {
  API_SCOPES,
  API_VERSIONS,
  type ApiScope,
  type ApiKeyEnvironment,
  type ParsedApiKey,
  type ApiVersion,
  type VersionStatus,
  type VersionInfo,
  type ApiErrorType,
  type ApiErrorBody,
  type ApiRequestLog,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
  type UpdateApiKeyRequest,
  type ApiKeyInfo,
  type RotateApiKeyResponse,
  type AuthenticatedRequest,
  type GatewayConfig,
} from './types'

// API Key Service
export { ApiKeyService } from './api-key-service'

// Errors
export {
  ApiError,
  invalidApiKey,
  missingApiKey,
  expiredApiKey,
  insufficientScope,
  rateLimitExceeded,
  validationError,
  notFoundError,
  conflictError,
  internalError,
} from './errors'

// Middleware
export {
  createAuthMiddleware,
  requireScope,
  createRateLimitMiddleware,
  createVersioningMiddleware,
  createRequestLoggerMiddleware,
  createErrorHandlerMiddleware,
  onRequestLog,
  offRequestLog,
  clearRequestLogHandlers,
  type RequestLogHandler,
} from './middleware'

// Route handlers
export {
  createApiKey,
  listApiKeys,
  getApiKey,
  updateApiKey,
  deleteApiKey,
  rotateApiKey,
  getApiStatus,
} from './routes'


