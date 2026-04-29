// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Database — Migration CLI
// =============================================================================

import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { Pool } from 'pg'

const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const pool = new Pool({ connectionString })

  try {
    // Ensure migrations tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // Get already-applied migrations
    const { rows: applied } = await pool.query('SELECT name FROM _migrations ORDER BY id')
    const appliedSet = new Set(applied.map((r: { name: string }) => r.name))

    // Read migration files
    const files = await readdir(MIGRATIONS_DIR)
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort()

    let ranCount = 0
    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        console.log(`  [skip] ${file} (already applied)`)
        continue
      }

      console.log(`  [run]  ${file}`)
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8')

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        ranCount++
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    }

    console.log(ranCount > 0 ? `\n  ${ranCount} migration(s) applied.` : '\n  Database is up to date.')
  } finally {
    await pool.end()
  }
}

async function seed() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const pool = new Pool({ connectionString })

  try {
    // Create a default organization for development
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, plan, settings)
       VALUES ('Default', 'default', 'free', '{}')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`
    )

    if (rows.length > 0) {
      console.log(`  Created default organization: ${rows[0].id}`)
    } else {
      console.log('  Default organization already exists.')
    }
  } finally {
    await pool.end()
  }
}

// CLI entry point
const command = process.argv[2]

switch (command) {
  case 'migrate':
    console.log('Running migrations...')
    runMigrations().catch((err) => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
    break
  case 'seed':
    console.log('Seeding database...')
    seed().catch((err) => {
      console.error('Seed failed:', err)
      process.exit(1)
    })
    break
  default:
    console.log('Usage: ts-node migrate.ts [migrate|seed]')
    process.exit(1)
}


