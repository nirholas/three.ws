// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Enterprise Auth — OAuth 2.0 Service
// Google and GitHub social login, account linking
// =============================================================================

import { eq, and } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { oauthAccounts, users } from '../db/schema'
import { encrypt } from './crypto'
import type { OAuthProfile, OAuthAccount, OAuthProvider } from './types'

export interface OAuthProviderConfig {
  google?: {
    clientId: string
    clientSecret: string
    callbackUrl: string
  }
  github?: {
    clientId: string
    clientSecret: string
    callbackUrl: string
  }
  microsoft?: {
    clientId: string
    clientSecret: string
    callbackUrl: string
    tenantId?: string
  }
}

/** Get OAuth config from environment variables. */
export function getOAuthConfig(): OAuthProviderConfig {
  const config: OAuthProviderConfig = {}

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    config.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? '/auth/google/callback',
    }
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    config.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackUrl: process.env.GITHUB_CALLBACK_URL ?? '/auth/github/callback',
    }
  }

  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    config.microsoft = {
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      callbackUrl: process.env.MICROSOFT_CALLBACK_URL ?? '/auth/microsoft/callback',
      tenantId: process.env.MICROSOFT_TENANT_ID,
    }
  }

  return config
}

/** Find or create a user from an OAuth profile. */
export async function findOrCreateOAuthUser(
  profile: OAuthProfile,
  defaultOrgId?: string,
): Promise<{ userId: string; email: string; name: string | null; isNew: boolean }> {
  const db = getDatabase()

  // Check if this OAuth account is already linked
  const [existingAccount] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, profile.provider),
        eq(oauthAccounts.providerAccountId, profile.providerAccountId),
      ),
    )
    .limit(1)

  if (existingAccount) {
    // Found linked account, get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingAccount.userId))
      .limit(1)

    if (user) {
      await db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, user.id))

      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        isNew: false,
      }
    }
  }

  // Check if user exists by email
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1)

  if (existingUser) {
    // Link OAuth account to existing user
    await linkOAuthAccount(existingUser.id, profile)

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, existingUser.id))

    return {
      userId: existingUser.id,
      email: existingUser.email,
      name: existingUser.name,
      isNew: false,
    }
  }

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({
      orgId: defaultOrgId,
      email: profile.email,
      name: profile.displayName ?? null,
      role: 'member',
      ssoProvider: profile.provider,
      ssoSubject: profile.providerAccountId,
      lastLoginAt: new Date(),
    })
    .returning()

  // Link OAuth account
  await linkOAuthAccount(newUser.id, profile)

  return {
    userId: newUser.id,
    email: newUser.email,
    name: newUser.name,
    isNew: true,
  }
}

/** Link an OAuth account to a user. */
export async function linkOAuthAccount(userId: string, profile: OAuthProfile): Promise<void> {
  const db = getDatabase()

  await db
    .insert(oauthAccounts)
    .values({
      userId,
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      displayName: profile.displayName,
      accessTokenEncrypted: profile.accessToken ? encrypt(profile.accessToken) : null,
      refreshTokenEncrypted: profile.refreshToken ? encrypt(profile.refreshToken) : null,
    })
    .onConflictDoUpdate({
      target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
      set: {
        email: profile.email,
        displayName: profile.displayName,
        accessTokenEncrypted: profile.accessToken ? encrypt(profile.accessToken) : undefined,
        refreshTokenEncrypted: profile.refreshToken ? encrypt(profile.refreshToken) : undefined,
      },
    })
}

/** Get all OAuth accounts linked to a user. */
export async function getLinkedAccounts(userId: string): Promise<OAuthAccount[]> {
  const db = getDatabase()

  const accounts = await db
    .select({
      id: oauthAccounts.id,
      userId: oauthAccounts.userId,
      provider: oauthAccounts.provider,
      providerAccountId: oauthAccounts.providerAccountId,
      email: oauthAccounts.email,
      displayName: oauthAccounts.displayName,
      createdAt: oauthAccounts.createdAt,
    })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId))

  return accounts.map((a) => ({
    id: a.id,
    userId: a.userId,
    provider: a.provider as OAuthProvider,
    providerAccountId: a.providerAccountId,
    email: a.email ?? undefined,
    displayName: a.displayName ?? undefined,
    createdAt: new Date(a.createdAt!),
  }))
}

/** Unlink an OAuth account from a user. */
export async function unlinkOAuthAccount(userId: string, provider: OAuthProvider): Promise<void> {
  const db = getDatabase()

  await db
    .delete(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.userId, userId),
        eq(oauthAccounts.provider, provider),
      ),
    )
}


