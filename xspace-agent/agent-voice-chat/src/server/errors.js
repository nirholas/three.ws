// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const ERROR_CODES = {
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
}

class AppError extends Error {
  constructor(code, message, httpStatus = 500) {
    super(message)
    this.name = "AppError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(ERROR_CODES.NOT_FOUND, message, 404)
    this.name = "NotFoundError"
  }
}

class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(ERROR_CODES.CONFLICT, message, 409)
    this.name = "ConflictError"
  }
}

class ValidationError extends AppError {
  constructor(message = "Validation error") {
    super(ERROR_CODES.VALIDATION_ERROR, message, 400)
    this.name = "ValidationError"
  }
}

class ProviderError extends AppError {
  constructor(message = "Provider error") {
    super(ERROR_CODES.PROVIDER_ERROR, message, 502)
    this.name = "ProviderError"
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403)
    this.name = "ForbiddenError"
  }
}

module.exports = { ERROR_CODES, AppError, NotFoundError, ConflictError, ValidationError, ProviderError, ForbiddenError }


