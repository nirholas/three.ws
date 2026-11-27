// The Forge operator reports (`npm run forge:errors`, `npm run forge:funnel`,
// GET /api/ops/forge-funnel) run their real SQL here against an in-process
// Postgres (PGlite) holding a fixed set of forge_creations rows. The rows mix
// in every kind that has historically skewed a count: platform-internal rows,
// catalog-seeder rows, attempts that failed over to another lane, in-flight
// jobs, a row from the previous window and one from before it.
//
// The point is agreement. Before 2026-11-27 the error report counted internal
// and seeder rows while the funnel left them out, so the same week read 93.9%
// in one and 93.0% in the other. Both now answer from one definition.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createPgliteSql } from './_helpers/pglite-sql.js';

// Dates must bucket by UTC no matter where the operator runs the report.
process.env.TZ = 'America/Los_Angeles';
process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const SCHEMA = `
	create table forge_creations (
		id uuid primary key,
		user_id uuid,
		client_key text not null default 'k1',
		prompt text not null default '',
		backend text,
		path text,
		status text not null default 'generating',
		error text,
		outcome text not null default 'generated',
		rating smallint,
		downloaded boolean not null default false,
		destination text,
		source text,
		internal boolean not null default false,
		superseded_by uuid,
		x402_tx_sig text,
		x402_payer text,
		x402_price_atomic bigint,
		created_at timestamptz not null default now(),
		completed_at timestamptz
	);
	create table forge_seed_jobs (id serial primary key, creation_id uuid);
	create table share_funnel_daily (day date not null, surface text not null, kind text not null, count bigint not null default 0);
`;

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** Insert one row. `age` is a Postgres interval before now(). */
async function row(db, { age = '1 hour', created = null, status, backend = 'trellis_selfhost', path = 'text', error = null, internal = false, superseded_by = null, downloaded = false, prompt = 'a red fox', id = uuid() }) {
	await db.query(
		`insert into forge_creations (id, status, backend, path, error, internal, superseded_by, downloaded, prompt, created_at, completed_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now() - $11::interval),
		         case when $2 in ('done', 'failed') then coalesce($10::timestamptz, now() - $11::interval) + interval '2 minutes' end)`,
		[id, status, backend, path, error, internal, superseded_by, downloaded, prompt, created, age],
	);
	return id;
}

let reportLib;
let funnelLib;
let yesterdayUtc;

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(SCHEMA);
	const db = holder.db;

	// Current window, user requests.
	const successor = await row(db, { status: 'done', downloaded: true });
	for (let i = 0; i < 4; i++) await row(db, { status: 'done' });
	await row(db, { status: 'failed', error: 'NVCF request not found or expired', superseded_by: successor });
	await row(db, { status: 'failed', error: 'image source tmpfiles.org is not a decodable image (UnidentifiedImageError)', prompt: 'my secret prompt' });
	await row(db, { status: 'failed', error: 'input image unusable: image host answered HTTP 403 for https://cdn.example.com/u/alice@example.com/me.png' });
	await row(db, { status: 'failed', backend: 'triposg', path: 'sketch', error: 'generation timed out after 41 minutes' });
	await row(db, { status: 'generating' });
	// 23:30 UTC yesterday: a local-time bucketer (UTC-8 here) would file it two days back.
	const [{ y }] = await db.query(`select (date_trunc('day', now() at time zone 'utc') - interval '30 minutes') at time zone 'utc' as y`);
	yesterdayUtc = new Date(y).toISOString().slice(0, 10);
	await row(db, { created: new Date(y).toISOString(), status: 'failed', error: 'generation timed out after 63 minutes' });
	await row(db, { age: '26 hours', status: 'done' });

	// Platform rows, excluded from request-level numbers in both reports.
	for (let i = 0; i < 3; i++) await row(db, { status: 'done', internal: true });
	await row(db, { status: 'failed', internal: true, error: 'benchmark lane down' });
	for (let i = 0; i < 2; i++) {
		const id = await row(db, { status: 'done' });
		await db.query('insert into forge_seed_jobs (creation_id) values ($1)', [id]);
	}

	// Previous window (7 to 14 days back) and before it.
	for (let i = 0; i < 4; i++) await row(db, { age: '9 days', status: 'failed', error: 'generation timed out after 50 minutes' });
	for (let i = 0; i < 2; i++) await row(db, { age: '9 days', status: 'done' });
	for (let i = 0; i < 10; i++) await row(db, { age: '20 days', status: 'failed', error: 'old failure' });

	reportLib = await import('../api/_lib/forge-operator-report.js');
	funnelLib = await import('../api/_lib/forge-funnel.js');
});

describe('one definition of success and failure across both reports', () => {
	it('the error report and the funnel count the same requests the same way', async () => {
		const errors = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		const funnel = await funnelLib.gatherForgeFunnel({ days: 7 });
		expect(funnel.ok).toBe(true);
		expect(errors.done).toBe(funnel.output.done);
		expect(errors.failed).toBe(funnel.output.failed);
		expect(errors.in_flight).toBe(funnel.output.in_flight);
		expect(errors.success_rate.value).toBe(funnel.output.generation_success_rate.value);
		// 5 + the 26-hour row done; 4 lost (tmpfiles, 403 host, triposg timeout,
		// yesterday's timeout); the failed-over attempt and every platform row out.
		expect(errors.done).toBe(6);
		expect(errors.failed).toBe(4);
		expect(errors.recovered).toBe(1);
		expect(errors.in_flight).toBe(1);
	});
});
