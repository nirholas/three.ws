// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§70]

// =============================================================================
// Audit Logging — Hash Chain for Tamper Evidence
// =============================================================================

import { createHash } from 'node:crypto'
import type { AuditLogEntry } from './types'

/**
 * Serialize an audit entry deterministically for hashing.
 * Excludes `prevHash` and `entryHash` from the serialized form.
 */
function serializeForHash(entry: Omit<AuditLogEntry, 'prevHash' | 'entryHash'>): string {
  const ordered: Record<string, unknown> = {
    id: entry.id,
    orgId: entry.orgId,
    actorId: entry.actorId,
    actorType: entry.actorType,
    actorIp: entry.actorIp,
    actorUserAgent: entry.actorUserAgent,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    severity: entry.severity,
    details: entry.details,
    changes: entry.changes,
    requestId: entry.requestId,
    geoLocation: entry.geoLocation,
    createdAt: entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : entry.createdAt,
  }
  return JSON.stringify(ordered)
}

/**
 * Compute the SHA-256 hash for an audit log entry.
 *
 * @param prevHash - Hash of the previous entry in this org's chain (null for the first entry)
 * @param entry - The audit entry data (without hash fields)
 * @returns hex-encoded SHA-256 hash
 */
export function computeEntryHash(
  prevHash: string | null,
  entry: Omit<AuditLogEntry, 'prevHash' | 'entryHash'>,
): string {
  const serialized = serializeForHash(entry)
  const payload = `${prevHash ?? 'GENESIS'}.${serialized}`
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Verify that a single entry's hash is correct given the previous hash.
 */
export function verifyEntryHash(entry: AuditLogEntry): boolean {
  const expected = computeEntryHash(entry.prevHash, entry)
  return expected === entry.entryHash
}

/**
 * Verify an ordered chain of audit log entries.
 * Entries must be sorted by createdAt ascending.
 *
 * @returns Index of first broken entry, or -1 if chain is valid.
 */
export function verifyChain(entries: AuditLogEntry[]): number {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Verify the entry's own hash
    if (!verifyEntryHash(entry)) {
      return i
    }

    // Verify chain linkage (prevHash should match prior entry's entryHash)
    if (i > 0) {
      const prev = entries[i - 1]
      if (entry.prevHash !== prev.entryHash) {
        return i
      }
    } else {
      // First entry in chain can have null prevHash or link to an earlier entry outside this batch
      // We can only verify the hash itself, not the linkage
    }
  }
  return -1
}


