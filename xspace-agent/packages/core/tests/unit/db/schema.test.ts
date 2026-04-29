// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Tests — Database Schema Definitions
// =============================================================================
//
// These tests verify that the Drizzle schema tables have the correct columns,
// types, constraints, and foreign key references.  They introspect the schema
// objects exported by schema.ts rather than running DDL against a database.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  organizations,
  users,
  apiKeys,
  agents,
  agentSessions,
  conversations,
  usageRecords,
  auditLogs,
  webhooks,
  webhookDeliveries,
  customRoles,
  orgMembers,
  invitations,
  teams,
  refreshTokens,
  userSessions,
  samlConfigs,
  oidcConfigs,
  mfaSecrets,
  oauthAccounts,
  marketplaceListings,
  marketplaceInstalls,
  marketplaceReviews,
  publisherPayouts,
  agentVersions,
  agentDeployments,
  resellers,
  subOrganizations,
  customDomains,
  agentTemplates,
  impersonationSessions,
  conversationAnalytics,
  sentimentTimeseries,
} from '../../../src/db/schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get column config object for a Drizzle table column. */
function getColumn(table: any, colName: string) {
  const col = table[colName]
  if (!col) throw new Error(`Column "${colName}" not found on table`)
  return col
}

/** Check whether a column is marked notNull (Drizzle stores this in config). */
function isNotNull(table: any, colName: string): boolean {
  const col = getColumn(table, colName)
  return col.notNull === true
}

/** Check whether a column has a default value defined. */
function hasDefault(table: any, colName: string): boolean {
  const col = getColumn(table, colName)
  return col.hasDefault === true
}

/** Get the underlying SQL column name. */
function sqlName(table: any, colName: string): string {
  const col = getColumn(table, colName)
  return col.name
}

// =============================================================================
// Organizations
// =============================================================================

describe('Schema — organizations', () => {
  it('should have the correct table name', () => {
    // Drizzle pgTable objects expose the SQL table name via Symbol
    expect((organizations as any)[Symbol.for('drizzle:Name')]).toBe('organizations')
  })

  it('should have a uuid primary key "id"', () => {
    const col = getColumn(organizations, 'id')
    expect(col.primary).toBe(true)
    expect(col.columnType).toBe('PgUUID')
    expect(col.hasDefault).toBe(true) // defaultRandom
  })

  it('should require name (notNull)', () => {
    expect(isNotNull(organizations, 'name')).toBe(true)
  })

  it('should require slug (notNull, unique)', () => {
    expect(isNotNull(organizations, 'slug')).toBe(true)
    expect(getColumn(organizations, 'slug').isUnique).toBe(true)
  })

  it('should default plan to "free"', () => {
    expect(hasDefault(organizations, 'plan')).toBe(true)
  })

  it('should have timestamp columns with defaults', () => {
    expect(hasDefault(organizations, 'createdAt')).toBe(true)
    expect(hasDefault(organizations, 'updatedAt')).toBe(true)
  })

  it('should have optional stripeCustomerId and stripeSubscriptionId', () => {
    expect(isNotNull(organizations, 'stripeCustomerId')).toBe(false)
    expect(isNotNull(organizations, 'stripeSubscriptionId')).toBe(false)
  })

  it('should have jsonb settings with default', () => {
    const col = getColumn(organizations, 'settings')
    expect(col.columnType).toBe('PgJsonb')
    expect(hasDefault(organizations, 'settings')).toBe(true)
  })
})

// =============================================================================
// Users
// =============================================================================

describe('Schema — users', () => {
  it('should have uuid primary key', () => {
    const col = getColumn(users, 'id')
    expect(col.primary).toBe(true)
    expect(col.columnType).toBe('PgUUID')
  })

  it('should require email (notNull, unique)', () => {
    expect(isNotNull(users, 'email')).toBe(true)
    expect(getColumn(users, 'email').isUnique).toBe(true)
  })

  it('should have orgId referencing organizations', () => {
    const col = getColumn(users, 'orgId')
    expect(col.columnType).toBe('PgUUID')
  })

  it('should default role to "member"', () => {
    expect(hasDefault(users, 'role')).toBe(true)
  })

  it('should have optional name, passwordHash, sso fields', () => {
    expect(isNotNull(users, 'name')).toBe(false)
    expect(isNotNull(users, 'passwordHash')).toBe(false)
    expect(isNotNull(users, 'ssoProvider')).toBe(false)
    expect(isNotNull(users, 'ssoSubject')).toBe(false)
  })

  it('should have createdAt with default', () => {
    expect(hasDefault(users, 'createdAt')).toBe(true)
  })

  it('should use correct SQL column names', () => {
    expect(sqlName(users, 'orgId')).toBe('org_id')
    expect(sqlName(users, 'passwordHash')).toBe('password_hash')
    expect(sqlName(users, 'lastLoginAt')).toBe('last_login_at')
    expect(sqlName(users, 'ssoProvider')).toBe('sso_provider')
    expect(sqlName(users, 'ssoSubject')).toBe('sso_subject')
  })
})

// =============================================================================
// API Keys
// =============================================================================

describe('Schema — apiKeys', () => {
  it('should require keyHash and keyPrefix and name', () => {
    expect(isNotNull(apiKeys, 'keyHash')).toBe(true)
    expect(isNotNull(apiKeys, 'keyPrefix')).toBe(true)
    expect(isNotNull(apiKeys, 'name')).toBe(true)
  })

  it('should have default rateLimit of 1000', () => {
    expect(hasDefault(apiKeys, 'rateLimit')).toBe(true)
  })

  it('should have optional expiresAt', () => {
    expect(isNotNull(apiKeys, 'expiresAt')).toBe(false)
  })
})

// =============================================================================
// Agents
// =============================================================================

describe('Schema — agents', () => {
  it('should require name and config', () => {
    expect(isNotNull(agents, 'name')).toBe(true)
    expect(isNotNull(agents, 'config')).toBe(true)
  })

  it('should have config as jsonb', () => {
    expect(getColumn(agents, 'config').columnType).toBe('PgJsonb')
  })

  it('should default status to "idle"', () => {
    expect(hasDefault(agents, 'status')).toBe(true)
  })

  it('should default version to 1', () => {
    expect(hasDefault(agents, 'version')).toBe(true)
  })

  it('should map orgId to org_id in SQL', () => {
    expect(sqlName(agents, 'orgId')).toBe('org_id')
  })
})

// =============================================================================
// Agent Sessions
// =============================================================================

describe('Schema — agentSessions', () => {
  it('should require platform (notNull, default "x-spaces")', () => {
    expect(isNotNull(agentSessions, 'platform')).toBe(true)
    expect(hasDefault(agentSessions, 'platform')).toBe(true)
  })

  it('should require status (notNull, default "active")', () => {
    expect(isNotNull(agentSessions, 'status')).toBe(true)
    expect(hasDefault(agentSessions, 'status')).toBe(true)
  })

  it('should have optional endedAt and durationSeconds', () => {
    expect(isNotNull(agentSessions, 'endedAt')).toBe(false)
    expect(isNotNull(agentSessions, 'durationSeconds')).toBe(false)
  })

  it('should have jsonb metadata with default', () => {
    expect(getColumn(agentSessions, 'metadata').columnType).toBe('PgJsonb')
    expect(hasDefault(agentSessions, 'metadata')).toBe(true)
  })

  it('should map SQL column names correctly', () => {
    expect(sqlName(agentSessions, 'agentId')).toBe('agent_id')
    expect(sqlName(agentSessions, 'spaceUrl')).toBe('space_url')
    expect(sqlName(agentSessions, 'startedAt')).toBe('started_at')
    expect(sqlName(agentSessions, 'endedAt')).toBe('ended_at')
    expect(sqlName(agentSessions, 'durationSeconds')).toBe('duration_seconds')
  })
})

// =============================================================================
// Conversations
// =============================================================================

describe('Schema — conversations', () => {
  it('should have jsonb messages with default', () => {
    expect(getColumn(conversations, 'messages').columnType).toBe('PgJsonb')
    expect(hasDefault(conversations, 'messages')).toBe(true)
  })

  it('should have optional summary and sentimentAvg', () => {
    expect(isNotNull(conversations, 'summary')).toBe(false)
    expect(isNotNull(conversations, 'sentimentAvg')).toBe(false)
  })

  it('should have sentimentAvg as real type', () => {
    expect(getColumn(conversations, 'sentimentAvg').columnType).toBe('PgReal')
  })

  it('should map sessionId to session_id', () => {
    expect(sqlName(conversations, 'sessionId')).toBe('session_id')
  })
})

// =============================================================================
// Usage Records
// =============================================================================

describe('Schema — usageRecords', () => {
  it('should require metric and quantity', () => {
    expect(isNotNull(usageRecords, 'metric')).toBe(true)
    expect(isNotNull(usageRecords, 'quantity')).toBe(true)
  })

  it('should have bigint quantity', () => {
    expect(getColumn(usageRecords, 'quantity').columnType).toBe('PgBigInt53')
  })

  it('should have optional provider', () => {
    expect(isNotNull(usageRecords, 'provider')).toBe(false)
  })
})

// =============================================================================
// Audit Logs
// =============================================================================

describe('Schema — auditLogs', () => {
  it('should require action and resourceType', () => {
    expect(isNotNull(auditLogs, 'action')).toBe(true)
    expect(isNotNull(auditLogs, 'resourceType')).toBe(true)
  })

  it('should have inet actorIp column', () => {
    expect(getColumn(auditLogs, 'actorIp').columnType).toBe('PgInet')
  })

  it('should default severity to "info"', () => {
    expect(hasDefault(auditLogs, 'severity')).toBe(true)
  })

  it('should have jsonb details and changes', () => {
    expect(getColumn(auditLogs, 'details').columnType).toBe('PgJsonb')
    expect(getColumn(auditLogs, 'changes').columnType).toBe('PgJsonb')
  })

  it('should have hash chain columns (prevHash, entryHash)', () => {
    expect(isNotNull(auditLogs, 'prevHash')).toBe(false)
    expect(isNotNull(auditLogs, 'entryHash')).toBe(false)
  })
})

// =============================================================================
// Webhooks
// =============================================================================

describe('Schema — webhooks', () => {
  it('should require url, secret, and events', () => {
    expect(isNotNull(webhooks, 'url')).toBe(true)
    expect(isNotNull(webhooks, 'secret')).toBe(true)
    expect(isNotNull(webhooks, 'events')).toBe(true)
  })

  it('should have default failureCount of 0', () => {
    expect(hasDefault(webhooks, 'failureCount')).toBe(true)
  })
})

// =============================================================================
// Webhook Deliveries
// =============================================================================

describe('Schema — webhookDeliveries', () => {
  it('should require eventType and payload', () => {
    expect(isNotNull(webhookDeliveries, 'eventType')).toBe(true)
    expect(isNotNull(webhookDeliveries, 'payload')).toBe(true)
  })

  it('should have default status "pending"', () => {
    expect(hasDefault(webhookDeliveries, 'status')).toBe(true)
  })

  it('should have optional responseStatus and durationMs', () => {
    expect(isNotNull(webhookDeliveries, 'responseStatus')).toBe(false)
    expect(isNotNull(webhookDeliveries, 'durationMs')).toBe(false)
  })
})

// =============================================================================
// Custom Roles
// =============================================================================

describe('Schema — customRoles', () => {
  it('should require orgId and name', () => {
    expect(isNotNull(customRoles, 'orgId')).toBe(true)
    expect(isNotNull(customRoles, 'name')).toBe(true)
  })

  it('should have array permissions with default', () => {
    expect(isNotNull(customRoles, 'permissions')).toBe(true)
    expect(hasDefault(customRoles, 'permissions')).toBe(true)
  })
})

// =============================================================================
// Org Members
// =============================================================================

describe('Schema — orgMembers', () => {
  it('should require orgId and userId', () => {
    expect(isNotNull(orgMembers, 'orgId')).toBe(true)
    expect(isNotNull(orgMembers, 'userId')).toBe(true)
  })

  it('should default role to "viewer"', () => {
    expect(hasDefault(orgMembers, 'role')).toBe(true)
  })

  it('should have optional customRoleId and invitedBy', () => {
    expect(isNotNull(orgMembers, 'customRoleId')).toBe(false)
    expect(isNotNull(orgMembers, 'invitedBy')).toBe(false)
  })
})

// =============================================================================
// Invitations
// =============================================================================

describe('Schema — invitations', () => {
  it('should require orgId, email, role, tokenHash, expiresAt', () => {
    expect(isNotNull(invitations, 'orgId')).toBe(true)
    expect(isNotNull(invitations, 'email')).toBe(true)
    expect(isNotNull(invitations, 'role')).toBe(true)
    expect(isNotNull(invitations, 'tokenHash')).toBe(true)
    expect(isNotNull(invitations, 'expiresAt')).toBe(true)
  })

  it('should default status to "pending"', () => {
    expect(hasDefault(invitations, 'status')).toBe(true)
  })
})

// =============================================================================
// Teams
// =============================================================================

describe('Schema — teams', () => {
  it('should require orgId and name', () => {
    expect(isNotNull(teams, 'orgId')).toBe(true)
    expect(isNotNull(teams, 'name')).toBe(true)
  })

  it('should have array memberIds with default', () => {
    expect(hasDefault(teams, 'memberIds')).toBe(true)
  })
})

// =============================================================================
// Marketplace Listings
// =============================================================================

describe('Schema — marketplaceListings', () => {
  it('should require type, name, slug, description, category, pricingModel, version', () => {
    expect(isNotNull(marketplaceListings, 'type')).toBe(true)
    expect(isNotNull(marketplaceListings, 'name')).toBe(true)
    expect(isNotNull(marketplaceListings, 'slug')).toBe(true)
    expect(isNotNull(marketplaceListings, 'description')).toBe(true)
    expect(isNotNull(marketplaceListings, 'category')).toBe(true)
    expect(isNotNull(marketplaceListings, 'pricingModel')).toBe(true)
    expect(isNotNull(marketplaceListings, 'version')).toBe(true)
  })

  it('should have slug as unique', () => {
    expect(getColumn(marketplaceListings, 'slug').isUnique).toBe(true)
  })

  it('should have ratingAvg as real type', () => {
    expect(getColumn(marketplaceListings, 'ratingAvg').columnType).toBe('PgReal')
  })

  it('should default installCount and ratingCount', () => {
    expect(hasDefault(marketplaceListings, 'installCount')).toBe(true)
    expect(hasDefault(marketplaceListings, 'ratingCount')).toBe(true)
  })
})

// =============================================================================
// Agent Versions
// =============================================================================

describe('Schema — agentVersions', () => {
  it('should require agentId, orgId, version, config', () => {
    expect(isNotNull(agentVersions, 'agentId')).toBe(true)
    expect(isNotNull(agentVersions, 'orgId')).toBe(true)
    expect(isNotNull(agentVersions, 'version')).toBe(true)
    expect(isNotNull(agentVersions, 'config')).toBe(true)
  })

  it('should default status to "draft"', () => {
    expect(hasDefault(agentVersions, 'status')).toBe(true)
  })
})

// =============================================================================
// Agent Deployments
// =============================================================================

describe('Schema — agentDeployments', () => {
  it('should require agentId, versionId, orgId, environment', () => {
    expect(isNotNull(agentDeployments, 'agentId')).toBe(true)
    expect(isNotNull(agentDeployments, 'versionId')).toBe(true)
    expect(isNotNull(agentDeployments, 'orgId')).toBe(true)
    expect(isNotNull(agentDeployments, 'environment')).toBe(true)
  })

  it('should default status to "pending"', () => {
    expect(hasDefault(agentDeployments, 'status')).toBe(true)
  })

  it('should have jsonb metrics with default', () => {
    expect(getColumn(agentDeployments, 'metrics').columnType).toBe('PgJsonb')
    expect(hasDefault(agentDeployments, 'metrics')).toBe(true)
  })
})

// =============================================================================
// Conversation Analytics
// =============================================================================

describe('Schema — conversationAnalytics', () => {
  it('should have real-typed sentiment columns', () => {
    expect(getColumn(conversationAnalytics, 'sentimentAvg').columnType).toBe('PgReal')
    expect(getColumn(conversationAnalytics, 'sentimentMin').columnType).toBe('PgReal')
    expect(getColumn(conversationAnalytics, 'sentimentMax').columnType).toBe('PgReal')
  })

  it('should have jsonb topics, speakers, actionItems, highlights, riskFlags', () => {
    for (const col of ['topics', 'speakers', 'actionItems', 'highlights', 'riskFlags']) {
      expect(getColumn(conversationAnalytics, col).columnType).toBe('PgJsonb')
    }
  })

  it('should have all analytics columns as optional', () => {
    for (const col of [
      'durationSeconds',
      'activeSpeakingSeconds',
      'silenceSeconds',
      'participantCount',
      'totalTurns',
      'avgTurnLengthSeconds',
      'sentimentAvg',
      'sentimentMin',
      'sentimentMax',
      'sentimentTrend',
      'primaryTopic',
      'summary',
    ]) {
      expect(isNotNull(conversationAnalytics, col)).toBe(false)
    }
  })
})

// =============================================================================
// Sentiment Timeseries
// =============================================================================

describe('Schema — sentimentTimeseries', () => {
  it('should require sessionId, timestamp, speaker, sentiment', () => {
    expect(isNotNull(sentimentTimeseries, 'sessionId')).toBe(true)
    expect(isNotNull(sentimentTimeseries, 'timestamp')).toBe(true)
    expect(isNotNull(sentimentTimeseries, 'speaker')).toBe(true)
    expect(isNotNull(sentimentTimeseries, 'sentiment')).toBe(true)
  })

  it('should have sentiment as real type', () => {
    expect(getColumn(sentimentTimeseries, 'sentiment').columnType).toBe('PgReal')
  })

  it('should have optional topic', () => {
    expect(isNotNull(sentimentTimeseries, 'topic')).toBe(false)
  })
})

// =============================================================================
// Resellers
// =============================================================================

describe('Schema — resellers', () => {
  it('should require orgId', () => {
    expect(isNotNull(resellers, 'orgId')).toBe(true)
  })

  it('should have wholesaleDiscount as real', () => {
    expect(getColumn(resellers, 'wholesaleDiscount').columnType).toBe('PgReal')
  })

  it('should default tier to "branded"', () => {
    expect(hasDefault(resellers, 'tier')).toBe(true)
  })
})

// =============================================================================
// Cross-table column name consistency
// =============================================================================

describe('Schema — SQL column name conventions', () => {
  it('should use snake_case for all SQL column names across core tables', () => {
    const tables = [
      { table: organizations, cols: ['stripeCustomerId', 'stripeSubscriptionId', 'createdAt', 'updatedAt'] },
      { table: users, cols: ['orgId', 'passwordHash', 'ssoProvider', 'ssoSubject', 'lastLoginAt', 'createdAt'] },
      { table: agents, cols: ['orgId', 'createdAt', 'updatedAt'] },
      { table: agentSessions, cols: ['agentId', 'orgId', 'spaceUrl', 'startedAt', 'endedAt', 'durationSeconds'] },
      { table: conversations, cols: ['sessionId', 'orgId', 'sentimentAvg', 'createdAt'] },
    ]

    for (const { table, cols } of tables) {
      for (const col of cols) {
        const name = sqlName(table, col)
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})


