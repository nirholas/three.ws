// Schema guard for the partner-program perk (api/_lib/inception.js).
//
// 20261103200000_inception_applications.sql was applied to production with the
// original NVIDIA-only column set. Editing an applied migration never reaches a
// database that already ran it (`create table if not exists` is a no-op there),
// and scripts/apply-migrations.mjs reports the file as drifted, which blocks the
// deploy. So the original file stays frozen at what was applied, and every
// column the handlers read or write must be reachable through the migration
// chain: the frozen CREATE plus ALTERs in later migrations.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(process.cwd(), 'api', '_lib', 'migrations');
const CREATE_FILE = '20261103200000_inception_applications.sql';

// The columns production's inception_applications table was created with.
const APPLIED_COLUMNS = [
	'id',
	'user_id',
	'company',
	'website',
	'contact_email',
	'inception_ref',
	'use_case',
	'status',
	'grant_usd',
	'reviewer_note',
	'reviewed_at',
	'created_at',
];

// Columns api/_lib/inception.js reads or writes beyond the original set.
const HANDLER_COLUMNS = [
	'program',
	'shoutout_url',
	'shoutout_status',
	'shoutout_bonus_usd',
	'shoutout_note',
	'shoutout_at',
];

const bare = (sql) => sql.replace(/--[^\n]*/g, '');

function createColumns(sql) {
	const body = bare(sql).match(/create table if not exists inception_applications\s*\(([\s\S]*?)\n\);/i);
	if (!body) throw new Error('no inception_applications CREATE TABLE found');
	return body[1]
		.split('\n')
		.map((l) => l.trim().match(/^([a-z_]+)\s+(uuid|text|numeric|timestamptz)/i))
		.filter(Boolean)
		.map((m) => m[1]);
}

function laterMigrations() {
	return readdirSync(MIG_DIR)
		.filter((f) => f.endsWith('.sql') && f > CREATE_FILE)
		.sort()
		.map((f) => bare(readFileSync(join(MIG_DIR, f), 'utf-8')));
}

function alteredColumns() {
	const cols = new Set();
	for (const sql of laterMigrations()) {
		for (const stmt of sql.split(';')) {
			if (!/alter table (if exists )?inception_applications/i.test(stmt)) continue;
			for (const m of stmt.matchAll(/add column (?:if not exists )?([a-z_]+)/gi)) cols.add(m[1]);
		}
	}
	return cols;
}

describe('inception_applications migration chain', () => {
	it('keeps the applied CREATE TABLE frozen at the columns production ran', () => {
		const sql = readFileSync(join(MIG_DIR, CREATE_FILE), 'utf-8');
		expect(createColumns(sql)).toEqual(APPLIED_COLUMNS);
	});

	it('adds every column the handlers use through a later ALTER', () => {
		const added = alteredColumns();
		for (const col of HANDLER_COLUMNS) expect(added.has(col), `${col} is never added`).toBe(true);
	});

	it('replaces the per-user open-application index with a per-program one', () => {
		const later = laterMigrations().join('\n');
		expect(later).toMatch(/drop index if exists inception_applications_one_open_per_user/i);
		expect(later).toMatch(
			/create unique index if not exists inception_applications_one_open_per_program\s+on inception_applications \(user_id, program\)/i,
		);
		expect(later).toMatch(/create unique index if not exists inception_applications_shoutout_url_once/i);
	});

	it('covers every column api/_lib/inception.js names', () => {
		const src = readFileSync(join(process.cwd(), 'api', '_lib', 'inception.js'), 'utf-8');
		const known = new Set([...APPLIED_COLUMNS, ...alteredColumns()]);
		for (const col of HANDLER_COLUMNS) {
			expect(src.includes(col), `${col} no longer used; update this guard`).toBe(true);
			expect(known.has(col)).toBe(true);
		}
	});
});
