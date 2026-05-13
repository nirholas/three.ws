// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Audit Logging & Compliance — Main exports
// =============================================================================

// Types
export {
  AUDIT_EVENTS,
  type AuditAction,
  type ActorType,
  type AuditSeverity,
  type RetentionDuration,
  type AuditEventMeta,
  type AuditEventInput,
  type AuditLogEntry,
  type AuditFilters,
  type PaginatedAuditLogs,
  type IntegrityReport,
  type AuditSummary,
  type GeoLocation,
  type DataExportResult,
  type DataDeletionResult,
  type SecurityAlert,
  type SecurityAlertHandler,
  type AlertChannel,
  type RetentionArchiveResult,
} from './types'

// Hash chain
export { computeEntryHash, verifyEntryHash, verifyChain } from './hash-chain'

// Audit service
export { AuditService, type AuditServiceConfig, type AuditStore } from './service'

// GDPR compliance
export {
  ComplianceService,
  InMemoryComplianceStore,
  type ComplianceDataStore,
} from './compliance'

// Retention
export { RetentionEnforcer, type ArchiveHandler } from './retention'


