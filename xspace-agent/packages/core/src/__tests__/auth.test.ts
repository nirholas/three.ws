// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

// =============================================================================
// Enterprise Auth — Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  requireStrongPassword,
  getLockoutDuration,
  isAccountLocked,
} from '../auth/password'
import {
  signAccessToken,
  verifyAccessToken,
} from '../auth/tokens'
import {
  encrypt,
  decrypt,
  generateSecureToken,
  sha256,
  generateUUID,
} from '../auth/crypto'
import {
  InvalidCredentialsError,
  AccountLockedError,
  EmailAlreadyExistsError,
  TokenError,
  MFARequiredError,
  MFAVerificationError,
  SSOEnforcedError,
  SAMLError,
  OIDCError,
  SessionLimitError,
  WeakPasswordError,
} from '../auth/errors'
import { SESSION_LIMITS, LOCKOUT_POLICY } from '../auth/types'
import { generateSPMetadata, extractSAMLProfile } from '../auth/saml'
import { extractBearerToken } from '../auth/middleware'
import type { SAMLConfig } from '../auth/types'

// =============================================================================
// Password Service Tests
// =============================================================================

describe('Password Service', () => {
  describe('hashPassword / verifyPassword', () => {
    it('should hash and verify a password', async () => {
      const password = 'MySecureP@ssw0rd!'
      const hash = await hashPassword(password)

      expect(hash).toBeDefined()
      expect(hash).not.toBe(password)
      expect(hash.startsWith('$2')).toBe(true) // bcrypt prefix

      const valid = await verifyPassword(password, hash)
      expect(valid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      const hash = await hashPassword('CorrectPassword1!')
      const valid = await verifyPassword('WrongPassword1!', hash)
      expect(valid).toBe(false)
    })

    it('should produce different hashes for same password', async () => {
      const password = 'SamePassword1!'
      const hash1 = await hashPassword(password)
      const hash2 = await hashPassword(password)
      expect(hash1).not.toBe(hash2) // Different salts
    })
  })

  describe('validatePassword', () => {
    it('should accept a strong password', () => {
      const result = validatePassword('MyStr0ng!Pass123')
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.score).toBeGreaterThan(0)
    })

    it('should reject a short password', () => {
      const result = validatePassword('Sh0rt!')
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('12 characters'))).toBe(true)
    })

    it('should require lowercase letters', () => {
      const result = validatePassword('ALLUPPERCASE123!')
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true)
    })

    it('should require uppercase letters', () => {
      const result = validatePassword('alllowercase123!')
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true)
    })

    it('should require numbers', () => {
      const result = validatePassword('NoNumbersHere!!')
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('number'))).toBe(true)
    })

    it('should require special characters', () => {
      const result = validatePassword('NoSpecialChars1A')
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('special'))).toBe(true)
    })

    it('should detect common patterns', () => {
      const result = validatePassword('password123ABC!')
      expect(result.errors.some(e => e.includes('common pattern'))).toBe(true)
    })

    it('should detect repeated characters', () => {
      const result = validatePassword('aaaaaBBBBB1234!')
      expect(result.errors.some(e => e.includes('common pattern'))).toBe(true)
    })
  })

  describe('requireStrongPassword', () => {
    it('should not throw for a strong password', () => {
      expect(() => requireStrongPassword('MyStr0ng!Pass123')).not.toThrow()
    })

    it('should throw WeakPasswordError for a weak password', () => {
      expect(() => requireStrongPassword('weak')).toThrow(WeakPasswordError)
    })
  })

  describe('getLockoutDuration', () => {
    it('should not lock for fewer than 5 failed attempts', () => {
      const result = getLockoutDuration(4)
      expect(result.locked).toBe(false)
      expect(result.lockedUntil).toBeNull()
    })

    it('should lock for 15 minutes at 5 failed attempts', () => {
      const result = getLockoutDuration(5)
      expect(result.locked).toBe(true)
      expect(result.lockedUntil).toBeDefined()
      const diffMinutes = (result.lockedUntil!.getTime() - Date.now()) / 60_000
      expect(diffMinutes).toBeCloseTo(15, 0)
    })

    it('should lock for 1 hour at 10 failed attempts', () => {
      const result = getLockoutDuration(10)
      expect(result.locked).toBe(true)
      const diffMinutes = (result.lockedUntil!.getTime() - Date.now()) / 60_000
      expect(diffMinutes).toBeCloseTo(60, 0)
    })

    it('should permanently lock at 20 failed attempts', () => {
      const result = getLockoutDuration(20)
      expect(result.locked).toBe(true)
      expect(result.lockedUntil).toBeNull()
    })
  })

  describe('isAccountLocked', () => {
    it('should return false for no lockout', () => {
      expect(isAccountLocked(0, null)).toBe(false)
      expect(isAccountLocked(4, null)).toBe(false)
    })

    it('should return true if locked until future date', () => {
      const future = new Date(Date.now() + 60_000)
      expect(isAccountLocked(5, future)).toBe(true)
    })

    it('should return false if lockout has expired', () => {
      const past = new Date(Date.now() - 60_000)
      expect(isAccountLocked(5, past)).toBe(false)
    })

    it('should return true for permanent lockout', () => {
      expect(isAccountLocked(20, null)).toBe(true)
    })
  })
})

// =============================================================================
// Crypto Tests
// =============================================================================

describe('Crypto Utilities', () => {
  const originalEnv = process.env.AUTH_ENCRYPTION_KEY

  beforeEach(() => {
    // Set a test encryption key (64 hex chars = 32 bytes)
    process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64)
  })

  afterEach(() => {
    if (originalEnv) {
      process.env.AUTH_ENCRYPTION_KEY = originalEnv
    } else {
      delete process.env.AUTH_ENCRYPTION_KEY
    }
  })

  describe('encrypt / decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const plaintext = 'Hello, World! This is a secret.'
      const ciphertext = encrypt(plaintext)

      expect(ciphertext).not.toBe(plaintext)
      expect(ciphertext.split(':')).toHaveLength(3) // iv:tag:encrypted

      const decrypted = decrypt(ciphertext)
      expect(decrypted).toBe(plaintext)
    })

    it('should produce different ciphertexts for same plaintext', () => {
      const plaintext = 'Same input'
      const c1 = encrypt(plaintext)
      const c2 = encrypt(plaintext)
      expect(c1).not.toBe(c2) // Different IVs
    })

    it('should throw on invalid ciphertext format', () => {
      expect(() => decrypt('not-valid')).toThrow('Invalid ciphertext format')
    })

    it('should throw on tampered ciphertext', () => {
      const ciphertext = encrypt('secret')
      const parts = ciphertext.split(':')
      parts[2] = 'ff' + parts[2].substring(2) // Tamper with encrypted data
      expect(() => decrypt(parts.join(':'))).toThrow()
    })

    it('should handle empty strings', () => {
      const ciphertext = encrypt('')
      expect(decrypt(ciphertext)).toBe('')
    })

    it('should handle unicode text', () => {
      const plaintext = 'Hello 世界! 🔐 安全'
      const ciphertext = encrypt(plaintext)
      expect(decrypt(ciphertext)).toBe(plaintext)
    })
  })

  describe('generateSecureToken', () => {
    it('should generate tokens of expected length', () => {
      const token = generateSecureToken(32)
      expect(token).toHaveLength(64) // 32 bytes = 64 hex chars
    })

    it('should generate unique tokens', () => {
      const t1 = generateSecureToken()
      const t2 = generateSecureToken()
      expect(t1).not.toBe(t2)
    })
  })

  describe('sha256', () => {
    it('should produce consistent hash', () => {
      const hash1 = sha256('test input')
      const hash2 = sha256('test input')
      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different inputs', () => {
      expect(sha256('input1')).not.toBe(sha256('input2'))
    })

    it('should produce 64-char hex string', () => {
      const hash = sha256('anything')
      expect(hash).toHaveLength(64)
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
    })
  })

  describe('generateUUID', () => {
    it('should produce valid UUID v4 format', () => {
      const uuid = generateUUID()
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      expect(uuidRegex.test(uuid)).toBe(true)
    })

    it('should produce unique UUIDs', () => {
      const u1 = generateUUID()
      const u2 = generateUUID()
      expect(u1).not.toBe(u2)
    })
  })
})

// =============================================================================
// JWT Token Tests
// =============================================================================

describe('JWT Token Service', () => {
  const originalEnv = process.env.JWT_SECRET

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough-for-testing'
  })

  afterEach(() => {
    if (originalEnv) {
      process.env.JWT_SECRET = originalEnv
    } else {
      delete process.env.JWT_SECRET
    }
  })

  describe('signAccessToken / verifyAccessToken', () => {
    it('should sign and verify an access token', () => {
      const token = signAccessToken({
        userId: 'user-123',
        orgId: 'org-456',
        role: 'admin',
        plan: 'pro',
        scopes: ['agents:read', 'agents:write'],
      })

      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT format

      const payload = verifyAccessToken(token)
      expect(payload.sub).toBe('user-123')
      expect(payload.org).toBe('org-456')
      expect(payload.role).toBe('admin')
      expect(payload.plan).toBe('pro')
      expect(payload.scopes).toEqual(['agents:read', 'agents:write'])
      expect(payload.iat).toBeDefined()
      expect(payload.exp).toBeDefined()
      expect(payload.exp).toBeGreaterThan(payload.iat)
    })

    it('should reject an invalid token', () => {
      expect(() => verifyAccessToken('invalid.token.here')).toThrow(TokenError)
    })

    it('should reject a token signed with a different secret', () => {
      const token = signAccessToken({
        userId: 'user-123',
        orgId: 'org-456',
        role: 'member',
        plan: 'free',
        scopes: [],
      })

      process.env.JWT_SECRET = 'different-secret-key'
      expect(() => verifyAccessToken(token)).toThrow(TokenError)
    })
  })

  describe('missing JWT_SECRET', () => {
    it('should throw when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET
      expect(() =>
        signAccessToken({
          userId: 'user-123',
          orgId: 'org-456',
          role: 'member',
          plan: 'free',
          scopes: [],
        }),
      ).toThrow('JWT_SECRET')
    })
  })
})

// =============================================================================
// Error Classes Tests
// =============================================================================

describe('Auth Error Classes', () => {
  it('InvalidCredentialsError should have correct code', () => {
    const err = new InvalidCredentialsError()
    expect(err.code).toBe('INVALID_CREDENTIALS')
    expect(err.name).toBe('InvalidCredentialsError')
    expect(err.hint).toBeTruthy()
  })

  it('AccountLockedError should include lockout time', () => {
    const until = new Date(Date.now() + 900_000)
    const err = new AccountLockedError(until)
    expect(err.code).toBe('ACCOUNT_LOCKED')
    expect(err.lockedUntil).toBe(until)
    expect(err.message).toContain(until.toISOString())
  })

  it('AccountLockedError should handle permanent lock', () => {
    const err = new AccountLockedError(null)
    expect(err.message).toContain('permanently locked')
    expect(err.lockedUntil).toBeNull()
  })

  it('EmailAlreadyExistsError should include email', () => {
    const err = new EmailAlreadyExistsError('test@example.com')
    expect(err.code).toBe('EMAIL_EXISTS')
    expect(err.message).toContain('test@example.com')
  })

  it('TokenError should handle all reasons', () => {
    for (const reason of ['expired', 'invalid', 'revoked', 'replay'] as const) {
      const err = new TokenError(reason)
      expect(err.code).toBe('TOKEN_ERROR')
      expect(err.name).toBe('TokenError')
    }
  })

  it('MFARequiredError should have correct code', () => {
    const err = new MFARequiredError()
    expect(err.code).toBe('MFA_REQUIRED')
  })

  it('MFAVerificationError should have correct code', () => {
    const err = new MFAVerificationError()
    expect(err.code).toBe('MFA_INVALID')
  })

  it('SSOEnforcedError should include org slug', () => {
    const err = new SSOEnforcedError('acme-corp')
    expect(err.code).toBe('SSO_ENFORCED')
    expect(err.message).toContain('acme-corp')
  })

  it('SAMLError should wrap message', () => {
    const err = new SAMLError('invalid certificate')
    expect(err.code).toBe('SAML_ERROR')
    expect(err.message).toContain('invalid certificate')
  })

  it('OIDCError should wrap message', () => {
    const err = new OIDCError('discovery failed')
    expect(err.code).toBe('OIDC_ERROR')
    expect(err.message).toContain('discovery failed')
  })

  it('SessionLimitError should include limit', () => {
    const err = new SessionLimitError(5)
    expect(err.code).toBe('SESSION_LIMIT')
    expect(err.message).toContain('5')
  })

  it('WeakPasswordError should include validation errors', () => {
    const errors = ['Too short', 'Missing uppercase']
    const err = new WeakPasswordError(errors)
    expect(err.code).toBe('WEAK_PASSWORD')
    expect(err.validationErrors).toEqual(errors)
    expect(err.message).toContain('Too short')
    expect(err.message).toContain('Missing uppercase')
  })

  it('all auth errors should extend XSpaceError', () => {
    const errors = [
      new InvalidCredentialsError(),
      new AccountLockedError(null),
      new EmailAlreadyExistsError('test@test.com'),
      new TokenError('invalid'),
      new MFARequiredError(),
      new MFAVerificationError(),
      new SSOEnforcedError('org'),
      new SAMLError('err'),
      new OIDCError('err'),
      new SessionLimitError(5),
      new WeakPasswordError(['err']),
    ]

    for (const err of errors) {
      expect(err).toBeInstanceOf(Error)
      expect(err.code).toBeDefined()
      expect(err.hint).toBeDefined()
      expect(typeof err.toString()).toBe('string')
    }
  })
})

// =============================================================================
// SAML Tests
// =============================================================================

describe('SAML Service', () => {
  describe('generateSPMetadata', () => {
    it('should generate valid SP metadata XML', () => {
      const xml = generateSPMetadata('acme-corp', 'https://app.xspace.dev')

      expect(xml).toContain('<?xml version="1.0"?>')
      expect(xml).toContain('EntityDescriptor')
      expect(xml).toContain('entityID="https://app.xspace.dev/auth/saml/acme-corp"')
      expect(xml).toContain('SPSSODescriptor')
      expect(xml).toContain('AssertionConsumerService')
      expect(xml).toContain('Location="https://app.xspace.dev/auth/saml/acme-corp"')
      expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST')
    })
  })

  describe('extractSAMLProfile', () => {
    const baseConfig: SAMLConfig = {
      enabled: true,
      entryPoint: 'https://idp.example.com/sso',
      issuer: 'https://app.xspace.dev',
      cert: 'MIIC...',
      callbackUrl: 'https://app.xspace.dev/auth/saml/acme',
      signatureAlgorithm: 'sha256',
      wantAuthnResponseSigned: true,
      wantAssertionsSigned: true,
      emailAttribute: 'email',
      firstNameAttribute: 'firstName',
      lastNameAttribute: 'lastName',
      jitProvisioning: true,
      defaultRole: 'member',
      enforceSSO: false,
    }

    it('should extract profile from SAML response', () => {
      const samlResponse = {
        nameID: 'user@example.com',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }

      const profile = extractSAMLProfile(samlResponse, baseConfig)

      expect(profile.nameID).toBe('user@example.com')
      expect(profile.email).toBe('user@example.com')
      expect(profile.firstName).toBe('John')
      expect(profile.lastName).toBe('Doe')
    })

    it('should fall back to nameID for email', () => {
      const samlResponse = {
        nameID: 'user@example.com',
      }

      const profile = extractSAMLProfile(samlResponse, baseConfig)
      expect(profile.email).toBe('user@example.com')
    })

    it('should throw if email is missing', () => {
      const samlResponse = { nameID: undefined }
      expect(() => extractSAMLProfile(samlResponse, baseConfig)).toThrow(SAMLError)
    })

    it('should extract groups when configured', () => {
      const config = { ...baseConfig, groupsAttribute: 'groups' }
      const samlResponse = {
        nameID: 'user@example.com',
        email: 'user@example.com',
        groups: ['Engineering', 'Admin'],
      }

      const profile = extractSAMLProfile(samlResponse, config)
      expect(profile.groups).toEqual(['Engineering', 'Admin'])
    })

    it('should handle custom attribute mapping', () => {
      const config = {
        ...baseConfig,
        emailAttribute: 'mail',
        firstNameAttribute: 'givenName',
        lastNameAttribute: 'sn',
      }
      const samlResponse = {
        nameID: 'user@example.com',
        mail: 'custom@example.com',
        givenName: 'Jane',
        sn: 'Smith',
      }

      const profile = extractSAMLProfile(samlResponse, config)
      expect(profile.email).toBe('custom@example.com')
      expect(profile.firstName).toBe('Jane')
      expect(profile.lastName).toBe('Smith')
    })
  })
})

// =============================================================================
// Middleware Tests
// =============================================================================

describe('Auth Middleware', () => {
  describe('extractBearerToken', () => {
    it('should extract token from valid Authorization header', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123')
    })

    it('should return null for missing header', () => {
      expect(extractBearerToken(undefined)).toBeNull()
      expect(extractBearerToken('')).toBeNull()
    })

    it('should return null for non-Bearer schemes', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull()
    })

    it('should be case-insensitive for scheme', () => {
      expect(extractBearerToken('bearer abc123')).toBe('abc123')
      expect(extractBearerToken('BEARER abc123')).toBe('abc123')
    })

    it('should return null for malformed headers', () => {
      expect(extractBearerToken('Bearer')).toBeNull()
      expect(extractBearerToken('Bearer a b c')).toBeNull()
    })
  })
})

// =============================================================================
// Constants Tests
// =============================================================================

describe('Auth Constants', () => {
  describe('SESSION_LIMITS', () => {
    it('should define limits for all plan tiers', () => {
      expect(SESSION_LIMITS.free).toBe(2)
      expect(SESSION_LIMITS.developer).toBe(5)
      expect(SESSION_LIMITS.pro).toBe(10)
      expect(SESSION_LIMITS.business).toBe(Infinity)
      expect(SESSION_LIMITS.enterprise).toBe(Infinity)
    })
  })

  describe('LOCKOUT_POLICY', () => {
    it('should define escalating thresholds', () => {
      expect(LOCKOUT_POLICY.firstThreshold).toBe(5)
      expect(LOCKOUT_POLICY.secondThreshold).toBe(10)
      expect(LOCKOUT_POLICY.permanentThreshold).toBe(20)
      expect(LOCKOUT_POLICY.firstThreshold).toBeLessThan(LOCKOUT_POLICY.secondThreshold)
      expect(LOCKOUT_POLICY.secondThreshold).toBeLessThan(LOCKOUT_POLICY.permanentThreshold)
    })

    it('should define escalating lockout durations', () => {
      expect(LOCKOUT_POLICY.firstLockoutMinutes).toBe(15)
      expect(LOCKOUT_POLICY.secondLockoutMinutes).toBe(60)
      expect(LOCKOUT_POLICY.firstLockoutMinutes).toBeLessThan(LOCKOUT_POLICY.secondLockoutMinutes)
    })
  })
})


