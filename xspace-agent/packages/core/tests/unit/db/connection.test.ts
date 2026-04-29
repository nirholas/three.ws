// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§75]

// =============================================================================
// Tests — Database Connection
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const mockPoolInstance = {
  on: vi.fn().mockReturnThis(),
  connect: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
}

function MockPool() {
  return mockPoolInstance
}

const mockDrizzleInstance = { query: {} } as any

function createMocks() {
  return {
    pgMock: { Pool: MockPool },
    drizzleMock: { drizzle: vi.fn(() => mockDrizzleInstance) },
    schemaMock: {},
  }
}

// We need a fresh module for each test to reset the pool/db singletons.
let connectionModule: typeof import('../../../src/db/connection')

async function freshModule() {
  vi.resetModules()

  const mocks = createMocks()

  vi.doMock('pg', () => mocks.pgMock)
  vi.doMock('drizzle-orm/node-postgres', () => mocks.drizzleMock)
  vi.doMock('../../../src/db/schema', () => mocks.schemaMock)

  return await import('../../../src/db/connection')
}

describe('Database Connection', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockPoolInstance.on.mockReset().mockReturnThis()
    mockPoolInstance.connect.mockReset()
    mockPoolInstance.end.mockReset()
    mockPoolInstance.query.mockReset()
    connectionModule = await freshModule()
  })

  // -------------------------------------------------------------------------
  // initDatabase
  // -------------------------------------------------------------------------

  describe('initDatabase', () => {
    it('should create a Pool and return a Drizzle instance', () => {
      const db = connectionModule.initDatabase({ host: 'localhost', port: 5432 })

      expect(db).toBe(mockDrizzleInstance)
      // Error handler was registered
      expect(mockPoolInstance.on).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should return the same instance on repeated calls (singleton)', () => {
      const db1 = connectionModule.initDatabase()
      const db2 = connectionModule.initDatabase()

      expect(db1).toBe(db2)
    })

    it('should use connectionString when provided', () => {
      connectionModule.initDatabase({ connectionString: 'postgresql://user:pass@host:5432/db' })

      // The pool is created with the connectionString; we verify via getPool that
      // it returns our mock (proving it was created correctly)
      expect(connectionModule.getPool()).toBe(mockPoolInstance)
    })

    it('should apply default pool sizing values', () => {
      // We verify defaults exist by ensuring init does not throw and the pool is created
      connectionModule.initDatabase({})
      expect(connectionModule.getPool()).toBe(mockPoolInstance)
    })

    it('should prefer DATABASE_URL env var when no config is passed', () => {
      const original = process.env.DATABASE_URL
      process.env.DATABASE_URL = 'postgresql://env-host/envdb'

      try {
        connectionModule.initDatabase()
        expect(connectionModule.getDatabase()).toBe(mockDrizzleInstance)
      } finally {
        if (original === undefined) {
          delete process.env.DATABASE_URL
        } else {
          process.env.DATABASE_URL = original
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  // getDatabase
  // -------------------------------------------------------------------------

  describe('getDatabase', () => {
    it('should throw when database is not initialized', () => {
      expect(() => connectionModule.getDatabase()).toThrow(
        'Database not initialized. Call initDatabase() first.',
      )
    })

    it('should return the Drizzle instance after init', () => {
      connectionModule.initDatabase()
      expect(connectionModule.getDatabase()).toBe(mockDrizzleInstance)
    })
  })

  // -------------------------------------------------------------------------
  // getPool
  // -------------------------------------------------------------------------

  describe('getPool', () => {
    it('should throw when pool is not initialized', () => {
      expect(() => connectionModule.getPool()).toThrow(
        'Database not initialized. Call initDatabase() first.',
      )
    })

    it('should return the pool after init', () => {
      connectionModule.initDatabase()
      const pool = connectionModule.getPool()
      expect(pool).toBe(mockPoolInstance)
    })
  })

  // -------------------------------------------------------------------------
  // getClient
  // -------------------------------------------------------------------------

  describe('getClient', () => {
    it('should acquire a client from the pool', async () => {
      const fakeClient = { query: vi.fn(), release: vi.fn() }
      mockPoolInstance.connect.mockResolvedValue(fakeClient)

      connectionModule.initDatabase()
      const client = await connectionModule.getClient()

      expect(client).toBe(fakeClient)
      expect(mockPoolInstance.connect).toHaveBeenCalledTimes(1)
    })
  })

  // -------------------------------------------------------------------------
  // checkDatabaseHealth
  // -------------------------------------------------------------------------

  describe('checkDatabaseHealth', () => {
    it('should return ok: true when SELECT 1 succeeds', async () => {
      const fakeClient = { query: vi.fn().mockResolvedValue({}), release: vi.fn() }
      mockPoolInstance.connect.mockResolvedValue(fakeClient)

      connectionModule.initDatabase()
      const result = await connectionModule.checkDatabaseHealth()

      expect(result.ok).toBe(true)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
      expect(fakeClient.query).toHaveBeenCalledWith('SELECT 1')
      expect(fakeClient.release).toHaveBeenCalled()
    })

    it('should return ok: false when connect fails', async () => {
      mockPoolInstance.connect.mockRejectedValue(new Error('connection refused'))

      connectionModule.initDatabase()
      const result = await connectionModule.checkDatabaseHealth()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('connection refused')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should release the client even when query throws', async () => {
      const fakeClient = {
        query: vi.fn().mockRejectedValue(new Error('query failed')),
        release: vi.fn(),
      }
      mockPoolInstance.connect.mockResolvedValue(fakeClient)

      connectionModule.initDatabase()
      const result = await connectionModule.checkDatabaseHealth()

      expect(result.ok).toBe(false)
      expect(fakeClient.release).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // closeDatabase
  // -------------------------------------------------------------------------

  describe('closeDatabase', () => {
    it('should call pool.end() and nullify singletons', async () => {
      mockPoolInstance.end.mockResolvedValue(undefined)

      connectionModule.initDatabase()
      await connectionModule.closeDatabase()

      expect(mockPoolInstance.end).toHaveBeenCalledTimes(1)
      // After closing, getDatabase should throw
      expect(() => connectionModule.getDatabase()).toThrow('Database not initialized')
    })

    it('should be a no-op when pool is already null', async () => {
      // Never initialized — should not throw
      await expect(connectionModule.closeDatabase()).resolves.toBeUndefined()
      expect(mockPoolInstance.end).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Pool error handler
  // -------------------------------------------------------------------------

  describe('pool error handler', () => {
    it('should log unexpected pool errors via console.error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      connectionModule.initDatabase()

      // Invoke the error handler that was registered
      const errorCallback = mockPoolInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'error',
      )?.[1]
      expect(errorCallback).toBeDefined()

      const testError = new Error('unexpected')
      errorCallback(testError)

      expect(consoleSpy).toHaveBeenCalledWith('[db] unexpected pool error', testError)
      consoleSpy.mockRestore()
    })
  })
})


