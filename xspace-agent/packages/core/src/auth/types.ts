// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

// =============================================================================
// Enterprise Auth — Type Definitions
// =============================================================================

import type { OrgId, UserId, OrgRole, PlanTier } from '../tenant/types'

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

/** Access token payload (short-lived, 15 minutes). */
export interface AccessTokenPayload {
  /** User ID. */
  sub: string
  /** Organization ID. */
  org: string
  /** User role within the org. */
  role: OrgRole
  /** Organization plan tier. */
  plan: PlanTier
  /** Permission scopes. */
  scopes: string[]
  /** Issued-at timestamp. */
  iat: number
  /** Expiration timestamp. */
  exp: number
}

/** Refresh token record stored in DB. */
export interface RefreshTokenRecord {
  id: string
  userId: string
  tokenHash: string
  /** Token family for rotation tracking / replay detection. */
  familyId: string
  deviceInfo?: string
  ipAddress?: string
  isRevoked: boolean
  expiresAt: Date
  createdAt: Date
}

/** Token pair returned on login/refresh. */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Active user session record. */
export interface UserSession {
  id: string
  userId: string
  orgId: string
  refreshTokenId?: string
  deviceInfo?: string
  ipAddress?: string
  userAgent?: string
  lastActiveAt: Date
  expiresAt: Date
  createdAt: Date
}

// ---------------------------------------------------------------------------
// SAML
// ---------------------------------------------------------------------------

/** Per-organization SAML 2.0 configuration. */
export interface SAMLConfig {
  enabled: boolean
  /** IdP SSO URL. */
  entryPoint: string
  /** SP Entity ID (our URL). */
  issuer: string
  /** IdP signing certificate. */
  cert: string
  /** Our Assertion Consumer Service URL. */
  callbackUrl: string
  signatureAlgorithm: 'sha256' | 'sha512'
  wantAuthnResponseSigned: boolean
  wantAssertionsSigned: boolean
  /** Attribute mapping. */
  emailAttribute: string
  firstNameAttribute: string
  lastNameAttribute: string
  groupsAttribute?: string
  /** Just-In-Time user creation. */
  jitProvisioning: boolean
  /** Role for JIT-provisioned users. */
  defaultRole: OrgRole
  /** Require SSO (block password login). */
  enforceSSO: boolean
}

/** SAML assertion profile returned by the IdP. */
export interface SAMLProfile {
  nameID: string
  email: string
  firstName?: string
  lastName?: string
  groups?: string[]
}

// ---------------------------------------------------------------------------
// OIDC
// ---------------------------------------------------------------------------

/** Per-organization OpenID Connect configuration. */
export interface OIDCConfig {
  enabled: boolean
  /** OIDC discovery URL. */
  issuerUrl: string
  clientId: string
  /** Encrypted at rest. */
  clientSecret: string
  scopes: string[]
  callbackUrl: string
  /** Claims mapping. */
  emailClaim: string
  nameClaim: string
  groupsClaim?: string
  jitProvisioning: boolean
  defaultRole: OrgRole
  enforceSSO: boolean
}

/** OIDC userinfo claims. */
export interface OIDCProfile {
  sub: string
  email: string
  name?: string
  groups?: string[]
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

/** Supported OAuth providers. */
export type OAuthProvider = 'google' | 'github' | 'microsoft'

/** OAuth profile returned by provider. */
export interface OAuthProfile {
  provider: OAuthProvider
  providerAccountId: string
  email: string
  displayName?: string
  accessToken?: string
  refreshToken?: string
}

/** OAuth account linked to a user. */
export interface OAuthAccount {
  id: string
  userId: string
  provider: OAuthProvider
  providerAccountId: string
  email?: string
  displayName?: string
  createdAt: Date
}

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------

/** MFA setup response. */
export interface MFASetupResult {
  /** Base32-encoded secret. */
  secret: string
  /** otpauth:// URI for QR code scanning. */
  otpauthUrl: string
  /** QR code as data URL (PNG). */
  qrCodeDataUrl: string
  /** 10 one-time recovery codes. */
  recoveryCodes: string[]
}

/** MFA secret record (stored encrypted). */
export interface MFASecretRecord {
  id: string
  userId: string
  secretEncrypted: string
  recoveryCodesEncrypted: string
  verified: boolean
  createdAt: Date
}

// ---------------------------------------------------------------------------
// Auth Events
// ---------------------------------------------------------------------------

export type AuthEventType =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.password_reset'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.token_refresh'
  | 'auth.session_revoked'
  | 'auth.lockout'
  | 'auth.sso_login'
  | 'auth.failed_login'

export interface AuthEvent {
  type: AuthEventType
  userId?: string
  orgId?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

// ---------------------------------------------------------------------------
// Auth Request Context
// ---------------------------------------------------------------------------

/** Information from the incoming request needed for auth operations. */
export interface AuthRequestContext {
  ipAddress: string
  userAgent: string
  deviceInfo?: string
}

// ---------------------------------------------------------------------------
// Registration / Login
// ---------------------------------------------------------------------------

/** Email/password registration input. */
export interface RegisterInput {
  email: string
  password: string
  name: string
  orgName: string
  orgSlug?: string
}

/** Email/password login input. */
export interface LoginInput {
  email: string
  password: string
  mfaCode?: string
}

/** Auth result returned after successful login/register. */
export interface AuthResult {
  user: {
    id: string
    email: string
    name: string | null
    role: OrgRole
    orgId: string
    mfaEnabled: boolean
  }
  tokens: TokenPair
  session: UserSession
  /** True if MFA is required but not yet provided. */
  mfaRequired?: boolean
}

// ---------------------------------------------------------------------------
// Password Policy
// ---------------------------------------------------------------------------

/** Password validation result. */
export interface PasswordValidation {
  valid: boolean
  errors: string[]
  score: number
}

// ---------------------------------------------------------------------------
// Session Limits by Plan
// ---------------------------------------------------------------------------

export const SESSION_LIMITS: Record<PlanTier, number> = {
  free: 2,
  developer: 5,
  pro: 10,
  business: Infinity,
  enterprise: Infinity,
}

// ---------------------------------------------------------------------------
// Lockout Policy
// ---------------------------------------------------------------------------

export const LOCKOUT_POLICY = {
  /** Attempts before first lockout. */
  firstThreshold: 5,
  /** First lockout duration in minutes. */
  firstLockoutMinutes: 15,
  /** Attempts before second lockout. */
  secondThreshold: 10,
  /** Second lockout duration in minutes. */
  secondLockoutMinutes: 60,
  /** Attempts before permanent lock. */
  permanentThreshold: 20,
} as const


