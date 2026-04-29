// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Enterprise Auth — SAML 2.0 Service
// SP metadata generation, assertion parsing, JIT provisioning
// =============================================================================

import { eq } from 'drizzle-orm'
import { getDatabase } from '../db/connection'
import { samlConfigs, users, organizations } from '../db/schema'
import { SAMLError } from './errors'
import type { SAMLConfig, SAMLProfile } from './types'
import type { OrgRole } from '../tenant/types'

/** Get SAML configuration for an organization. */
export async function getSAMLConfig(orgId: string): Promise<SAMLConfig | null> {
  const db = getDatabase()
  const [config] = await db
    .select()
    .from(samlConfigs)
    .where(eq(samlConfigs.orgId, orgId))
    .limit(1)

  if (!config) return null

  return {
    enabled: config.enabled === 1,
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    cert: config.cert,
    callbackUrl: config.callbackUrl,
    signatureAlgorithm: config.signatureAlgorithm as 'sha256' | 'sha512',
    wantAuthnResponseSigned: config.wantAuthnResponseSigned === 1,
    wantAssertionsSigned: config.wantAssertionsSigned === 1,
    emailAttribute: config.emailAttribute,
    firstNameAttribute: config.firstNameAttribute,
    lastNameAttribute: config.lastNameAttribute,
    groupsAttribute: config.groupsAttribute ?? undefined,
    jitProvisioning: config.jitProvisioning === 1,
    defaultRole: config.defaultRole as OrgRole,
    enforceSSO: config.enforceSSO === 1,
  }
}

/** Get SAML config by org slug. */
export async function getSAMLConfigBySlug(orgSlug: string): Promise<{ config: SAMLConfig; orgId: string } | null> {
  const db = getDatabase()

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .limit(1)

  if (!org) return null

  const config = await getSAMLConfig(org.id)
  if (!config) return null

  return { config, orgId: org.id }
}

/** Save or update SAML configuration for an organization. */
export async function upsertSAMLConfig(orgId: string, config: SAMLConfig): Promise<void> {
  const db = getDatabase()

  const existing = await getSAMLConfig(orgId)

  const values = {
    orgId,
    enabled: config.enabled ? 1 : 0,
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    cert: config.cert,
    callbackUrl: config.callbackUrl,
    signatureAlgorithm: config.signatureAlgorithm,
    wantAuthnResponseSigned: config.wantAuthnResponseSigned ? 1 : 0,
    wantAssertionsSigned: config.wantAssertionsSigned ? 1 : 0,
    emailAttribute: config.emailAttribute,
    firstNameAttribute: config.firstNameAttribute,
    lastNameAttribute: config.lastNameAttribute,
    groupsAttribute: config.groupsAttribute ?? null,
    jitProvisioning: config.jitProvisioning ? 1 : 0,
    defaultRole: config.defaultRole,
    enforceSSO: config.enforceSSO ? 1 : 0,
    updatedAt: new Date(),
  }

  if (existing) {
    await db
      .update(samlConfigs)
      .set(values)
      .where(eq(samlConfigs.orgId, orgId))
  } else {
    await db.insert(samlConfigs).values(values)
  }
}

/** Generate SP metadata XML for a given organization. */
export function generateSPMetadata(orgSlug: string, baseUrl: string): string {
  const entityId = `${baseUrl}/auth/saml/${orgSlug}`
  const acsUrl = `${baseUrl}/auth/saml/${orgSlug}`

  return `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="${entityId}">
  <SPSSODescriptor
      AuthnRequestsSigned="true"
      WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="${acsUrl}"
        index="1"/>
  </SPSSODescriptor>
</EntityDescriptor>`
}

/** Process SAML assertion and return user profile. */
export function extractSAMLProfile(
  samlResponse: Record<string, any>,
  config: SAMLConfig,
): SAMLProfile {
  const email = samlResponse[config.emailAttribute] ?? samlResponse.nameID
  if (!email) {
    throw new SAMLError(`Missing email attribute (${config.emailAttribute})`)
  }

  return {
    nameID: samlResponse.nameID ?? email,
    email: typeof email === 'string' ? email : String(email),
    firstName: samlResponse[config.firstNameAttribute] ?? undefined,
    lastName: samlResponse[config.lastNameAttribute] ?? undefined,
    groups: config.groupsAttribute
      ? samlResponse[config.groupsAttribute]
      : undefined,
  }
}

/** Find or create a user from a SAML assertion (JIT provisioning). */
export async function provisionSAMLUser(
  orgId: string,
  profile: SAMLProfile,
  config: SAMLConfig,
): Promise<{ id: string; email: string; name: string | null; role: string; isNew: boolean }> {
  const db = getDatabase()

  // Check if user already exists
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .limit(1)

  if (existing) {
    // Update SSO info
    await db
      .update(users)
      .set({
        ssoProvider: 'saml',
        ssoSubject: profile.nameID,
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

  // JIT provisioning
  if (!config.jitProvisioning) {
    throw new SAMLError('User not found and JIT provisioning is disabled')
  }

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null

  const [newUser] = await db
    .insert(users)
    .values({
      orgId,
      email: profile.email,
      name,
      role: config.defaultRole,
      ssoProvider: 'saml',
      ssoSubject: profile.nameID,
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

/** Check if SSO is enforced for an org. */
export async function isSSOEnforced(orgId: string): Promise<boolean> {
  const saml = await getSAMLConfig(orgId)
  if (saml?.enabled && saml.enforceSSO) return true

  // Also check OIDC (imported lazily to avoid circular deps)
  const db = getDatabase()
  const { oidcConfigs } = await import('../db/schema')
  const [oidc] = await db
    .select({ enforceSSO: oidcConfigs.enforceSSO })
    .from(oidcConfigs)
    .where(eq(oidcConfigs.orgId, orgId))
    .limit(1)

  return !!oidc && oidc.enforceSSO === 1
}


