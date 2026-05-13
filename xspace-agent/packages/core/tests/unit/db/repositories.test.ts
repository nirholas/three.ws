// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// Tests — Repositories (mock Drizzle)
// =============================================================================
//
// Each repository uses `getDatabase()` to obtain the Drizzle instance, then
// calls standard Drizzle query/insert/update/delete methods.  We mock the
// connection module so that `getDatabase()` returns a controllable stub, then
// verify that each repository method delegates correctly.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock database — a deeply-nested stub that mirrors the Drizzle API surface
// used by the repositories.
// ---------------------------------------------------------------------------

function createReturningChain(resolvedValue: any) {
  return {
    returning: vi.fn().mockResolvedValue(resolvedValue),
  }
}

function createWhereChain(resolvedValue: any) {
  return {
    where: vi.fn().mockReturnValue(createReturningChain(resolvedValue)),
  }
}

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue(createReturningChain([])),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue(createWhereChain([])),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    query: {
      organizations: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      users: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      agents: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      agentSessions: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(undefined),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  }
}

let mockDb: ReturnType<typeof createMockDb>

vi.mock('../../../src/db/connection', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

// Import repositories after mock is in place
import { OrganizationRepository } from '../../../src/db/repositories/organization'
import { UserRepository } from '../../../src/db/repositories/user'
import { AgentRepository } from '../../../src/db/repositories/agent'
import { SessionRepository } from '../../../src/db/repositories/session'
import { ConversationRepository } from '../../../src/db/repositories/conversation'

// =============================================================================
// OrganizationRepository
// =============================================================================

describe('OrganizationRepository', () => {
  let repo: OrganizationRepository

  beforeEach(() => {
    mockDb = createMockDb()
    repo = new OrganizationRepository()
  })

  describe('create', () => {
    it('should insert and return the created organization', async () => {
      const newOrg = { name: 'Acme', slug: 'acme' }
      const createdOrg = { id: 'uuid-1', ...newOrg, plan: 'free', createdAt: new Date() }

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdOrg]),
        }),
      })

      const result = await repo.create(newOrg as any)

      expect(result).toEqual(createdOrg)
      expect(mockDb.insert).toHaveBeenCalled()
    })
  })

  describe('findById', () => {
    it('should query organizations by id', async () => {
      const org = { id: 'uuid-1', name: 'Acme', slug: 'acme' }
      mockDb.query.organizations.findFirst.mockResolvedValue(org)

      const result = await repo.findById('uuid-1')

      expect(result).toEqual(org)
      expect(mockDb.query.organizations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.anything() }),
      )
    })

    it('should return undefined when organization not found', async () => {
      mockDb.query.organizations.findFirst.mockResolvedValue(undefined)

      const result = await repo.findById('nonexistent')
      expect(result).toBeUndefined()
    })
  })

  describe('findBySlug', () => {
    it('should query organizations by slug', async () => {
      const org = { id: 'uuid-1', name: 'Acme', slug: 'acme' }
      mockDb.query.organizations.findFirst.mockResolvedValue(org)

      const result = await repo.findBySlug('acme')

      expect(result).toEqual(org)
      expect(mockDb.query.organizations.findFirst).toHaveBeenCalled()
    })
  })

  describe('findByStripeCustomerId', () => {
    it('should query by stripeCustomerId', async () => {
      const org = { id: 'uuid-1', stripeCustomerId: 'cus_123' }
      mockDb.query.organizations.findFirst.mockResolvedValue(org)

      const result = await repo.findByStripeCustomerId('cus_123')

      expect(result).toEqual(org)
    })
  })

  describe('update', () => {
    it('should update the organization and return it', async () => {
      const updated = { id: 'uuid-1', name: 'New Name', slug: 'acme' }

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      })

      const result = await repo.update('uuid-1', { name: 'New Name' })

      expect(result).toEqual(updated)
      expect(mockDb.update).toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('should delete the organization by id', async () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })

      await expect(repo.delete('uuid-1')).resolves.toBeUndefined()
      expect(mockDb.delete).toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('should return all organizations ordered by createdAt desc', async () => {
      const orgs = [
        { id: 'uuid-2', name: 'Beta' },
        { id: 'uuid-1', name: 'Alpha' },
      ]
      mockDb.query.organizations.findMany.mockResolvedValue(orgs)

      const result = await repo.list()

      expect(result).toEqual(orgs)
      expect(mockDb.query.organizations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: expect.any(Function) }),
      )
    })
  })
})

// =============================================================================
// UserRepository
// =============================================================================

describe('UserRepository', () => {
  let repo: UserRepository

  beforeEach(() => {
    mockDb = createMockDb()
    repo = new UserRepository()
  })

  describe('create', () => {
    it('should insert and return the created user', async () => {
      const newUser = { email: 'alice@example.com', role: 'admin' }
      const createdUser = { id: 'uuid-u1', ...newUser }

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdUser]),
        }),
      })

      const result = await repo.create(newUser as any)
      expect(result).toEqual(createdUser)
    })
  })

  describe('findById', () => {
    it('should find a user by id', async () => {
      const user = { id: 'uuid-u1', email: 'alice@example.com' }
      mockDb.query.users.findFirst.mockResolvedValue(user)

      const result = await repo.findById('uuid-u1')
      expect(result).toEqual(user)
    })
  })

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      const user = { id: 'uuid-u1', email: 'alice@example.com' }
      mockDb.query.users.findFirst.mockResolvedValue(user)

      const result = await repo.findByEmail('alice@example.com')
      expect(result).toEqual(user)
    })

    it('should return undefined for unknown email', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(undefined)

      const result = await repo.findByEmail('nobody@example.com')
      expect(result).toBeUndefined()
    })
  })

  describe('findByOrgId', () => {
    it('should return all users in an organization', async () => {
      const users = [
        { id: 'u1', orgId: 'org-1' },
        { id: 'u2', orgId: 'org-1' },
      ]
      mockDb.query.users.findMany.mockResolvedValue(users)

      const result = await repo.findByOrgId('org-1')
      expect(result).toHaveLength(2)
    })
  })

  describe('findBySSOSubject', () => {
    it('should find a user by SSO provider and subject', async () => {
      const user = { id: 'u1', ssoProvider: 'google', ssoSubject: 'sub-123' }
      mockDb.query.users.findFirst.mockResolvedValue(user)

      const result = await repo.findBySSOSubject('google', 'sub-123')
      expect(result).toEqual(user)
    })
  })

  describe('update', () => {
    it('should update user fields and return updated user', async () => {
      const updated = { id: 'u1', name: 'Alice Updated' }
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      })

      const result = await repo.update('u1', { name: 'Alice Updated' })
      expect(result).toEqual(updated)
    })
  })

  describe('updateLastLogin', () => {
    it('should set lastLoginAt to current timestamp', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.updateLastLogin('u1')

      expect(mockDb.update).toHaveBeenCalled()
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      )
    })
  })

  describe('delete', () => {
    it('should delete the user by id', async () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })

      await expect(repo.delete('u1')).resolves.toBeUndefined()
    })
  })
})

// =============================================================================
// AgentRepository
// =============================================================================

describe('AgentRepository', () => {
  let repo: AgentRepository

  beforeEach(() => {
    mockDb = createMockDb()
    repo = new AgentRepository()
  })

  describe('create', () => {
    it('should insert and return the created agent', async () => {
      const newAgent = { name: 'TestBot', config: { provider: 'openai' } }
      const createdAgent = { id: 'agent-1', ...newAgent, status: 'idle', version: 1 }

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdAgent]),
        }),
      })

      const result = await repo.create(newAgent as any)
      expect(result).toEqual(createdAgent)
    })
  })

  describe('findById', () => {
    it('should find an agent by id', async () => {
      const agent = { id: 'agent-1', name: 'TestBot' }
      mockDb.query.agents.findFirst.mockResolvedValue(agent)

      const result = await repo.findById('agent-1')
      expect(result).toEqual(agent)
    })
  })

  describe('findByOrgId', () => {
    it('should return agents for an organization ordered by createdAt desc', async () => {
      const agents = [{ id: 'a1' }, { id: 'a2' }]
      mockDb.query.agents.findMany.mockResolvedValue(agents)

      const result = await repo.findByOrgId('org-1')
      expect(result).toEqual(agents)
      expect(mockDb.query.agents.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
          orderBy: expect.any(Function),
        }),
      )
    })
  })

  describe('update', () => {
    it('should update agent fields including updatedAt', async () => {
      const updated = { id: 'agent-1', name: 'Updated Bot' }

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      })

      const result = await repo.update('agent-1', { name: 'Updated Bot' })
      expect(result).toEqual(updated)
    })
  })

  describe('updateStatus', () => {
    it('should update agent status and updatedAt', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.updateStatus('agent-1', 'running')

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', updatedAt: expect.any(Date) }),
      )
    })
  })

  describe('incrementVersion', () => {
    it('should increment the version by 1', async () => {
      const current = { id: 'agent-1', version: 3 }
      mockDb.query.agents.findFirst.mockResolvedValue(current)

      const updated = { id: 'agent-1', version: 4 }
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      })

      const result = await repo.incrementVersion('agent-1')
      expect(result).toEqual(updated)
    })

    it('should return undefined when agent does not exist', async () => {
      mockDb.query.agents.findFirst.mockResolvedValue(undefined)

      const result = await repo.incrementVersion('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should handle null version (defaults to 0 + 1 = 1)', async () => {
      const current = { id: 'agent-1', version: null }
      mockDb.query.agents.findFirst.mockResolvedValue(current)

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'agent-1', version: 1 }]),
        }),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.incrementVersion('agent-1')

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1 }),
      )
    })
  })

  describe('delete', () => {
    it('should delete the agent', async () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })

      await expect(repo.delete('agent-1')).resolves.toBeUndefined()
    })
  })
})

// =============================================================================
// SessionRepository
// =============================================================================

describe('SessionRepository', () => {
  let repo: SessionRepository

  beforeEach(() => {
    mockDb = createMockDb()
    repo = new SessionRepository()
  })

  describe('create', () => {
    it('should insert and return the created session', async () => {
      const newSession = { agentId: 'a1', orgId: 'org-1', platform: 'x-spaces' }
      const created = { id: 'sess-1', ...newSession, status: 'active' }

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      })

      const result = await repo.create(newSession as any)
      expect(result).toEqual(created)
    })
  })

  describe('findById', () => {
    it('should find a session by id', async () => {
      const session = { id: 'sess-1', status: 'active' }
      mockDb.query.agentSessions.findFirst.mockResolvedValue(session)

      const result = await repo.findById('sess-1')
      expect(result).toEqual(session)
    })
  })

  describe('findByOrgId', () => {
    it('should return sessions for an org with default limit 50', async () => {
      const sessions = [{ id: 's1' }, { id: 's2' }]
      mockDb.query.agentSessions.findMany.mockResolvedValue(sessions)

      const result = await repo.findByOrgId('org-1')
      expect(result).toEqual(sessions)
      expect(mockDb.query.agentSessions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      )
    })

    it('should respect custom limit', async () => {
      mockDb.query.agentSessions.findMany.mockResolvedValue([])

      await repo.findByOrgId('org-1', 10)
      expect(mockDb.query.agentSessions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      )
    })
  })

  describe('findActive', () => {
    it('should return only active sessions for an org', async () => {
      const active = [{ id: 's1', status: 'active' }]
      mockDb.query.agentSessions.findMany.mockResolvedValue(active)

      const result = await repo.findActive('org-1')
      expect(result).toEqual(active)
    })
  })

  describe('end', () => {
    it('should set status to ended and compute duration', async () => {
      const startedAt = new Date(Date.now() - 60_000) // 60 seconds ago
      const session = { id: 'sess-1', status: 'active', startedAt }
      mockDb.query.agentSessions.findFirst.mockResolvedValue(session)

      const ended = { id: 'sess-1', status: 'ended', endedAt: new Date(), durationSeconds: 60 }
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([ended]),
          }),
        }),
      })

      const result = await repo.end('sess-1')
      expect(result).toEqual(ended)
    })

    it('should return undefined when session does not exist', async () => {
      mockDb.query.agentSessions.findFirst.mockResolvedValue(undefined)

      const result = await repo.end('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should set durationSeconds to 0 when startedAt is null', async () => {
      const session = { id: 'sess-1', status: 'active', startedAt: null }
      mockDb.query.agentSessions.findFirst.mockResolvedValue(session)

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'sess-1', status: 'ended' }]),
        }),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.end('sess-1')

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ended',
          durationSeconds: 0,
          endedAt: expect.any(Date),
        }),
      )
    })
  })

  describe('updateStatus', () => {
    it('should update only the status field', async () => {
      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.updateStatus('sess-1', 'paused')
      expect(setMock).toHaveBeenCalledWith({ status: 'paused' })
    })
  })

  describe('delete', () => {
    it('should delete the session', async () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })

      await expect(repo.delete('sess-1')).resolves.toBeUndefined()
    })
  })

  describe('countByOrg', () => {
    it('should return the count of sessions for an org', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 42 }]),
        }),
      })

      const count = await repo.countByOrg('org-1')
      expect(count).toBe(42)
    })

    it('should return 0 when no rows match', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const count = await repo.countByOrg('org-1')
      expect(count).toBe(0)
    })
  })
})

// =============================================================================
// ConversationRepository
// =============================================================================

describe('ConversationRepository', () => {
  let repo: ConversationRepository

  beforeEach(() => {
    mockDb = createMockDb()
    repo = new ConversationRepository()
  })

  describe('create', () => {
    it('should insert and return the created conversation', async () => {
      const newConv = { sessionId: 'sess-1', orgId: 'org-1' }
      const created = { id: 'conv-1', ...newConv, messages: [] }

      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      })

      const result = await repo.create(newConv as any)
      expect(result).toEqual(created)
    })
  })

  describe('findById', () => {
    it('should find a conversation by id', async () => {
      const conv = { id: 'conv-1', messages: [] }
      mockDb.query.conversations.findFirst.mockResolvedValue(conv)

      const result = await repo.findById('conv-1')
      expect(result).toEqual(conv)
    })
  })

  describe('findBySessionId', () => {
    it('should return conversations for a session', async () => {
      const convs = [{ id: 'c1' }, { id: 'c2' }]
      mockDb.query.conversations.findMany.mockResolvedValue(convs)

      const result = await repo.findBySessionId('sess-1')
      expect(result).toEqual(convs)
    })
  })

  describe('findByOrgId', () => {
    it('should return conversations for an org with default limit 50', async () => {
      mockDb.query.conversations.findMany.mockResolvedValue([])

      await repo.findByOrgId('org-1')
      expect(mockDb.query.conversations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      )
    })

    it('should respect custom limit', async () => {
      mockDb.query.conversations.findMany.mockResolvedValue([])

      await repo.findByOrgId('org-1', 25)
      expect(mockDb.query.conversations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 }),
      )
    })
  })

  describe('update', () => {
    it('should update conversation fields and return result', async () => {
      const updated = { id: 'conv-1', summary: 'New summary' }

      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      })

      const result = await repo.update('conv-1', { summary: 'New summary' })
      expect(result).toEqual(updated)
    })
  })

  describe('appendMessages', () => {
    it('should merge new messages with existing ones', async () => {
      const existing = { id: 'conv-1', messages: [{ role: 'user', text: 'Hello' }] }
      mockDb.query.conversations.findFirst.mockResolvedValue(existing)

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      const newMessages = [{ role: 'assistant', text: 'Hi!' }]
      await repo.appendMessages('conv-1', newMessages)

      expect(setMock).toHaveBeenCalledWith({
        messages: [
          { role: 'user', text: 'Hello' },
          { role: 'assistant', text: 'Hi!' },
        ],
      })
    })

    it('should do nothing when conversation not found', async () => {
      mockDb.query.conversations.findFirst.mockResolvedValue(undefined)

      await repo.appendMessages('nonexistent', [{ text: 'test' }])

      // update should not have been called
      expect(mockDb.update).not.toHaveBeenCalled()
    })

    it('should handle non-array messages gracefully', async () => {
      const existing = { id: 'conv-1', messages: null }
      mockDb.query.conversations.findFirst.mockResolvedValue(existing)

      const setMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      mockDb.update.mockReturnValue({ set: setMock })

      await repo.appendMessages('conv-1', [{ text: 'first' }])

      expect(setMock).toHaveBeenCalledWith({
        messages: [{ text: 'first' }],
      })
    })
  })

  describe('delete', () => {
    it('should delete the conversation', async () => {
      mockDb.delete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })

      await expect(repo.delete('conv-1')).resolves.toBeUndefined()
    })
  })
})


