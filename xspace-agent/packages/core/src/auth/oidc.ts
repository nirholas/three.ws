// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Enterprise Auth — OpenID Connect Service
// Discovery, callback handling, JIT provisioning
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { oidcConfigs, users, organizations } from '../db/schema'
import { encrypt, decrypt } from './crypto'
import { OIDCError } from './errors'
import type { OIDCConfig, OIDCProfile } from './types'
import type { OrgRole } from '../tenant/types'

/** Get OIDC configuration for an organization. */
export async function getOIDCConfig(orgId: string): Promise<OIDCConfig | null> {
  const db = getDatabase()
  const [config] = await db
    .select()
    .from(oidcConfigs)
    .where(eq(oidcConfigs.orgId, orgId))
    .limit(1)

  if (!config) return null

  return {
    enabled: config.enabled === 1,
    issuerUrl: config.issuerUrl,
    clientId: config.clientId,
    clientSecret: decrypt(config.clientSecretEncrypted),
    scopes: config.scopes ?? ['openid', 'profile', 'email'],
    callbackUrl: config.callbackUrl,
    emailClaim: config.emailClaim,
    nameClaim: config.nameClaim,
    groupsClaim: config.groupsClaim ?? undefined,
    jitProvisioning: config.jitProvisioning === 1,
    defaultRole: config.defaultRole as OrgRole,
    enforceSSO: config.enforceSSO === 1,
  }
}

/** Get OIDC config by org slug. */
export async function getOIDCConfigBySlug(orgSlug: string): Promise<{ config: OIDCConfig; orgId: string } | null> {
  const db = getDatabase()

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1)

  if (!org) return null

  const config = await getOIDCConfig(org.id)
  if (!config) return null

  return { config, orgId: org.id }
}

/** Save or update OIDC configuration for an organization. */
export async function upsertOIDCConfig(orgId: string, config: OIDCConfig): Promise<void> {
  const db = getDatabase()

  const existing = await getOIDCConfig(orgId)

  const values = {
    orgId,
    enabled: config.enabled ? 1 : 0,
    issuerUrl: config.issuerUrl,
    clientId: config.clientId,
    clientSecretEncrypted: encrypt(config.clientSecret),
    scopes: config.scopes,
    callbackUrl: config.callbackUrl,
    emailClaim: config.emailClaim,
    nameClaim: config.nameClaim,
    groupsClaim: config.groupsClaim ?? null,
    jitProvisioning: config.jitProvisioning ? 1 : 0,
    defaultRole: config.defaultRole,
    enforceSSO: config.enforceSSO ? 1 : 0,
    updatedAt: new Date(),
  }

  if (existing) {
    await db
      .update(oidcConfigs)
      .set(values)
      .where(eq(oidcConfigs.orgId, orgId))
  } else {
    await db.insert(oidcConfigs).values(values)
  }
}

/**
 * Discover OIDC provider and initiate authorization.
 * Returns the authorization URL to redirect the user to.
 */
export async function getOIDCAuthorizationUrl(
  orgSlug: string,
  state: string,
  nonce: string,
): Promise<string> {
  const result = await getOIDCConfigBySlug(orgSlug)
  if (!result || !result.config.enabled) {
    throw new OIDCError(`OIDC not configured for organization "${orgSlug}"`)
  }

  const { config } = result

  // Discover the OIDC provider
  const { Issuer } = await import('openid-client')
  const issuer = await Issuer.discover(config.issuerUrl)
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ['code'],
  })

  return client.authorizationUrl({
    scope: config.scopes.join(' '),
    state,
    nonce,
  })
}

/**
 * Handle OIDC callback: exchange code for tokens, extract user profile.
 */
export async function handleOIDCCallback(
  orgSlug: string,
  code: string,
  state: string,
  expectedNonce: string,
): Promise<{ profile: OIDCProfile; orgId: string }> {
  const result = await getOIDCConfigBySlug(orgSlug)
  if (!result || !result.config.enabled) {
    throw new OIDCError(`OIDC not configured for organization "${orgSlug}"`)
  }

  const { config, orgId } = result

  const { Issuer } = await import('openid-client')
  const issuer = await Issuer.discover(config.issuerUrl)
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.callbackUrl],
    response_types: ['code'],
  })

  const params = { code, state }
  const tokenSet = await client.callback(config.callbackUrl, params, {
    nonce: expectedNonce,
    state,
  })

  const claims = tokenSet.claims()
  const userinfo = await client.userinfo(tokenSet.access_token!)

  const email = (userinfo as any)[config.emailClaim] ?? claims.email
  if (!email) {
    throw new OIDCError(`Missing email claim (${config.emailClaim})`)
  }

  const profile: OIDCProfile = {
    sub: claims.sub,
    email: String(email),
    name: (userinfo as any)[config.nameClaim] ?? claims.name ?? undefined,
    groups: config.groupsClaim
      ? (userinfo as any)[config.groupsClaim]
      : undefined,
  }

  return { profile, orgId }
}

/** Find or create a user from OIDC claims (JIT provisioning). */
export async function provisionOIDCUser(
  orgId: string,
  profile: OIDCProfile,
  config: OIDCConfig,
): Promise<{ id: string; email: string; name: string | null; role: string; isNew: boolean }> {
  const db = getDatabase()

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1)

  if (existing) {
    await db
      .update(users)
      .set({
        ssoProvider: 'oidc',
        ssoSubject: profile.sub,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, existing.id))

    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      role: existing.role,
      isNew: false,
    }
  }

  if (!config.jitProvisioning) {
    throw new OIDCError('User not found and JIT provisioning is disabled')
  }

  const [newUser] = await db
    .insert(users)
    .values({
      orgId,
      email: profile.email,
      name: profile.name ?? null,
      role: config.defaultRole,
      ssoProvider: 'oidc',
      ssoSubject: profile.sub,
      lastLoginAt: new Date(),
    })
    .returning()

  return {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
    role: newUser.role,
    isNew: true,
  }
}


