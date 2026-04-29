// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Enterprise Auth — Error Classes
// =============================================================================

import { XSpaceError } from '../errors'

/**
 * Thrown when user credentials are invalid (wrong password, unknown email).
 */
export class InvalidCredentialsError extends XSpaceError {
  constructor(message = 'Invalid email or password') {
    super(
      'INVALID_CREDENTIALS',
      message,
      'Check your email and password. If you forgot your password, use the password reset flow.',
    )
    this.name = 'InvalidCredentialsError'
  }
}

/**
 * Thrown when an account is locked due to too many failed login attempts.
 */
export class AccountLockedError extends XSpaceError {
  public readonly lockedUntil: Date | null

  constructor(lockedUntil: Date | null) {
    const msg = lockedUntil
      ? `Account is locked until ${lockedUntil.toISOString()}`
      : 'Account is permanently locked'
    super(
      'ACCOUNT_LOCKED',
      msg,
      lockedUntil
        ? 'Wait for the lockout period to expire, or contact support.'
        : 'Contact your organization admin or support to unlock the account.',
    )
    this.name = 'AccountLockedError'
    this.lockedUntil = lockedUntil
  }
}

/**
 * Thrown when email is already registered.
 */
export class EmailAlreadyExistsError extends XSpaceError {
  constructor(email: string) {
    super(
      'EMAIL_EXISTS',
      `Email already registered: ${email}`,
      'Use a different email address, or log in with your existing account.',
    )
    this.name = 'EmailAlreadyExistsError'
  }
}

/**
 * Thrown when a JWT token is invalid, expired, or malformed.
 */
export class TokenError extends XSpaceError {
  constructor(reason: 'expired' | 'invalid' | 'revoked' | 'replay') {
    const messages: Record<string, string> = {
      expired: 'Token has expired',
      invalid: 'Token is invalid or malformed',
      revoked: 'Token has been revoked',
      replay: 'Token reuse detected — all sessions have been invalidated for security',
    }
    super(
      'TOKEN_ERROR',
      messages[reason] ?? 'Token error',
      reason === 'expired'
        ? 'Use the refresh token to obtain a new access token.'
        : 'Log in again to obtain new tokens.',
    )
    this.name = 'TokenError'
  }
}

/**
 * Thrown when MFA is required but not provided.
 */
export class MFARequiredError extends XSpaceError {
  constructor() {
    super(
      'MFA_REQUIRED',
      'Multi-factor authentication code is required',
      'Provide the 6-digit code from your authenticator app.',
    )
    this.name = 'MFARequiredError'
  }
}

/**
 * Thrown when MFA verification fails.
 */
export class MFAVerificationError extends XSpaceError {
  constructor(message = 'Invalid MFA code') {
    super(
      'MFA_INVALID',
      message,
      'Check the code from your authenticator app. Codes expire every 30 seconds.',
    )
    this.name = 'MFAVerificationError'
  }
}

/**
 * Thrown when SSO is enforced for an org but user tries password login.
 */
export class SSOEnforcedError extends XSpaceError {
  constructor(orgSlug: string) {
    super(
      'SSO_ENFORCED',
      `SSO is enforced for organization "${orgSlug}"`,
      'Use your organization\'s SSO login instead of email/password.',
    )
    this.name = 'SSOEnforcedError'
  }
}

/**
 * Thrown when SAML assertion validation fails.
 */
export class SAMLError extends XSpaceError {
  constructor(message: string) {
    super(
      'SAML_ERROR',
      `SAML authentication failed: ${message}`,
      'Check your SAML IdP configuration and certificate.',
    )
    this.name = 'SAMLError'
  }
}

/**
 * Thrown when OIDC authentication fails.
 */
export class OIDCError extends XSpaceError {
  constructor(message: string) {
    super(
      'OIDC_ERROR',
      `OIDC authentication failed: ${message}`,
      'Check your OIDC provider configuration.',
    )
    this.name = 'OIDCError'
  }
}

/**
 * Thrown when session limit is exceeded for the plan.
 */
export class SessionLimitError extends XSpaceError {
  constructor(limit: number) {
    super(
      'SESSION_LIMIT',
      `Maximum concurrent sessions (${limit}) exceeded`,
      'Revoke an existing session or upgrade your plan for more concurrent sessions.',
    )
    this.name = 'SessionLimitError'
  }
}

/**
 * Thrown when password doesn't meet policy requirements.
 */
export class WeakPasswordError extends XSpaceError {
  public readonly validationErrors: string[]

  constructor(errors: string[]) {
    super(
      'WEAK_PASSWORD',
      `Password does not meet requirements:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      'Choose a stronger password with at least 12 characters, mixing letters, numbers, and symbols.',
    )
    this.name = 'WeakPasswordError'
    this.validationErrors = errors
  }
}


