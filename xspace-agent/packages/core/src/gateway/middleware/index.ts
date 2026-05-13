// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

// =============================================================================
// API Gateway — Middleware barrel export
// =============================================================================

export { createAuthMiddleware, requireScope } from './authenticate'
export { createRateLimitMiddleware } from './rate-limit'
export { createVersioningMiddleware } from './versioning'
export {
  createRequestLoggerMiddleware,
  onRequestLog,
  offRequestLog,
  clearRequestLogHandlers,
  type RequestLogHandler,
} from './request-logger'
export { createErrorHandlerMiddleware } from './error-handler'


