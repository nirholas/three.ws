// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// Audit Logging — Retention Policy Enforcement
// =============================================================================

import {
  AUDIT_EVENTS,
  type AuditAction,
  type RetentionArchiveResult,
  type RetentionDuration,
} from './types'
import type { AuditService } from './service'

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

const DURATION_MS: Record<RetentionDuration, number> = {
  '1y': 365 * 24 * 60 * 60 * 1000,
  '2y': 2 * 365 * 24 * 60 * 60 * 1000,
  '7y': 7 * 365 * 24 * 60 * 60 * 1000,
}

function subtractDuration(from: Date, duration: RetentionDuration): Date {
  return new Date(from.getTime() - DURATION_MS[duration])
}

// ---------------------------------------------------------------------------
// Archive handler
// ---------------------------------------------------------------------------

/**
 * Callback invoked before entries are deleted, allowing archival to cold storage.
 *
 * @param action - The audit action type being archived
 * @param cutoff - Entries before this date will be deleted
 * @param count - Number of entries to be archived
 */
export type ArchiveHandler = (
  action: string,
  cutoff: Date,
  count: number,
) => Promise<void>

// ---------------------------------------------------------------------------
// Retention Policy Enforcer
// ---------------------------------------------------------------------------

export class RetentionEnforcer {
  private archiveHandler?: ArchiveHandler

  constructor(private auditService: AuditService) {}

  /**
   * Set a handler that will be called before entries are deleted,
   * allowing archival to cold storage (S3, GCS, etc.).
   */
  onArchive(handler: ArchiveHandler): void {
    this.archiveHandler = handler
  }

  /**
   * Enforce retention policies for all audit event types.
   * Deletes entries older than the configured retention period.
   *
   * @param asOf - The reference date (defaults to now). Useful for testing.
   * @returns Results for each action type processed.
   */
  async enforce(asOf: Date = new Date()): Promise<RetentionArchiveResult[]> {
    const results: RetentionArchiveResult[] = []

    // Group actions by retention duration to batch operations
    const byDuration = new Map<RetentionDuration, AuditAction[]>()
    for (const [action, meta] of Object.entries(AUDIT_EVENTS)) {
      const existing = byDuration.get(meta.retention) ?? []
      existing.push(action as AuditAction)
      byDuration.set(meta.retention, existing)
    }

    for (const [duration, actions] of byDuration) {
      const cutoff = subtractDuration(asOf, duration)

      for (const action of actions) {
        // Notify archive handler if set
        if (this.archiveHandler) {
          // Count is approximate — we pass 0 since exact count requires a query
          // In production, the store would provide the count before deletion
          await this.archiveHandler(action, cutoff, 0)
        }

        const deletedCount = await this.auditService.deleteByAction(action, cutoff)

        if (deletedCount > 0) {
          results.push({
            action,
            cutoffDate: cutoff,
            archivedCount: deletedCount, // In practice, archiveHandler would have archived these
            deletedCount,
          })
        }
      }
    }

    return results
  }

  /**
   * Get the retention cutoff date for a specific action.
   */
  getCutoffDate(action: AuditAction, asOf: Date = new Date()): Date {
    const meta = AUDIT_EVENTS[action]
    return subtractDuration(asOf, meta.retention)
  }

  /**
   * Get retention configuration for all actions.
   */
  getRetentionConfig(): Array<{ action: AuditAction; retention: RetentionDuration }> {
    return Object.entries(AUDIT_EVENTS).map(([action, meta]) => ({
      action: action as AuditAction,
      retention: meta.retention,
    }))
  }
}


