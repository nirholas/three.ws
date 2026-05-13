// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Enterprise Auth — Password Service
// Bcrypt hashing, validation, strength checking, account lockout
// =============================================================================

import bcrypt from 'bcryptjs'
import type { PasswordValidation } from './types'
import { LOCKOUT_POLICY } from './types'
import { WeakPasswordError } from './errors'

const BCRYPT_COST_FACTOR = 12
const MIN_PASSWORD_LENGTH = 12

/** Hash a password using bcrypt with cost factor 12. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR)
}

/** Compare a plaintext password against a bcrypt hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/** Validate password strength. */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = []
  let score = 0

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  } else {
    score += Math.min(2, Math.floor(password.length / 8))
  }

  if (/[a-z]/.test(password)) score++
  else errors.push('Password must contain at least one lowercase letter')

  if (/[A-Z]/.test(password)) score++
  else errors.push('Password must contain at least one uppercase letter')

  if (/[0-9]/.test(password)) score++
  else errors.push('Password must contain at least one number')

  if (/[^a-zA-Z0-9]/.test(password)) score++
  else errors.push('Password must contain at least one special character')

  // Check for common patterns
  const commonPatterns = [
    /^12345/,
    /password/i,
    /qwerty/i,
    /abc123/i,
    /(.)\1{3,}/,  // 4+ repeated chars
  ]
  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      errors.push('Password contains a common pattern')
      score = Math.max(0, score - 2)
      break
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    score: Math.min(5, score),
  }
}

/** Validate password and throw if weak. */
export function requireStrongPassword(password: string): void {
  const result = validatePassword(password)
  if (!result.valid) {
    throw new WeakPasswordError(result.errors)
  }
}

/** Determine lockout duration based on failed attempts. */
export function getLockoutDuration(failedAttempts: number): { locked: boolean; lockedUntil: Date | null } {
  if (failedAttempts >= LOCKOUT_POLICY.permanentThreshold) {
    return { locked: true, lockedUntil: null }
  }
  if (failedAttempts >= LOCKOUT_POLICY.secondThreshold) {
    const until = new Date()
    until.setMinutes(until.getMinutes() + LOCKOUT_POLICY.secondLockoutMinutes)
    return { locked: true, lockedUntil: until }
  }
  if (failedAttempts >= LOCKOUT_POLICY.firstThreshold) {
    const until = new Date()
    until.setMinutes(until.getMinutes() + LOCKOUT_POLICY.firstLockoutMinutes)
    return { locked: true, lockedUntil: until }
  }
  return { locked: false, lockedUntil: null }
}

/** Check if an account is currently locked. */
export function isAccountLocked(
  failedAttempts: number,
  lockedUntil: Date | null,
): boolean {
  if (failedAttempts >= LOCKOUT_POLICY.permanentThreshold) {
    return true
  }
  if (lockedUntil && lockedUntil > new Date()) {
    return true
  }
  return false
}


