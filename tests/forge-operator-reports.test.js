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

describe('the error report adds up', () => {
	it('buckets every lost request by UTC day, lane and step, and each breakdown sums to the total', async () => {
		const r = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		const sum = (xs) => xs.reduce((a, x) => a + x.n, 0);
		expect(sum(r.by_day)).toBe(r.failed);
		expect(sum(r.by_lane)).toBe(r.failed);
		expect(sum(r.by_step)).toBe(r.failed);
		expect(r.causes.reduce((a, c) => a + c.count, 0)).toBe(r.failed);
		// The machine runs at UTC-8; the 23:30 UTC row still lands on its UTC day.
		expect(r.by_day.find((d) => d.day === yesterdayUtc)?.n).toBe(1);
		expect(r.by_lane).toEqual([{ lane: 'trellis_selfhost', n: 3 }, { lane: 'triposg', n: 1 }]);
		expect(r.by_step).toEqual([{ step: 'text', n: 3 }, { step: 'sketch', n: 1 }]);
	});

	it('never counts an in-flight job as a failure', async () => {
		const r = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		expect(r.in_flight).toBe(1);
		expect(r.requests).toBe(r.done + r.failed + r.in_flight);
		expect(r.success_rate).toEqual({ value: 0.6, n: 6, of: 10 });
	});

	it('leads with the top causes and their change against the previous window', async () => {
		const r = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		expect(r.previous).toMatchObject({ done: 2, failed: 4, requests: 6 });
		expect(r.top_problems.map((c) => [c.id, c.count, c.previous, c.change])).toEqual([
			['bad_input_image', 2, 0, 'new'],
			['timeout', 2, 4, '-2'],
		]);
		expect(r.top_problems[1].lanes).toEqual([{ lane: 'trellis_selfhost', n: 1 }, { lane: 'triposg', n: 1 }]);
		const text = reportLib.formatErrorReport(r, { database: 'postgres://user:pw@db.example.net/neondb' });
		expect(text.indexOf('How this counts')).toBeLessThan(text.indexOf('Top problems'));
		expect(text).toContain('Not in these numbers');
		expect(text).toMatch(/1\. bad_input_image: 2 .*previously 0 \(new\)/);
		expect(text).toContain('db.example.net');
		expect(text).not.toContain('user:pw');
	});

	it('ranks failed-over attempts only when asked, and keeps them out of the totals either way', async () => {
		const r = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7, includeRecovered: true }));
		expect(r.failed).toBe(4);
		expect(r.ranked_failures).toBe(5);
		expect(r.causes.find((c) => c.id === 'lost_task')?.count).toBe(1);
	});

	it('counts platform rows only under --include-internal, and says how many it left out', async () => {
		const out = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		expect(out.platform_rows).toBe(6);
		const all = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7, includeInternal: true }));
		expect(all.done).toBe(11);
		expect(all.failed).toBe(5);
	});
});

describe('the funnel agrees with the error report and the lane table', () => {
	it('splits each lane into attempts and lost requests, and the lost requests sum to the failures', async () => {
		const funnel = await funnelLib.gatherForgeFunnel({ days: 7 });
		const errors = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		const lane = Object.fromEntries(funnel.lanes.map((l) => [l.backend, l]));
		expect(lane.trellis_selfhost).toMatchObject({ attempts: 10, done: 6, failed: 4, lost: 3 });
		expect(lane.triposg).toMatchObject({ attempts: 1, failed: 1, lost: 1 });
		expect(funnel.lanes.reduce((a, l) => a + l.lost, 0)).toBe(errors.failed);
	});

	it('states its definitions and its blind spot, and compares against the previous window', async () => {
		const funnel = await funnelLib.gatherForgeFunnel({ days: 7 });
		expect(funnel.definitions).toBe(reportLib.OUTCOME_DEFINITIONS);
		expect(funnel.coverage.pre_job_failures).toBe('not_recorded');
		expect(funnel.previous.output).toMatchObject({ done: 2, failed: 4 });
		expect(funnel.top_problems[0]).toMatchObject({ key: 'lane:trellis_selfhost', affected: 3, previous: 4, change: '-1' });
		const text = reportLib.formatFunnelReport(funnel);
		expect(text.split('\n').slice(0, 6).join('\n')).toContain('NOT IN THESE NUMBERS');
		expect(text).toContain('1. trellis_selfhost lost 3 request(s)');
	});

	it('reports an unreachable database as unreachable, not as a week of zeros', async () => {
		const real = holder.db;
		holder.db = { sql: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')) };
		try {
			const funnel = await funnelLib.gatherForgeFunnel({ days: 7 });
			expect(funnel.ok).toBe(false);
			expect(funnel.unreachable).toBe(true);
		} finally {
			holder.db = real;
		}
		const partial = await funnelLib.gatherForgeFunnel({ days: 7 });
		expect(partial.unreachable).toBe(false);
	});
});

describe('privacy by default', () => {
	it('prints no prompt, email, address or full URL unless revealed', async () => {
		const hidden = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7 }));
		const blob = JSON.stringify(hidden) + reportLib.formatErrorReport(hidden) + reportLib.formatErrorClass(hidden, 'bad_input_image');
		expect(blob).not.toContain('my secret prompt');
		expect(blob).not.toContain('alice@example.com');
		expect(blob).not.toContain('/u/');
		expect(blob).toContain('https://cdn.example.com/...');

		const shown = reportLib.summarizeForgeErrors(await reportLib.gatherForgeErrors({ days: 7, reveal: true }));
		const detail = reportLib.formatErrorClass(shown, 'bad_input_image');
		expect(detail).toContain('my secret prompt');
		expect(detail).toContain('alice@example.com');
	});

	it('masks emails, wallet addresses and IPs in free text', () => {
		const out = reportLib.redactOperatorText(
			'payer FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump and 0x1111111111111111111111111111111111111111 from 10.1.2.3 mailed bob@x.io',
		);
		expect(out).toBe('payer <address> and <address> from <ip> mailed <email>');
	});
});

describe('requests refused before a job existed', () => {
	it('buckets the request log by outcome and drops polls, rigging and other routes', () => {
		const lines = [
			'200\thttps://three.ws/api/forge',
			'200\thttps://three.ws/api/gpt-forge',
			'401\thttps://three.ws/api/forge',
			'429\thttps://three.ws/api/forge?x=1',
			'422\thttps://three.ws/api/forge',
			'503\thttps://three.ws/api/forge',
			'503\thttps://three.ws/api/forge',
			'200\thttps://three.ws/api/forge?action=rig',
			'500\thttps://three.ws/api/forge-off/event',
			'',
		].join('\n');
		const s = reportLib.summarizeRequestLog(reportLib.parseRequestLogLines(lines));
		expect(s.total).toBe(7);
		expect(s.accepted).toBe(2);
		expect(s.refused).toBe(5);
		expect(Object.fromEntries(s.buckets.map((b) => [b.id, b.count]))).toEqual({ accepted: 2, sign_in: 1, throttled: 1, input: 1, server: 2 });
		const top = reportLib.funnelTopProblems([{ backend: 'trellis_selfhost', lost: 1 }], [], s);
		expect(top[0]).toMatchObject({ key: 'request:server', affected: 2 });
	});
});

describe('missing access', () => {
	it('names the variable and the one command that provides it', () => {
		const m = reportLib.missingDatabaseMessage('npm run forge:errors');
		expect(m).toContain('DATABASE_URL');
		expect(m).toContain(reportLib.DATABASE_URL_COMMAND);
		expect(m).not.toMatch(/grep -A1/);
	});

	it('names the unreachable host without its credentials', () => {
		const m = reportLib.unreachableDatabaseMessage(new Error('fetch failed\n    at x'), 'postgresql://u:secretpw@ep-x.neon.tech/db');
		expect(m).toContain('ep-x.neon.tech: fetch failed');
		expect(m).not.toContain('secretpw');
		expect(m).not.toContain('at x');
	});
});

// The CLIs end to end, as an operator runs them. Skipped only when a repo env
// file supplies DATABASE_URL, because the scripts load those files first.
const repoEnvHasDb = ['.env', '.env.local'].some((f) => existsSync(f) && /^DATABASE_URL=\S/m.test(readFileSync(f, 'utf8')));

describe.skipIf(repoEnvHasDb)('the CLIs without database access', () => {
	const run = (script, extraEnv) => {
		const env = { ...process.env, ...extraEnv };
		if (extraEnv.DATABASE_URL === undefined) delete env.DATABASE_URL;
		return spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 30_000 });
	};

	for (const script of ['scripts/forge-error-report.mjs', 'scripts/forge-funnel-report.mjs']) {
		it(`${script}: a missing DATABASE_URL names the variable and the command, exit 2, no stack trace`, () => {
			const r = run(script, { DATABASE_URL: undefined });
			expect(r.status).toBe(2);
			expect(r.stderr).toContain('DATABASE_URL');
			expect(r.stderr).toContain("node scripts/read-service-env.mjs '^DATABASE_URL$' --raw");
			expect(r.stderr).not.toMatch(/\n\s+at /);
			expect(r.stdout).toBe('');
		});

		it(`${script}: an unreachable database prints no report, exit 3`, () => {
			const r = run(script, { DATABASE_URL: 'postgresql://u:pw@127.0.0.1:1/db' });
			expect(r.status).toBe(3);
			expect(r.stderr).toContain('Could not read the database at 127.0.0.1');
			expect(r.stderr).not.toContain(':pw@');
			expect(r.stderr).not.toMatch(/\n\s+at /);
			expect(r.stdout).not.toMatch(/requests 0/);
		});
	}
});
