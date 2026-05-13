// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// GDPR Compliance Service — Data Export, Deletion, Anonymization
// =============================================================================

import { createHash } from 'node:crypto'
import type { AuditService } from './service'
import type { DataDeletionResult, DataExportResult } from './types'

// ---------------------------------------------------------------------------
// Data store abstraction (per-table access for GDPR operations)
// ---------------------------------------------------------------------------

export interface ComplianceDataStore {
  /** Get user record by ID. */
  getUser(orgId: string, userId: string): Promise<Record<string, unknown> | null>
  /** Get all agents created by a user in an org. */
  getAgentsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]>
  /** Get all sessions for a user's agents. */
  getSessionsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]>
  /** Get all conversations for a user's sessions. */
  getConversationsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]>
  /** Get all API keys created by a user. */
  getApiKeysByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]>

  /** Delete conversations for a user. Returns count. */
  deleteConversations(orgId: string, userId: string): Promise<number>
  /** Delete agents for a user. Returns count. */
  deleteAgents(orgId: string, userId: string): Promise<number>
  /** Delete API keys for a user. Returns count. */
  deleteApiKeys(orgId: string, userId: string): Promise<number>
  /** Delete sessions for a user. Returns count. */
  deleteSessions(orgId: string, userId: string): Promise<number>

  /** Anonymize user record (name → "Deleted User", email → hash). */
  anonymizeUser(orgId: string, userId: string): Promise<boolean>
}

/**
 * In-memory compliance data store for testing.
 */
export class InMemoryComplianceStore implements ComplianceDataStore {
  private users = new Map<string, Record<string, unknown>>()
  private agents: Record<string, unknown>[] = []
  private sessions: Record<string, unknown>[] = []
  private conversations: Record<string, unknown>[] = []
  private apiKeys: Record<string, unknown>[] = []

  addUser(orgId: string, userId: string, data: Record<string, unknown>): void {
    this.users.set(`${orgId}:${userId}`, { ...data, orgId, userId })
  }

  addAgent(data: Record<string, unknown>): void {
    this.agents.push(data)
  }

  addSession(data: Record<string, unknown>): void {
    this.sessions.push(data)
  }

  addConversation(data: Record<string, unknown>): void {
    this.conversations.push(data)
  }

  addApiKey(data: Record<string, unknown>): void {
    this.apiKeys.push(data)
  }

  async getUser(orgId: string, userId: string): Promise<Record<string, unknown> | null> {
    return this.users.get(`${orgId}:${userId}`) ?? null
  }

  async getAgentsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]> {
    return this.agents.filter((a) => a.orgId === orgId && a.createdBy === userId)
  }

  async getSessionsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]> {
    return this.sessions.filter((s) => s.orgId === orgId && s.userId === userId)
  }

  async getConversationsByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]> {
    return this.conversations.filter((c) => c.orgId === orgId && c.userId === userId)
  }

  async getApiKeysByUser(orgId: string, userId: string): Promise<Record<string, unknown>[]> {
    return this.apiKeys.filter((k) => k.orgId === orgId && k.createdBy === userId)
  }

  async deleteConversations(orgId: string, userId: string): Promise<number> {
    const before = this.conversations.length
    this.conversations = this.conversations.filter(
      (c) => !(c.orgId === orgId && c.userId === userId),
    )
    return before - this.conversations.length
  }

  async deleteAgents(orgId: string, userId: string): Promise<number> {
    const before = this.agents.length
    this.agents = this.agents.filter(
      (a) => !(a.orgId === orgId && a.createdBy === userId),
    )
    return before - this.agents.length
  }

  async deleteApiKeys(orgId: string, userId: string): Promise<number> {
    const before = this.apiKeys.length
    this.apiKeys = this.apiKeys.filter(
      (k) => !(k.orgId === orgId && k.createdBy === userId),
    )
    return before - this.apiKeys.length
  }

  async deleteSessions(orgId: string, userId: string): Promise<number> {
    const before = this.sessions.length
    this.sessions = this.sessions.filter(
      (s) => !(s.orgId === orgId && s.userId === userId),
    )
    return before - this.sessions.length
  }

  async anonymizeUser(orgId: string, userId: string): Promise<boolean> {
    const key = `${orgId}:${userId}`
    const user = this.users.get(key)
    if (!user) return false

    const emailHash = createHash('sha256')
      .update(String(user.email ?? ''))
      .digest('hex')
      .slice(0, 16)

    user.name = 'Deleted User'
    user.email = `deleted_${emailHash}@anonymized.local`
    user.anonymizedAt = new Date()
    this.users.set(key, user)
    return true
  }
}

// ---------------------------------------------------------------------------
// Compliance Service
// ---------------------------------------------------------------------------

export class ComplianceService {
  constructor(
    private auditService: AuditService,
    private dataStore: ComplianceDataStore,
  ) {}

  /**
   * GDPR Right to Access — Export all data for a user.
   */
  async exportUserData(orgId: string, userId: string): Promise<DataExportResult> {
    const [user, agents, sessions, conversations, apiKeys, auditLogs] =
      await Promise.all([
        this.dataStore.getUser(orgId, userId),
        this.dataStore.getAgentsByUser(orgId, userId),
        this.dataStore.getSessionsByUser(orgId, userId),
        this.dataStore.getConversationsByUser(orgId, userId),
        this.dataStore.getApiKeysByUser(orgId, userId),
        this.auditService.findByActor(orgId, userId),
      ])

    const result: DataExportResult = {
      userId,
      orgId,
      exportedAt: new Date(),
      data: {
        user: user ?? {},
        agents,
        sessions,
        conversations,
        apiKeys: apiKeys.map((k) => {
          // Redact key hashes from export
          const { keyHash, ...safe } = k as Record<string, unknown> & { keyHash?: string }
          return safe
        }),
        auditLogs: auditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          severity: log.severity,
          createdAt: log.createdAt,
          details: log.details,
        })),
      },
    }

    // Log the export itself as an audit event
    await this.auditService.log({
      orgId,
      action: 'data.exported',
      actorType: 'system',
      resourceType: 'user',
      resourceId: userId,
      details: {
        reason: 'gdpr_right_to_access',
        recordCounts: {
          agents: agents.length,
          sessions: sessions.length,
          conversations: conversations.length,
          apiKeys: apiKeys.length,
          auditLogs: auditLogs.length,
        },
      },
    })

    return result
  }

  /**
   * GDPR Right to Deletion — Delete user data, anonymize audit trail.
   *
   * Preserves audit logs (legal requirement) but removes PII.
   * Deletes: conversations, agent configs, API keys, session data.
   * Anonymizes: user name → "Deleted User", email → hash.
   */
  async deleteUserData(orgId: string, userId: string): Promise<DataDeletionResult> {
    // Delete user's data across tables
    const [conversations, agents, apiKeys, sessions] = await Promise.all([
      this.dataStore.deleteConversations(orgId, userId),
      this.dataStore.deleteAgents(orgId, userId),
      this.dataStore.deleteApiKeys(orgId, userId),
      this.dataStore.deleteSessions(orgId, userId),
    ])

    // Anonymize audit logs (preserve entries but strip PII)
    const anonymizedLogs = await this.auditService.anonymizeActor(orgId, userId)

    // Anonymize the user record itself
    const userAnonymized = await this.dataStore.anonymizeUser(orgId, userId)

    const result: DataDeletionResult = {
      userId,
      orgId,
      deletedAt: new Date(),
      deleted: { conversations, agents, apiKeys, sessions },
      anonymized: { auditLogs: anonymizedLogs, user: userAnonymized },
    }

    // Log the deletion event (this entry itself will have actorType: 'system')
    await this.auditService.log({
      orgId,
      action: 'data.deleted',
      actorType: 'system',
      resourceType: 'user',
      resourceId: userId,
      details: {
        reason: 'gdpr_right_to_deletion',
        deletedCounts: result.deleted,
        anonymizedCounts: result.anonymized,
      },
    })

    return result
  }
}


