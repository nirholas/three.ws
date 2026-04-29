// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Database — PostgreSQL Connection Pool
// =============================================================================

import { Pool, type PoolConfig, type PoolClient } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

let pool: Pool | null = null
let db: NodePgDatabase<typeof schema> | null = null

export interface DatabaseConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  minConnections?: number
  maxConnections?: number
  idleTimeoutMs?: number
  connectionTimeoutMs?: number
}

function buildPoolConfig(config: DatabaseConfig): PoolConfig {
  const base: PoolConfig = {
    min: config.minConnections ?? 5,
    max: config.maxConnections ?? 20,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 5_000,
  }

  if (config.connectionString) {
    return { ...base, connectionString: config.connectionString }
  }

  return {
    ...base,
    host: config.host ?? 'localhost',
    port: config.port ?? 5432,
    database: config.database ?? 'xspace',
    user: config.user ?? 'xspace',
    password: config.password ?? 'xspace',
  }
}

/** Initialize the PostgreSQL connection pool and Drizzle ORM instance. */
export function initDatabase(config: DatabaseConfig = {}): NodePgDatabase<typeof schema> {
  if (db) return db

  const resolvedConfig: DatabaseConfig = {
    connectionString: process.env.DATABASE_URL,
    ...config,
  }

  pool = new Pool(buildPoolConfig(resolvedConfig))

  pool.on('error', (err) => {
    console.error('[db] unexpected pool error', err)
  })

  db = drizzle(pool, { schema })
  return db
}

/** Get the Drizzle ORM instance. Throws if not initialized. */
export function getDatabase(): NodePgDatabase<typeof schema> {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

/** Get the raw pg Pool for health checks or advanced queries. */
export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return pool
}

/** Acquire a client from the pool (for transactions or raw queries). */
export async function getClient(): Promise<PoolClient> {
  return getPool().connect()
}

/** Check database connectivity. */
export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    const client = await getPool().connect()
    try {
      await client.query('SELECT 1')
      return { ok: true, latencyMs: Date.now() - start }
    } finally {
      client.release()
    }
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message }
  }
}

/** Close the connection pool gracefully. */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}


