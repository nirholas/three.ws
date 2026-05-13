// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

// =============================================================================
// Audit Logging — Types & Event Categories
// =============================================================================

// ---------------------------------------------------------------------------
// Severity levels
// ---------------------------------------------------------------------------

export type AuditSeverity = 'info' | 'warning' | 'critical'

// ---------------------------------------------------------------------------
// Retention durations
// ---------------------------------------------------------------------------

export type RetentionDuration = '1y' | '2y' | '7y'

// ---------------------------------------------------------------------------
// Audit event metadata
// ---------------------------------------------------------------------------

export interface AuditEventMeta {
  severity: AuditSeverity
  retention: RetentionDuration
}

// ---------------------------------------------------------------------------
// All audit event types
// ---------------------------------------------------------------------------

export const AUDIT_EVENTS = {
  // Authentication
  'auth.login':              { severity: 'info',     retention: '2y' },
  'auth.login.failed':       { severity: 'warning',  retention: '2y' },
  'auth.logout':             { severity: 'info',     retention: '1y' },
  'auth.mfa.enabled':        { severity: 'info',     retention: '2y' },
  'auth.mfa.disabled':       { severity: 'warning',  retention: '2y' },
  'auth.password.changed':   { severity: 'info',     retention: '2y' },
  'auth.password.reset':     { severity: 'warning',  retention: '2y' },
  'auth.session.revoked':    { severity: 'warning',  retention: '2y' },

  // Organization
  'org.created':             { severity: 'info',     retention: '7y' },
  'org.updated':             { severity: 'info',     retention: '2y' },
  'org.deleted':             { severity: 'critical', retention: '7y' },
  'org.member.invited':      { severity: 'info',     retention: '2y' },
  'org.member.joined':       { severity: 'info',     retention: '2y' },
  'org.member.removed':      { severity: 'warning',  retention: '2y' },
  'org.member.role_changed': { severity: 'warning',  retention: '2y' },

  // Agents
  'agent.created':           { severity: 'info',     retention: '2y' },
  'agent.updated':           { severity: 'info',     retention: '1y' },
  'agent.deleted':           { severity: 'warning',  retention: '2y' },
  'agent.session.started':   { severity: 'info',     retention: '1y' },
  'agent.session.stopped':   { severity: 'info',     retention: '1y' },

  // API Keys
  'api_key.created':         { severity: 'info',     retention: '2y' },
  'api_key.revoked':         { severity: 'warning',  retention: '2y' },
  'api_key.rotated':         { severity: 'info',     retention: '2y' },

  // Data Access
  'data.exported':           { severity: 'warning',  retention: '2y' },
  'data.deleted':            { severity: 'critical', retention: '7y' },
  'conversation.accessed':   { severity: 'info',     retention: '1y' },

  // Billing
  'billing.subscription.changed': { severity: 'info',     retention: '7y' },
  'billing.payment.failed':       { severity: 'warning',  retention: '7y' },

  // SSO / Security
  'sso.configured':          { severity: 'info',     retention: '2y' },
  'sso.updated':             { severity: 'warning',  retention: '2y' },
  'security.suspicious':     { severity: 'critical', retention: '2y' },

  // Admin actions
  'admin.impersonation.started': { severity: 'critical', retention: '7y' },
  'admin.impersonation.ended':   { severity: 'critical', retention: '7y' },

  // Webhooks
  'webhook.created':         { severity: 'info',     retention: '2y' },
  'webhook.deleted':         { severity: 'warning',  retention: '2y' },
  'webhook.disabled':        { severity: 'warning',  retention: '2y' },
} as const satisfies Record<string, AuditEventMeta>

export type AuditAction = keyof typeof AUDIT_EVENTS

// ---------------------------------------------------------------------------
// Actor types
// ---------------------------------------------------------------------------

export type ActorType = 'user' | 'api_key' | 'system' | 'webhook'

// ---------------------------------------------------------------------------
// Geo location (derived from IP)
// ---------------------------------------------------------------------------

export interface GeoLocation {
  country?: string
  region?: string
  city?: string
}

// ---------------------------------------------------------------------------
// Audit event input (what callers pass to AuditService.log)
// ---------------------------------------------------------------------------

export interface AuditEventInput {
  orgId: string
  action: AuditAction
  actorId?: string
  actorType: ActorType
  actorIp?: string
  actorUserAgent?: string
  resourceType: string
  resourceId?: string
  details?: Record<string, unknown>
  changes?: { before: Record<string, unknown>; after: Record<string, unknown> }
  requestId?: string
  geoLocation?: GeoLocation
}

// ---------------------------------------------------------------------------
// Stored audit log entry
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string
  orgId: string
  actorId: string | null
  actorType: ActorType
  actorIp: string | null
  actorUserAgent: string | null
  action: AuditAction
  resourceType: string
  resourceId: string | null
  severity: AuditSeverity
  details: Record<string, unknown>
  changes: { before: Record<string, unknown>; after: Record<string, unknown> } | null
  requestId: string | null
  geoLocation: GeoLocation | null
  createdAt: Date
  prevHash: string | null
  entryHash: string
}

// ---------------------------------------------------------------------------
// Query filters
// ---------------------------------------------------------------------------

export interface AuditFilters {
  action?: AuditAction
  actorId?: string
  resourceType?: string
  resourceId?: string
  severity?: AuditSeverity
  startDate?: Date
  endDate?: Date
  page?: number
  limit?: number
}

export interface PaginatedAuditLogs {
  entries: AuditLogEntry[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

// ---------------------------------------------------------------------------
// Integrity report
// ---------------------------------------------------------------------------

export interface IntegrityReport {
  orgId: string
  totalEntries: number
  verified: number
  broken: number
  firstBrokenAt?: Date
  firstBrokenId?: string
  checkedAt: Date
}

// ---------------------------------------------------------------------------
// Audit statistics summary
// ---------------------------------------------------------------------------

export interface AuditSummary {
  totalEvents: number
  byAction: Record<string, number>
  bySeverity: Record<AuditSeverity, number>
  byActorType: Record<ActorType, number>
  period: { start: Date; end: Date }
}

// ---------------------------------------------------------------------------
// GDPR types
// ---------------------------------------------------------------------------

export interface DataExportResult {
  userId: string
  orgId: string
  exportedAt: Date
  data: {
    user: Record<string, unknown>
    agents: Record<string, unknown>[]
    sessions: Record<string, unknown>[]
    conversations: Record<string, unknown>[]
    apiKeys: Record<string, unknown>[]
    auditLogs: Record<string, unknown>[]
  }
}

export interface DataDeletionResult {
  userId: string
  orgId: string
  deletedAt: Date
  deleted: {
    conversations: number
    agents: number
    apiKeys: number
    sessions: number
  }
  anonymized: {
    auditLogs: number
    user: boolean
  }
}

// ---------------------------------------------------------------------------
// Security alert
// ---------------------------------------------------------------------------

export type AlertChannel = 'email' | 'slack' | 'webhook'

export interface SecurityAlert {
  id: string
  orgId: string
  action: AuditAction
  severity: AuditSeverity
  message: string
  details: Record<string, unknown>
  channels: AlertChannel[]
  createdAt: Date
}

export type SecurityAlertHandler = (alert: SecurityAlert) => void | Promise<void>

// ---------------------------------------------------------------------------
// Retention archive record
// ---------------------------------------------------------------------------

export interface RetentionArchiveResult {
  action: string
  cutoffDate: Date
  archivedCount: number
  deletedCount: number
}


