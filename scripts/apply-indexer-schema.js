#!/usr/bin/env node
// Applies specs/schema/indexer_state.sql to the Neon dev database.
// Idempotent — safe to re-run.
// Usage: node scripts/apply-indexer-schema.js
//        node -r dotenv/config scripts/apply-indexer-schema.js

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

const schema = readFileSync(resolve(root, 'specs/schema/indexer_state.sql'), 'utf8');
const host = new URL(url).host;

console.log(`Applying indexer_state schema to ${host} …`);

const pool = new Pool({ connectionString: url });
try {
	await pool.query(schema);
	console.log('✓ schema applied');

	const countResult = await pool.query('SELECT COUNT(*) AS count FROM indexer_state');
	console.log(`  indexer_state row count: ${countResult.rows[0].count}`);
} catch (err) {
	console.error('✗ schema failed:', err.message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
