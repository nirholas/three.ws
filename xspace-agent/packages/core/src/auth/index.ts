// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// Enterprise Auth — Public API
// =============================================================================

// Auth service (main entry point)
export {
  register,
  login,
  logout,
  logoutAll,
  refreshTokens,
  createPasswordResetToken,
  resetPassword,
  listSessions,
  setupMFA,
  verifyMFASetup,
  disableMFA,
} from './service'

// Token management
export {
  signAccessToken,
  verifyAccessToken,
  createTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from './tokens'

// Password utilities
export {
  hashPassword,
  verifyPassword,
  validatePassword,
  requireStrongPassword,
  getLockoutDuration,
  isAccountLocked,
} from './password'

// MFA
export {
  setupMFA as setupMFAForUser,
  verifyMFASetup as verifyMFASetupForUser,
  verifyMFACode,
  disableMFA as disableMFAForUser,
  isMFAEnabled,
} from './mfa'

// Session management
export {
  createSession,
  listSessions as listUserSessions,
  revokeSession,
  revokeAllSessions,
  touchSession,
  cleanupExpiredSessions,
} from './sessions'

// SAML
export {
  getSAMLConfig,
  getSAMLConfigBySlug,
  upsertSAMLConfig,
  generateSPMetadata,
  extractSAMLProfile,
  provisionSAMLUser,
  isSSOEnforced,
} from './saml'

// OIDC
export {
  getOIDCConfig,
  getOIDCConfigBySlug,
  upsertOIDCConfig,
  getOIDCAuthorizationUrl,
  handleOIDCCallback,
  provisionOIDCUser,
} from './oidc'

// OAuth
export {
  findOrCreateOAuthUser,
  linkOAuthAccount,
  getLinkedAccounts,
  unlinkOAuthAccount,
  getOAuthConfig,
} from './oauth'

// Middleware
export {
  authMiddleware,
  rateLimitMiddleware,
  requireScopes,
  requireRole,
  resolveAuthContext,
  extractBearerToken,
  verifyToken,
} from './middleware'

// Crypto utilities
export {
  encrypt,
  decrypt,
  generateSecureToken,
  sha256,
} from './crypto'

// Error classes
export {
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
} from './errors'

// Types
export type {
  AccessTokenPayload,
  RefreshTokenRecord,
  TokenPair,
  UserSession,
  SAMLConfig,
  SAMLProfile,
  OIDCConfig,
  OIDCProfile,
  OAuthProvider,
  OAuthProfile,
  OAuthAccount,
  MFASetupResult,
  MFASecretRecord,
  AuthEventType,
  AuthEvent,
  AuthRequestContext,
  RegisterInput,
  LoginInput,
  AuthResult,
  PasswordValidation,
} from './types'

export { SESSION_LIMITS, LOCKOUT_POLICY } from './types'

export type { AuthenticatedUser } from './middleware'
export type { OAuthProviderConfig } from './oauth'


