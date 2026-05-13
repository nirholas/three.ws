// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Impersonation Service — Reseller admin impersonation of sub-org users
// =============================================================================

import {
  ImpersonationSessionRepository,
  SubOrganizationRepository,
  AuditRepository,
} from '../db/repositories'
import type { StartImpersonationInput, ImpersonationSession } from './types'

/** Default impersonation duration in minutes. */
const DEFAULT_DURATION_MINUTES = 60

/** Maximum impersonation duration in minutes. */
const MAX_DURATION_MINUTES = 240

export class ImpersonationService {
  private sessionRepo = new ImpersonationSessionRepository()
  private subOrgRepo = new SubOrganizationRepository()
  private auditRepo = new AuditRepository()

  /**
   * Start an impersonation session. Creates an audit log entry and returns
   * a time-limited session token.
   */
  async startImpersonation(input: StartImpersonationInput): Promise<ImpersonationSession> {
    // Validate the target org is a sub-org of this reseller
    const subOrg = await this.subOrgRepo.findByOrgId(input.targetOrgId)
    if (!subOrg || subOrg.resellerId !== input.resellerId) {
      throw new Error('Target organization is not a sub-organization of this reseller')
    }

    // Check for existing active session
    const existing = await this.sessionRepo.findActive(input.adminUserId, input.targetOrgId)
    if (existing) {
      return this.toImpersonationSession(existing)
    }

    const durationMinutes = Math.min(
      input.durationMinutes ?? DEFAULT_DURATION_MINUTES,
      MAX_DURATION_MINUTES,
    )
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000)

    const session = await this.sessionRepo.create({
      resellerId: input.resellerId,
      adminUserId: input.adminUserId,
      targetOrgId: input.targetOrgId,
      targetUserId: input.targetUserId ?? null,
      expiresAt,
    })

    // Audit log
    await this.auditRepo.log({
      orgId: input.targetOrgId,
      actorId: input.adminUserId,
      action: 'admin.impersonation.started',
      resourceType: 'impersonation_session',
      resourceId: session.id,
      details: {
        resellerId: input.resellerId,
        targetOrgId: input.targetOrgId,
        targetUserId: input.targetUserId,
        durationMinutes,
        expiresAt: expiresAt.toISOString(),
      },
    })

    return this.toImpersonationSession(session)
  }

  /**
   * End an impersonation session early.
   */
  async endImpersonation(sessionId: string, adminUserId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId)
    if (!session) throw new Error('Impersonation session not found')
    if (session.adminUserId !== adminUserId) throw new Error('Not authorized to end this session')

    await this.auditRepo.log({
      orgId: session.targetOrgId,
      actorId: adminUserId,
      action: 'admin.impersonation.ended',
      resourceType: 'impersonation_session',
      resourceId: sessionId,
      details: { resellerId: session.resellerId },
    })

    await this.sessionRepo.delete(sessionId)
  }

  /**
   * Validate an impersonation session is still active.
   */
  async validateSession(sessionId: string): Promise<ImpersonationSession | null> {
    const session = await this.sessionRepo.findById(sessionId)
    if (!session) return null
    if (new Date() > session.expiresAt) {
      await this.sessionRepo.delete(sessionId)
      return null
    }
    return this.toImpersonationSession(session)
  }

  /**
   * List active impersonation sessions for an admin user.
   */
  async listActiveSessions(adminUserId: string): Promise<ImpersonationSession[]> {
    const sessions = await this.sessionRepo.findActiveByAdmin(adminUserId)
    return sessions.map((s) => this.toImpersonationSession(s))
  }

  /**
   * Renew an impersonation session (extend expiration by 1 hour).
   */
  async renewSession(sessionId: string, adminUserId: string): Promise<ImpersonationSession> {
    const session = await this.sessionRepo.findById(sessionId)
    if (!session) throw new Error('Impersonation session not found')
    if (session.adminUserId !== adminUserId) throw new Error('Not authorized to renew this session')

    const newExpires = new Date(Date.now() + DEFAULT_DURATION_MINUTES * 60 * 1000)

    // Delete and recreate with new expiry (simplest approach)
    await this.sessionRepo.delete(sessionId)
    const renewed = await this.sessionRepo.create({
      resellerId: session.resellerId,
      adminUserId: session.adminUserId,
      targetOrgId: session.targetOrgId,
      targetUserId: session.targetUserId,
      expiresAt: newExpires,
    })

    await this.auditRepo.log({
      orgId: session.targetOrgId,
      actorId: adminUserId,
      action: 'admin.impersonation.renewed',
      resourceType: 'impersonation_session',
      resourceId: renewed.id,
      details: { resellerId: session.resellerId, newExpiresAt: newExpires.toISOString() },
    })

    return this.toImpersonationSession(renewed)
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private toImpersonationSession(row: any): ImpersonationSession {
    return {
      id: row.id,
      resellerId: row.resellerId,
      adminUserId: row.adminUserId,
      targetOrgId: row.targetOrgId,
      targetUserId: row.targetUserId ?? undefined,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }
  }
}


