// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Audit Service — Core audit logging with hash chain integrity
// =============================================================================

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { computeEntryHash, verifyEntryHash } from './hash-chain'
import {
  AUDIT_EVENTS,
  type AuditAction,
  type AuditEventInput,
  type AuditFilters,
  type AuditLogEntry,
  type AuditSummary,
  type IntegrityReport,
  type PaginatedAuditLogs,
  type SecurityAlert,
  type SecurityAlertHandler,
} from './types'

// ---------------------------------------------------------------------------
// In-memory store (replaced by PostgreSQL repository in production)
// ---------------------------------------------------------------------------

interface AuditStore {
  insert(entry: AuditLogEntry): Promise<void>
  getLastHash(orgId: string): Promise<string | null>
  query(orgId: string, filters: AuditFilters): Promise<PaginatedAuditLogs>
  getChain(orgId: string, startDate?: Date, endDate?: Date): Promise<AuditLogEntry[]>
  count(orgId: string, filters?: Partial<AuditFilters>): Promise<number>
  deleteByAction(action: string, before: Date): Promise<number>
  anonymizeActor(orgId: string, actorId: string): Promise<number>
  findByActor(orgId: string, actorId: string): Promise<AuditLogEntry[]>
  getSummary(orgId: string, startDate: Date, endDate: Date): Promise<AuditSummary>
}

/**
 * Default in-memory audit store for testing and development.
 */
class InMemoryAuditStore implements AuditStore {
  private entries: AuditLogEntry[] = []

  async insert(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry)
  }

  async getLastHash(orgId: string): Promise<string | null> {
    // Use insertion order (last matching entry) rather than timestamp sort,
    // since entries logged in the same millisecond need stable ordering.
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].orgId === orgId) {
        return this.entries[i].entryHash
      }
    }
    return null
  }

  async query(orgId: string, filters: AuditFilters): Promise<PaginatedAuditLogs> {
    let filtered = this.entries.filter((e) => e.orgId === orgId)

    if (filters.action) filtered = filtered.filter((e) => e.action === filters.action)
    if (filters.actorId) filtered = filtered.filter((e) => e.actorId === filters.actorId)
    if (filters.resourceType) filtered = filtered.filter((e) => e.resourceType === filters.resourceType)
    if (filters.resourceId) filtered = filtered.filter((e) => e.resourceId === filters.resourceId)
    if (filters.severity) filtered = filtered.filter((e) => e.severity === filters.severity)
    if (filters.startDate) filtered = filtered.filter((e) => e.createdAt >= filters.startDate!)
    if (filters.endDate) filtered = filtered.filter((e) => e.createdAt <= filters.endDate!)

    // Sort descending by createdAt
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    const total = filtered.length
    const page = filters.page ?? 1
    const limit = filters.limit ?? 50
    const offset = (page - 1) * limit
    const entries = filtered.slice(offset, offset + limit)

    return {
      entries,
      total,
      page,
      limit,
      hasMore: offset + limit < total,
    }
  }

  async getChain(orgId: string, startDate?: Date, endDate?: Date): Promise<AuditLogEntry[]> {
    // Preserve insertion order (important when entries share the same timestamp)
    let filtered = this.entries.filter((e) => e.orgId === orgId)
    if (startDate) filtered = filtered.filter((e) => e.createdAt >= startDate)
    if (endDate) filtered = filtered.filter((e) => e.createdAt <= endDate)
    return filtered
  }

  async count(orgId: string, filters?: Partial<AuditFilters>): Promise<number> {
    let filtered = this.entries.filter((e) => e.orgId === orgId)
    if (filters?.action) filtered = filtered.filter((e) => e.action === filters.action)
    if (filters?.severity) filtered = filtered.filter((e) => e.severity === filters.severity)
    return filtered.length
  }

  async deleteByAction(action: string, before: Date): Promise<number> {
    const beforeCount = this.entries.length
    this.entries = this.entries.filter(
      (e) => !(e.action === action && e.createdAt < before),
    )
    return beforeCount - this.entries.length
  }

  async anonymizeActor(orgId: string, actorId: string): Promise<number> {
    let count = 0
    for (const entry of this.entries) {
      if (entry.orgId === orgId && entry.actorId === actorId) {
        entry.actorId = null
        entry.actorIp = null
        entry.actorUserAgent = null
        if (entry.details && typeof entry.details === 'object') {
          const d = entry.details as Record<string, unknown>
          delete d.email
          delete d.name
          delete d.userName
        }
        count++
      }
    }
    return count
  }

  async findByActor(orgId: string, actorId: string): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((e) => e.orgId === orgId && e.actorId === actorId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async getSummary(orgId: string, startDate: Date, endDate: Date): Promise<AuditSummary> {
    const filtered = this.entries.filter(
      (e) => e.orgId === orgId && e.createdAt >= startDate && e.createdAt <= endDate,
    )

    const byAction: Record<string, number> = {}
    const bySeverity: Record<string, number> = { info: 0, warning: 0, critical: 0 }
    const byActorType: Record<string, number> = {}

    for (const e of filtered) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1
      byActorType[e.actorType] = (byActorType[e.actorType] ?? 0) + 1
    }

    return {
      totalEvents: filtered.length,
      byAction,
      bySeverity: bySeverity as AuditSummary['bySeverity'],
      byActorType: byActorType as AuditSummary['byActorType'],
      period: { start: startDate, end: endDate },
    }
  }
}

// ---------------------------------------------------------------------------
// Security alert rules
// ---------------------------------------------------------------------------

interface AlertRule {
  actions: AuditAction[]
  message: (entry: AuditLogEntry) => string
}

const ALERT_RULES: AlertRule[] = [
  {
    actions: ['auth.login.failed'],
    message: (e) => `Failed login attempt from IP ${e.actorIp ?? 'unknown'}`,
  },
  {
    actions: ['security.suspicious'],
    message: (e) => `Suspicious activity detected: ${e.details?.reason ?? 'unknown'}`,
  },
  {
    actions: ['admin.impersonation.started', 'admin.impersonation.ended'],
    message: (e) => `Admin impersonation ${e.action === 'admin.impersonation.started' ? 'started' : 'ended'} by ${e.actorId}`,
  },
  {
    actions: ['data.exported'],
    message: (e) => `Bulk data export initiated for resource ${e.resourceType}/${e.resourceId}`,
  },
  {
    actions: ['data.deleted'],
    message: (e) => `Data deletion performed on ${e.resourceType}/${e.resourceId}`,
  },
  {
    actions: ['org.member.role_changed'],
    message: (e) => `Role changed: ${JSON.stringify(e.changes?.after ?? {})}`,
  },
  {
    actions: ['sso.configured', 'sso.updated'],
    message: (e) => `SSO configuration ${e.action === 'sso.configured' ? 'created' : 'updated'}`,
  },
]

// ---------------------------------------------------------------------------
// Audit Service
// ---------------------------------------------------------------------------

export interface AuditServiceConfig {
  store?: AuditStore
}

export class AuditService extends EventEmitter {
  private store: AuditStore
  private alertHandlers: SecurityAlertHandler[] = []

  constructor(config: AuditServiceConfig = {}) {
    super()
    this.store = config.store ?? new InMemoryAuditStore()
  }

  /**
   * Log an audit event with automatic hash chain linking.
   */
  async log(input: AuditEventInput): Promise<AuditLogEntry> {
    const meta = AUDIT_EVENTS[input.action]
    const now = new Date()
    const id = randomUUID()

    // Get previous hash for this org's chain
    const prevHash = await this.store.getLastHash(input.orgId)

    // Build entry without hash fields first
    const entryData: Omit<AuditLogEntry, 'prevHash' | 'entryHash'> = {
      id,
      orgId: input.orgId,
      actorId: input.actorId ?? null,
      actorType: input.actorType,
      actorIp: input.actorIp ?? null,
      actorUserAgent: input.actorUserAgent ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      severity: meta.severity,
      details: input.details ?? {},
      changes: input.changes ?? null,
      requestId: input.requestId ?? null,
      geoLocation: input.geoLocation ?? null,
      createdAt: now,
    }

    // Compute hash
    const entryHash = computeEntryHash(prevHash, entryData)

    const entry: AuditLogEntry = {
      ...entryData,
      prevHash,
      entryHash,
    }

    await this.store.insert(entry)

    // Emit event for listeners
    this.emit('audit:logged', entry)

    // Check security alert rules
    await this.checkAlertRules(entry)

    return entry
  }

  /**
   * Query audit logs with filtering and pagination.
   */
  async query(orgId: string, filters: AuditFilters = {}): Promise<PaginatedAuditLogs> {
    return this.store.query(orgId, filters)
  }

  /**
   * Export audit logs as a stream of JSON or CSV lines.
   */
  async *export(
    orgId: string,
    startDate: Date,
    endDate: Date,
    format: 'json' | 'csv' = 'json',
  ): AsyncGenerator<string> {
    const chain = await this.store.getChain(orgId, startDate, endDate)

    if (format === 'csv') {
      yield 'id,action,actor_id,actor_type,actor_ip,resource_type,resource_id,severity,created_at,entry_hash\n'
      for (const entry of chain) {
        yield [
          entry.id,
          entry.action,
          entry.actorId ?? '',
          entry.actorType,
          entry.actorIp ?? '',
          entry.resourceType,
          entry.resourceId ?? '',
          entry.severity,
          entry.createdAt.toISOString(),
          entry.entryHash,
        ].join(',') + '\n'
      }
    } else {
      for (const entry of chain) {
        yield JSON.stringify(entry) + '\n'
      }
    }
  }

  /**
   * Verify hash chain integrity for an org.
   */
  async verifyIntegrity(orgId: string, startDate?: Date, endDate?: Date): Promise<IntegrityReport> {
    const chain = await this.store.getChain(orgId, startDate, endDate)

    let verified = 0
    let broken = 0
    let firstBrokenAt: Date | undefined
    let firstBrokenId: string | undefined

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]
      const isValid = verifyEntryHash(entry)

      // Also verify chain linkage
      const linkValid =
        i === 0 || entry.prevHash === chain[i - 1].entryHash

      if (isValid && linkValid) {
        verified++
      } else {
        broken++
        if (!firstBrokenAt) {
          firstBrokenAt = entry.createdAt
          firstBrokenId = entry.id
        }
      }
    }

    return {
      orgId,
      totalEntries: chain.length,
      verified,
      broken,
      firstBrokenAt,
      firstBrokenId,
      checkedAt: new Date(),
    }
  }

  /**
   * Get aggregated audit statistics.
   */
  async getSummary(orgId: string, startDate: Date, endDate: Date): Promise<AuditSummary> {
    return this.store.getSummary(orgId, startDate, endDate)
  }

  /**
   * Register a handler for security alerts triggered by critical audit events.
   */
  onSecurityAlert(handler: SecurityAlertHandler): void {
    this.alertHandlers.push(handler)
  }

  /**
   * Remove a security alert handler.
   */
  offSecurityAlert(handler: SecurityAlertHandler): void {
    this.alertHandlers = this.alertHandlers.filter((h) => h !== handler)
  }

  /**
   * Anonymize all audit entries for a specific actor (GDPR deletion).
   * Preserves the audit log entries but removes PII.
   */
  async anonymizeActor(orgId: string, actorId: string): Promise<number> {
    return this.store.anonymizeActor(orgId, actorId)
  }

  /**
   * Find all audit entries for a specific actor (GDPR data export).
   */
  async findByActor(orgId: string, actorId: string): Promise<AuditLogEntry[]> {
    return this.store.findByActor(orgId, actorId)
  }

  /**
   * Delete audit entries by action type before a cutoff date (retention enforcement).
   */
  async deleteByAction(action: string, before: Date): Promise<number> {
    return this.store.deleteByAction(action, before)
  }

  /**
   * Get the underlying store (for testing or advanced usage).
   */
  getStore(): AuditStore {
    return this.store
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async checkAlertRules(entry: AuditLogEntry): Promise<void> {
    for (const rule of ALERT_RULES) {
      if (rule.actions.includes(entry.action)) {
        const alert: SecurityAlert = {
          id: randomUUID(),
          orgId: entry.orgId,
          action: entry.action,
          severity: entry.severity,
          message: rule.message(entry),
          details: entry.details,
          channels: entry.severity === 'critical' ? ['email', 'slack'] : ['email'],
          createdAt: new Date(),
        }

        this.emit('audit:alert', alert)

        for (const handler of this.alertHandlers) {
          try {
            await handler(alert)
          } catch {
            // Alert handler failure should not break audit logging
          }
        }
      }
    }
  }
}

export type { AuditStore }


