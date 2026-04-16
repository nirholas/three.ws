#!/usr/bin/env node
// One-shot schema applier. Idempotent — safe to re-run.
// Usage: node scripts/apply-schema.mjs  (reads DATABASE_URL from .env.local → .env → environment)

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnvFile(path) {
	let raw;
	try { raw = readFileSync(path, 'utf8'); } catch { return; }
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

const schema = readFileSync(resolve(root, 'api/_lib/schema.sql'), 'utf8');
const host = new URL(url).host;

console.log(`Applying schema to ${host} …`);

const pool = new Pool({ connectionString: url });
try {
	await pool.query(schema);
	console.log('✓ schema applied');
} catch (err) {
	console.error('✗ schema failed:', err.message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
