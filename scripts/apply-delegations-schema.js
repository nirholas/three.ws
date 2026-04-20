#!/usr/bin/env node
// Applies specs/schema/agent_delegations.sql to the Neon dev database.
// Idempotent — safe to re-run.
// Usage: node scripts/apply-delegations-schema.js
//        node -r dotenv/config scripts/apply-delegations-schema.js

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnvFile(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return;
	}
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
		if (!m) continue;
		const [, k, v] = m;
		if (process.env[k]) continue;
		process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}

neonConfig.webSocketConstructor = ws;

const schema = readFileSync(resolve(root, 'specs/schema/agent_delegations.sql'), 'utf8');
const host = new URL(url).host;

console.log(`Applying agent_delegations schema to ${host} …`);

const pool = new Pool({ connectionString: url });
try {
	await pool.query(schema);
	console.log('✓ schema applied');

	const countResult = await pool.query('SELECT COUNT(*) AS count FROM agent_delegations');
	console.log(`  agent_delegations row count: ${countResult.rows[0].count}`);

	const indexResult = await pool.query(`
		SELECT indexname, indexdef
		FROM pg_indexes
		WHERE tablename = 'agent_delegations'
		ORDER BY indexname
	`);
	console.log(`  indexes (${indexResult.rows.length}):`);
	for (const row of indexResult.rows) {
		console.log(`    ${row.indexname}`);
	}
} catch (err) {
	console.error('✗ schema failed:', err.message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
