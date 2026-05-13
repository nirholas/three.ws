// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Tests — Audit Logging & Compliance Framework
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  AuditService,
  ComplianceService,
  InMemoryComplianceStore,
  RetentionEnforcer,
  computeEntryHash,
  verifyEntryHash,
  verifyChain,
  AUDIT_EVENTS,
  type AuditLogEntry,
  type SecurityAlert,
} from '../audit'

// ---------------------------------------------------------------------------
// Hash Chain
// ---------------------------------------------------------------------------

describe('Hash Chain', () => {
  const baseEntry: Omit<AuditLogEntry, 'prevHash' | 'entryHash'> = {
    id: '00000000-0000-0000-0000-000000000001',
    orgId: 'org-1',
    actorId: 'user-1',
    actorType: 'user',
    actorIp: '127.0.0.1',
    actorUserAgent: 'test-agent',
    action: 'auth.login',
    resourceType: 'session',
    resourceId: 'ses-1',
    severity: 'info',
    details: { browser: 'chrome' },
    changes: null,
    requestId: 'req-1',
    geoLocation: { country: 'US' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }

  it('computes deterministic hash for same input', () => {
    const hash1 = computeEntryHash(null, baseEntry)
    const hash2 = computeEntryHash(null, baseEntry)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex
  })

  it('produces different hash with different prevHash', () => {
    const hash1 = computeEntryHash(null, baseEntry)
    const hash2 = computeEntryHash('abc123', baseEntry)
    expect(hash1).not.toBe(hash2)
  })

  it('produces different hash with different data', () => {
    const hash1 = computeEntryHash(null, baseEntry)
    const hash2 = computeEntryHash(null, { ...baseEntry, action: 'auth.logout' })
    expect(hash1).not.toBe(hash2)
  })

  it('verifies a valid entry', () => {
    const entryHash = computeEntryHash(null, baseEntry)
    const entry: AuditLogEntry = { ...baseEntry, prevHash: null, entryHash }
    expect(verifyEntryHash(entry)).toBe(true)
  })

  it('detects tampered entry', () => {
    const entryHash = computeEntryHash(null, baseEntry)
    const entry: AuditLogEntry = {
      ...baseEntry,
      prevHash: null,
      entryHash,
      action: 'auth.logout', // tampered
    }
    expect(verifyEntryHash(entry)).toBe(false)
  })

  it('verifies a valid chain', () => {
    const entries: AuditLogEntry[] = []

    for (let i = 0; i < 5; i++) {
      const prevHash = entries[i - 1]?.entryHash ?? null
      const data = {
        ...baseEntry,
        id: `id-${i}`,
        createdAt: new Date(Date.now() + i * 1000),
      }
      const entryHash = computeEntryHash(prevHash, data)
      entries.push({ ...data, prevHash, entryHash })
    }

    expect(verifyChain(entries)).toBe(-1)
  })

  it('detects broken chain', () => {
    const entries: AuditLogEntry[] = []

    for (let i = 0; i < 5; i++) {
      const prevHash = entries[i - 1]?.entryHash ?? null
      const data = {
        ...baseEntry,
        id: `id-${i}`,
        createdAt: new Date(Date.now() + i * 1000),
      }
      const entryHash = computeEntryHash(prevHash, data)
      entries.push({ ...data, prevHash, entryHash })
    }

    // Tamper with entry 2's data
    entries[2] = { ...entries[2], details: { tampered: true } }

    expect(verifyChain(entries)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Audit Service
// ---------------------------------------------------------------------------

describe('AuditService', () => {
  let service: AuditService

  beforeEach(() => {
    service = new AuditService()
  })

  it('logs an audit event with correct severity from AUDIT_EVENTS', async () => {
    const entry = await service.log({
      orgId: 'org-1',
      action: 'auth.login',
      actorId: 'user-1',
      actorType: 'user',
      resourceType: 'session',
      resourceId: 'ses-1',
    })

    expect(entry.id).toBeDefined()
    expect(entry.severity).toBe('info')
    expect(entry.action).toBe('auth.login')
    expect(entry.entryHash).toHaveLength(64)
    expect(entry.prevHash).toBeNull() // first entry
  })

  it('builds a hash chain across multiple entries', async () => {
    const e1 = await service.log({
      orgId: 'org-1',
      action: 'auth.login',
      actorType: 'user',
      resourceType: 'session',
    })

    const e2 = await service.log({
      orgId: 'org-1',
      action: 'auth.logout',
      actorType: 'user',
      resourceType: 'session',
    })

    expect(e1.prevHash).toBeNull()
    expect(e2.prevHash).toBe(e1.entryHash)
  })

  it('maintains separate chains per org', async () => {
    const e1 = await service.log({
      orgId: 'org-1',
      action: 'auth.login',
      actorType: 'user',
      resourceType: 'session',
    })

    const e2 = await service.log({
      orgId: 'org-2',
      action: 'auth.login',
      actorType: 'user',
      resourceType: 'session',
    })

    expect(e1.prevHash).toBeNull()
    expect(e2.prevHash).toBeNull() // different org, independent chain
  })

  it('queries entries with filters', async () => {
    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    await service.log({ orgId: 'org-1', action: 'auth.logout', actorType: 'user', resourceType: 'session' })
    await service.log({ orgId: 'org-1', action: 'agent.created', actorType: 'user', resourceType: 'agent' })

    const result = await service.query('org-1', { action: 'auth.login' })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].action).toBe('auth.login')
    expect(result.total).toBe(1)
  })

  it('paginates results', async () => {
    for (let i = 0; i < 10; i++) {
      await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    }

    const page1 = await service.query('org-1', { page: 1, limit: 3 })
    expect(page1.entries).toHaveLength(3)
    expect(page1.total).toBe(10)
    expect(page1.hasMore).toBe(true)

    const page4 = await service.query('org-1', { page: 4, limit: 3 })
    expect(page4.entries).toHaveLength(1)
    expect(page4.hasMore).toBe(false)
  })

  it('verifies integrity of a valid chain', async () => {
    for (let i = 0; i < 5; i++) {
      await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    }

    const report = await service.verifyIntegrity('org-1')
    expect(report.totalEntries).toBe(5)
    expect(report.verified).toBe(5)
    expect(report.broken).toBe(0)
  })

  it('exports entries as JSON lines', async () => {
    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    await service.log({ orgId: 'org-1', action: 'auth.logout', actorType: 'user', resourceType: 'session' })

    const lines: string[] = []
    const start = new Date(Date.now() - 60000)
    const end = new Date(Date.now() + 60000)
    for await (const line of service.export('org-1', start, end, 'json')) {
      lines.push(line)
    }

    expect(lines).toHaveLength(2)
    const parsed = JSON.parse(lines[0])
    expect(parsed.action).toBeDefined()
  })

  it('exports entries as CSV', async () => {
    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })

    const lines: string[] = []
    const start = new Date(Date.now() - 60000)
    const end = new Date(Date.now() + 60000)
    for await (const line of service.export('org-1', start, end, 'csv')) {
      lines.push(line)
    }

    expect(lines[0]).toContain('id,action,actor_id') // header
    expect(lines).toHaveLength(2) // header + 1 entry
  })

  it('emits audit:logged event', async () => {
    const handler = vi.fn()
    service.on('audit:logged', handler)

    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0].action).toBe('auth.login')
  })

  it('gets summary statistics', async () => {
    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    await service.log({ orgId: 'org-1', action: 'auth.login', actorType: 'user', resourceType: 'session' })
    await service.log({ orgId: 'org-1', action: 'org.deleted', actorType: 'user', resourceType: 'org' })

    const start = new Date(Date.now() - 60000)
    const end = new Date(Date.now() + 60000)
    const summary = await service.getSummary('org-1', start, end)

    expect(summary.totalEvents).toBe(3)
    expect(summary.byAction['auth.login']).toBe(2)
    expect(summary.byAction['org.deleted']).toBe(1)
    expect(summary.bySeverity.info).toBe(2)
    expect(summary.bySeverity.critical).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Security Alerts
// ---------------------------------------------------------------------------

describe('Security Alerts', () => {
  it('triggers alert for critical events', async () => {
    const service = new AuditService()
    const alerts: SecurityAlert[] = []

    service.onSecurityAlert((alert) => { alerts.push(alert) })

    await service.log({
      orgId: 'org-1',
      action: 'admin.impersonation.started',
      actorId: 'admin-1',
      actorType: 'user',
      resourceType: 'user',
      resourceId: 'target-user',
    })

    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('critical')
    expect(alerts[0].channels).toContain('email')
    expect(alerts[0].channels).toContain('slack')
  })

  it('triggers alert for failed login', async () => {
    const service = new AuditService()
    const alerts: SecurityAlert[] = []

    service.onSecurityAlert((alert) => { alerts.push(alert) })

    await service.log({
      orgId: 'org-1',
      action: 'auth.login.failed',
      actorType: 'user',
      actorIp: '192.168.1.1',
      resourceType: 'session',
    })

    expect(alerts).toHaveLength(1)
    expect(alerts[0].message).toContain('192.168.1.1')
  })

  it('emits audit:alert event', async () => {
    const service = new AuditService()
    const handler = vi.fn()
    service.on('audit:alert', handler)

    await service.log({
      orgId: 'org-1',
      action: 'security.suspicious',
      actorType: 'system',
      resourceType: 'account',
      details: { reason: 'unusual activity' },
    })

    expect(handler).toHaveBeenCalledOnce()
  })

  it('does not crash if alert handler throws', async () => {
    const service = new AuditService()
    service.onSecurityAlert(() => { throw new Error('handler error') })

    // Should not throw
    const entry = await service.log({
      orgId: 'org-1',
      action: 'auth.login.failed',
      actorType: 'user',
      resourceType: 'session',
    })

    expect(entry.id).toBeDefined()
  })

  it('can remove alert handler', async () => {
    const service = new AuditService()
    const alerts: SecurityAlert[] = []
    const handler = (alert: SecurityAlert) => { alerts.push(alert) }

    service.onSecurityAlert(handler)
    service.offSecurityAlert(handler)

    await service.log({
      orgId: 'org-1',
      action: 'auth.login.failed',
      actorType: 'user',
      resourceType: 'session',
    })

    expect(alerts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// GDPR Compliance
// ---------------------------------------------------------------------------

describe('ComplianceService', () => {
  let auditService: AuditService
  let dataStore: InMemoryComplianceStore
  let compliance: ComplianceService

  beforeEach(() => {
    auditService = new AuditService()
    dataStore = new InMemoryComplianceStore()
    compliance = new ComplianceService(auditService, dataStore)

    // Seed test data
    dataStore.addUser('org-1', 'user-1', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'member',
    })
    dataStore.addAgent({ orgId: 'org-1', createdBy: 'user-1', id: 'agent-1', name: 'Bot A' })
    dataStore.addAgent({ orgId: 'org-1', createdBy: 'user-1', id: 'agent-2', name: 'Bot B' })
    dataStore.addSession({ orgId: 'org-1', userId: 'user-1', id: 'ses-1' })
    dataStore.addConversation({ orgId: 'org-1', userId: 'user-1', id: 'conv-1', messages: [] })
    dataStore.addApiKey({ orgId: 'org-1', createdBy: 'user-1', id: 'key-1', keyHash: 'secret' })
  })

  describe('exportUserData (Right to Access)', () => {
    it('exports all user data', async () => {
      const result = await compliance.exportUserData('org-1', 'user-1')

      expect(result.userId).toBe('user-1')
      expect(result.orgId).toBe('org-1')
      expect(result.data.user).toHaveProperty('name', 'Jane Doe')
      expect(result.data.agents).toHaveLength(2)
      expect(result.data.sessions).toHaveLength(1)
      expect(result.data.conversations).toHaveLength(1)
      expect(result.data.apiKeys).toHaveLength(1)
    })

    it('redacts key hashes from export', async () => {
      const result = await compliance.exportUserData('org-1', 'user-1')
      const exportedKey = result.data.apiKeys[0] as Record<string, unknown>
      expect(exportedKey).not.toHaveProperty('keyHash')
    })

    it('logs an audit event for the export', async () => {
      await compliance.exportUserData('org-1', 'user-1')

      const logs = await auditService.query('org-1', { action: 'data.exported' })
      expect(logs.entries).toHaveLength(1)
      expect(logs.entries[0].details).toHaveProperty('reason', 'gdpr_right_to_access')
    })
  })

  describe('deleteUserData (Right to Deletion)', () => {
    it('deletes user data and anonymizes audit trail', async () => {
      // Create some audit logs for the user
      await auditService.log({
        orgId: 'org-1',
        actorId: 'user-1',
        action: 'auth.login',
        actorType: 'user',
        resourceType: 'session',
      })

      const result = await compliance.deleteUserData('org-1', 'user-1')

      expect(result.deleted.conversations).toBe(1)
      expect(result.deleted.agents).toBe(2)
      expect(result.deleted.apiKeys).toBe(1)
      expect(result.deleted.sessions).toBe(1)
      expect(result.anonymized.auditLogs).toBe(1) // the login entry
      expect(result.anonymized.user).toBe(true)
    })

    it('anonymizes user record', async () => {
      await compliance.deleteUserData('org-1', 'user-1')

      const user = await dataStore.getUser('org-1', 'user-1')
      expect(user).not.toBeNull()
      expect(user!.name).toBe('Deleted User')
      expect(String(user!.email)).toContain('@anonymized.local')
      expect(user!.anonymizedAt).toBeDefined()
    })

    it('logs an audit event for the deletion', async () => {
      await compliance.deleteUserData('org-1', 'user-1')

      const logs = await auditService.query('org-1', { action: 'data.deleted' })
      expect(logs.entries).toHaveLength(1)
      expect(logs.entries[0].details).toHaveProperty('reason', 'gdpr_right_to_deletion')
    })
  })
})

// ---------------------------------------------------------------------------
// Retention Enforcement
// ---------------------------------------------------------------------------

describe('RetentionEnforcer', () => {
  let service: AuditService
  let enforcer: RetentionEnforcer

  beforeEach(() => {
    service = new AuditService()
    enforcer = new RetentionEnforcer(service)
  })

  it('deletes entries older than retention period', async () => {
    // Create an auth.logout entry with 1y retention
    // Manually insert an old entry by logging then checking
    const entry = await service.log({
      orgId: 'org-1',
      action: 'auth.logout',
      actorType: 'user',
      resourceType: 'session',
    })

    // Simulate the entry being old by enforcing with a future date
    const twoYearsLater = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
    const results = await enforcer.enforce(twoYearsLater)

    // auth.logout has 1y retention, so it should be deleted
    const logoutResults = results.filter((r) => r.action === 'auth.logout')
    expect(logoutResults).toHaveLength(1)
    expect(logoutResults[0].deletedCount).toBe(1)
  })

  it('preserves entries within retention period', async () => {
    await service.log({
      orgId: 'org-1',
      action: 'org.created', // 7y retention
      actorType: 'user',
      resourceType: 'org',
    })

    // Enforce with a date only 1 year in the future
    const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    const results = await enforcer.enforce(oneYearLater)

    // org.created has 7y retention — should NOT be deleted
    const orgResults = results.filter((r) => r.action === 'org.created')
    expect(orgResults).toHaveLength(0)
  })

  it('calls archive handler before deletion', async () => {
    await service.log({
      orgId: 'org-1',
      action: 'auth.logout',
      actorType: 'user',
      resourceType: 'session',
    })

    const archiveCalls: Array<{ action: string; cutoff: Date }> = []
    enforcer.onArchive(async (action, cutoff) => {
      archiveCalls.push({ action, cutoff })
    })

    const twoYearsLater = new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000)
    await enforcer.enforce(twoYearsLater)

    // Should have been called for auth.logout (and other 1y actions)
    const logoutArchive = archiveCalls.find((c) => c.action === 'auth.logout')
    expect(logoutArchive).toBeDefined()
  })

  it('returns retention config for all actions', () => {
    const config = enforcer.getRetentionConfig()
    expect(config.length).toBe(Object.keys(AUDIT_EVENTS).length)
    expect(config.find((c) => c.action === 'auth.login')?.retention).toBe('2y')
    expect(config.find((c) => c.action === 'org.created')?.retention).toBe('7y')
  })

  it('calculates correct cutoff dates', () => {
    const now = new Date('2026-03-23T00:00:00Z')
    const cutoff1y = enforcer.getCutoffDate('auth.logout', now)
    const cutoff7y = enforcer.getCutoffDate('org.created', now)

    // 1y retention → cutoff ~2025-03-23
    expect(cutoff1y.getFullYear()).toBe(2025)
    // 7y retention → cutoff ~2019-03-23
    expect(cutoff7y.getFullYear()).toBe(2019)
  })
})

// ---------------------------------------------------------------------------
// AUDIT_EVENTS constant
// ---------------------------------------------------------------------------

describe('AUDIT_EVENTS', () => {
  it('has 20+ event types', () => {
    expect(Object.keys(AUDIT_EVENTS).length).toBeGreaterThanOrEqual(20)
  })

  it('all events have severity and retention', () => {
    for (const [action, meta] of Object.entries(AUDIT_EVENTS)) {
      expect(['info', 'warning', 'critical']).toContain(meta.severity)
      expect(['1y', '2y', '7y']).toContain(meta.retention)
    }
  })

  it('critical events have appropriate retention', () => {
    for (const [action, meta] of Object.entries(AUDIT_EVENTS)) {
      if (meta.severity === 'critical') {
        expect(['2y', '7y']).toContain(meta.retention)
      }
    }
  })
})


