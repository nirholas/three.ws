import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../api/_lib/migrations/', import.meta.url));
const read = (name) => readFileSync(dir + name, 'utf8');

// The SHA-256 production recorded in schema_migrations when this file was applied
// (2026-11-04 06:25 UTC). apply-migrations.mjs treats any different hash as drift
// and refuses to run, which blocks every pending migration behind it, so the
// release deploy cannot apply them. An applied migration is immutable: schema
// changes roll forward in a new file.
const APPLIED_INCEPTION_SHA256 = '611eb192765d957f90f0c5027f99f2b8fcff3f9bed37330c686762ce264eebee';

describe('inception_applications migrations', () => {
	it('keeps the applied migration byte-identical to what production ran', () => {
		const hash = createHash('sha256')
			.update(read('20261103200000_inception_applications.sql'))
			.digest('hex');
		expect(hash).toBe(APPLIED_INCEPTION_SHA256);
	});

	it('adds the program and shoutout columns and per-program uniqueness in a new migration', () => {
		const sql = read('20261104210000_inception_programs_and_shoutouts.sql');
		for (const col of [
			'program',
			'shoutout_url',
			'shoutout_status',
			'shoutout_bonus_usd',
			'shoutout_note',
			'shoutout_at',
		]) {
			expect(sql).toMatch(new RegExp(`add column if not exists ${col}\\b`, 'i'));
		}
		expect(sql).toMatch(/drop index if exists inception_applications_one_open_per_user/i);
		expect(sql).toMatch(/create unique index if not exists inception_applications_one_open_per_program/i);
		expect(sql).toMatch(/create unique index if not exists inception_applications_shoutout_url_once/i);
		expect(sql).toMatch(/create index if not exists inception_applications_shoutout_queue/i);
	});

	it('defines every column the application code reads', () => {
		const code = readFileSync(
			fileURLToPath(new URL('../api/_lib/inception.js', import.meta.url)),
			'utf8',
		);
		const sql = read('20261104210000_inception_programs_and_shoutouts.sql');
		for (const col of ['program', 'shoutout_url', 'shoutout_status', 'shoutout_bonus_usd']) {
			if (code.includes(col)) expect(sql).toContain(col);
		}
	});
});
