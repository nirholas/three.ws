// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Enterprise Auth — MFA Service
// TOTP setup, verification, and recovery codes
// =============================================================================

import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { mfaSecrets, users } from '../db/schema'
import { encrypt, decrypt, generateSecureToken } from './crypto'
import { MFARequiredError, MFAVerificationError } from './errors'
import type { MFASetupResult } from './types'

const APP_NAME = 'XSpace Agent'
const RECOVERY_CODE_COUNT = 10

/** Generate recovery codes. */
function generateRecoveryCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    // Format: XXXX-XXXX (8 alphanumeric chars)
    const raw = generateSecureToken(4).substring(0, 8).toUpperCase()
    codes.push(`${raw.substring(0, 4)}-${raw.substring(4, 8)}`)
  }
  return codes
}

/** Set up MFA for a user. Returns secret, QR code, and recovery codes. */
export async function setupMFA(userId: string, userEmail: string): Promise<MFASetupResult> {
  const db = getDatabase()

  // Generate TOTP secret
  const secret = speakeasy.generateSecret({
    name: `${APP_NAME} (${userEmail})`,
    issuer: APP_NAME,
    length: 32,
  })

  const recoveryCodes = generateRecoveryCodes()

  // Encrypt and store
  const secretEncrypted = encrypt(secret.base32)
  const recoveryCodesEncrypted = encrypt(JSON.stringify(recoveryCodes))

  // Upsert: delete existing unverified secret, then insert
  await db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId))

  await db.insert(mfaSecrets).values({
    userId,
    secretEncrypted,
    recoveryCodesEncrypted,
    verified: 0,
  })

  // Generate QR code
  const otpauthUrl = secret.otpauth_url!
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)

  return {
    secret: secret.base32,
    otpauthUrl,
    qrCodeDataUrl,
    recoveryCodes,
  }
}

/** Verify a TOTP code and mark MFA as active. */
export async function verifyMFASetup(userId: string, code: string): Promise<boolean> {
  const db = getDatabase()

  const [record] = await db
    .select()
    .from(mfaSecrets)
    .where(eq(mfaSecrets.userId, userId))
    .limit(1)

  if (!record) {
    throw new MFAVerificationError('MFA has not been set up')
  }

  const secret = decrypt(record.secretEncrypted)

  const isValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1, // Allow 1 step before/after for clock drift
  })

  if (!isValid) {
    throw new MFAVerificationError()
  }

  // Mark as verified
  await db
    .update(mfaSecrets)
    .set({ verified: 1 })
    .where(eq(mfaSecrets.userId, userId))

  // Enable MFA on the user record
  await db
    .update(users)
    .set({ mfaEnabled: true } as any)
    .where(eq(users.id, userId))

  return true
}

/** Verify a TOTP code during login. */
export async function verifyMFACode(userId: string, code: string): Promise<boolean> {
  const db = getDatabase()

  const [record] = await db
    .select()
    .from(mfaSecrets)
    .where(eq(mfaSecrets.userId, userId))
    .limit(1)

  if (!record || !record.verified) {
    throw new MFAVerificationError('MFA is not enabled')
  }

  const secret = decrypt(record.secretEncrypted)

  // First try TOTP verification
  const isValid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1,
  })

  if (isValid) return true

  // Try recovery code
  return useRecoveryCode(userId, code, record)
}

/** Try using a recovery code (one-time use). */
async function useRecoveryCode(
  userId: string,
  code: string,
  record: { recoveryCodesEncrypted: string },
): Promise<boolean> {
  const db = getDatabase()
  const normalizedCode = code.toUpperCase().replace(/\s/g, '')
  const codes: string[] = JSON.parse(decrypt(record.recoveryCodesEncrypted))

  const index = codes.findIndex(
    (c) => c.replace(/-/g, '') === normalizedCode.replace(/-/g, ''),
  )

  if (index === -1) {
    throw new MFAVerificationError()
  }

  // Remove used recovery code
  codes.splice(index, 1)
  const recoveryCodesEncrypted = encrypt(JSON.stringify(codes))

  await db
    .update(mfaSecrets)
    .set({ recoveryCodesEncrypted })
    .where(eq(mfaSecrets.userId, userId))

  return true
}

/** Disable MFA for a user. Requires valid MFA code. */
export async function disableMFA(userId: string, code: string): Promise<void> {
  // Verify current MFA first
  await verifyMFACode(userId, code)

  const db = getDatabase()

  // Remove MFA secret
  await db.delete(mfaSecrets).where(eq(mfaSecrets.userId, userId))

  // Disable MFA on user record
  await db
    .update(users)
    .set({ mfaEnabled: false } as any)
    .where(eq(users.id, userId))
}

/** Check if MFA is enabled for a user. */
export async function isMFAEnabled(userId: string): Promise<boolean> {
  const db = getDatabase()
  const [record] = await db
    .select({ verified: mfaSecrets.verified })
    .from(mfaSecrets)
    .where(eq(mfaSecrets.userId, userId))
    .limit(1)

  return !!record && record.verified === 1
}


