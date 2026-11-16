/**
 * Storing a describe result for a creation that was deleted after it was
 * leased. Seen on 2026-11-16: importing the GPU batch job's run3/c01 output
 * (4,045 results, 4,040 ok) aborted on its first deleted creation with
 * "violates foreign key constraint forge_creation_descriptions_creation_id_fkey",
 * so none of the good results were stored. A deleted creation must be skipped,
 * not crash the import or the cron lane.
 *
 * Runs the real migration on an in-process Postgres (PGlite).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const migration = readFileSync(
	new URL('../api/_lib/migrations/20261111161856_forge_creation_descriptions.sql', import.meta.url),
	'utf8',
);

const LIVE = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

const result = {
	caption: 'A brass lantern on a wooden table.',
	detailed: 'A brass lantern with a glass chimney sits on a wooden table.',
	tags: ['lantern', 'table'],
	objects: [],
	model: 'microsoft/Florence-2-large',
	model_version: 'test-rev',
	latency_ms: 1500,
};

let lib;

beforeAll(async () => {
	lib = await import('../api/_lib/creation-descriptions.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql({ pg: new PGlite({ extensions: { pg_trgm } }) });
	await holder.db.exec(`create extension if not exists pg_trgm; create table forge_creations (id uuid primary key, status text not null default 'done', glb_url text, created_at timestamptz not null default now()); insert into forge_creations values ('${LIVE}');`);
	await holder.db.exec(migration);
});

async function rows() {
	return holder.db.sql`select creation_id, status, caption, error from forge_creation_descriptions order by creation_id`;
}

describe('storeDescription', () => {
	it('stores a result for a live creation', async () => {
		await expect(lib.storeDescription({ creationId: LIVE, result })).resolves.toBe(true);
		const r = await rows();
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ creation_id: LIVE, status: 'done', caption: result.caption });
	});

	it('skips a creation deleted since it was leased instead of throwing', async () => {
		await expect(lib.storeDescription({ creationId: GONE, result })).resolves.toBe(false);
		expect(await rows()).toHaveLength(0);
	});
});

describe('markDescribeFailed', () => {
	it('skips a deleted creation instead of throwing', async () => {
		await expect(lib.markDescribeFailed({ creationId: GONE, error: 'HTTP 404' })).resolves.toBeUndefined();
		expect(await rows()).toHaveLength(0);
	});

	it('queues a live creation for retry', async () => {
		await lib.markDescribeFailed({ creationId: LIVE, error: 'HTTP 429' });
		expect((await rows())[0]).toMatchObject({ status: 'queued', error: 'HTTP 429' });
	});
});
