#!/usr/bin/env node
/**
 * seed-skills.js
 * ──────────────
 * Ingest data/skills/seed.json into marketplace_skills.
 *
 * Idempotent: keyed by slug (= skill identifier). ON CONFLICT updates
 * name/description/category/tags/content/updated_at; install_count is preserved.
 *
 * Usage: node scripts/seed-skills.js
 * Required env: DATABASE_URL
 */

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dir, '..');

// Inline .env.local loader (matches scripts/backfill-erc8004.mjs).
try {
	const raw = readFileSync(resolve(REPO_ROOT, '.env.local'), 'utf8');
	for (const line of raw.split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
	}
} catch { /* no .env.local */ }

if (!process.env.DATABASE_URL) {
	console.error('Missing DATABASE_URL');
	process.exit(1);
}

const { sql } = await import('../api/_lib/db.js');

const seedPath = resolve(REPO_ROOT, 'data/skills/seed.json');
const seedRaw = await readFile(seedPath, 'utf8');
const seed = JSON.parse(seedRaw);
const skills = Array.isArray(seed?.skills) ? seed.skills : [];

if (skills.length === 0) {
	console.error('No skills found in data/skills/seed.json');
	process.exit(1);
}

console.log(`seed-skills — ${skills.length} skills from ${seedPath}\n`);

const total = skills.length;
let failures = 0;

for (let i = 0; i < total; i++) {
	const s = skills[i];
	const slug = s.identifier;
	const name = s.manifest?.name || s.identifier;
	const description = String(s.description ?? '').slice(0, 500);
	const category = String(s.category ?? 'general').trim().toLowerCase();
	const tags = Array.isArray(s.manifest?.metadata?.tags) ? s.manifest.metadata.tags : [];
	const content = s.content ?? null;

	if (!slug || !content) {
		console.error(`[${i + 1}/${total}] FAIL ${slug || '(no slug)'}: missing slug or content`);
		failures++;
		continue;
	}

	try {
		const rows = await sql`
			insert into marketplace_skills (
				author_id, name, slug, description, category, schema_json, content, tags, is_public
			) values (
				null, ${name}, ${slug}, ${description}, ${category}, null, ${content}, ${tags}, true
			)
			on conflict (slug) do update set
				name = excluded.name,
				description = excluded.description,
				category = excluded.category,
				tags = excluded.tags,
				content = excluded.content,
				updated_at = now()
			returning (xmax = 0) as inserted
		`;
		const action = rows[0]?.inserted ? 'inserted' : 'updated';
		console.log(`[${i + 1}/${total}] ${action} ${slug}`);
	} catch (err) {
		console.error(`[${i + 1}/${total}] FAIL ${slug}: ${err.message}`);
		failures++;
	}
}

console.log(`\ndone — ${total - failures}/${total} ok, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
