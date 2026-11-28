// The sweep's state machine over the real migration SQL (PGlite). three.ws is
// reached through an injected fetch here so every failure path can be driven
// on demand; test/live.test.mjs runs the same sweep against production.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { storagePathFor, sweep } from '../supabase/functions/three-ws-forge/sweep.ts';
import { asUser, createUser, pgliteStore, supabaseDb } from './harness.mjs';

/** A minimal valid binary glTF: 12-byte header + an empty JSON chunk. */
function glb() {
	const json = Buffer.from('{"asset":{"version":"2.0"}}  ');
	const out = Buffer.alloc(12 + 8 + json.length);
	out.write('glTF', 0, 'ascii');
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(out.length, 8);
	out.writeUInt32LE(json.length, 12);
	out.write('JSON', 16, 'ascii');
	json.copy(out, 20);
	return out;
}

/** Answers keyed by "METHOD path", each a list consumed in order (the last repeats). */
function forgeFetch(routes) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		const u = new URL(url);
		const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
		calls.push({ key, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
		const list = routes[key];
		if (!list) throw new Error(`unexpected request ${key}`);
		const answer = list.length > 1 ? list.shift() : list[0];
		if (answer instanceof Error) throw answer;
		if (answer.bytes) return new Response(answer.bytes, { status: answer.status ?? 200 });
		return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: answer.headers });
	};
	return { fetchImpl, calls };
}

async function setup() {
	const db = await supabaseDb();
	const user = await createUser(db, randomUUID());
	const dir = mkdtempSync(join(tmpdir(), 'three-ws-supabase-'));
	const insert = (prompt, tier = 'draft') =>
		asUser(db, user, async (tx) => (await tx.query('insert into public.three_ws_models (prompt, tier) values ($1, $2) returning *', [prompt, tier])).rows[0]);
	const read = async (id) => (await db.query('select * from public.three_ws_models where id = $1', [id])).rows[0];
	return { db, user, dir, insert, read, store: pgliteStore(db, dir) };
}

const BASE = 'https://three.test';
const run = (store, fetchImpl, extra = {}) =>
	sweep({ store, forge: { apiKey: 'tws_test', baseUrl: BASE, fetch: fetchImpl }, budgetMs: 4000, pollIntervalS: 0.05, ...extra });

describe('sweep', () => {
	it('stores a cached model straight away and lets only its owner read the object', async () => {
		const { db, user, dir, insert, read, store } = await setup();
		const row = await insert('a brass telescope');
		const { fetchImpl, calls } = forgeFetch({
			'POST /api/forge': [{ status: 200, body: { status: 'done', glb_url: `${BASE}/m/a.glb`, backend: 'trellis_selfhost' } }],
			'GET /m/a.glb': [{ bytes: glb() }],
		});
		const summary = await run(store, fetchImpl);
		assert.equal(summary.stored, 1);

		const done = await read(row.id);
		assert.equal(done.status, 'done');
		assert.equal(done.storage_path, `${user}/${row.id}.glb`);
		assert.equal(done.backend, 'trellis_selfhost');
		assert.ok(done.completed_at);
		assert.equal(done.lease_until, null);
		assert.deepEqual(readFileSync(join(dir, storagePathFor(done))), glb());

		const submit = calls[0];
		assert.equal(submit.headers.authorization, 'Bearer tws_test');
		assert.equal(submit.headers['idempotency-key'], `supabase-${row.id}`);
		assert.equal(submit.headers['x-forge-client'], 'supabase');
		assert.deepEqual(submit.body, { prompt: 'a brass telescope', tier: 'draft', path: 'image', aspect_ratio: '1:1' });

		const stranger = await createUser(db, randomUUID());
		const visible = await asUser(db, stranger, async (tx) => (await tx.query('select name from storage.objects')).rows);
		assert.equal(visible.length, 0);
		const own = await asUser(db, user, async (tx) => (await tx.query('select name from storage.objects')).rows);
		assert.deepEqual(own.map((r) => r.name), [done.storage_path]);
	});

	it('submits, polls until the job finishes, then stores the GLB', async () => {
		const { insert, read, store } = await setup();
		const row = await insert('a ceramic teapot');
		const { fetchImpl, calls } = forgeFetch({
			'POST /api/forge': [{ status: 202, body: { job_id: 'f1.job', status: 'queued' } }],
			'GET /api/forge?job=f1.job': [
				{ body: { job_id: 'f1.job', status: 'running' } },
				{ body: { status: 'done', glb_url: '/m/t.glb', preview_image_url: 'https://three.test/p.png' } },
			],
			'GET /m/t.glb': [{ bytes: glb() }],
		});
		const summary = await run(store, fetchImpl);
		const done = await read(row.id);
		assert.equal(done.status, 'done', JSON.stringify(done));
		assert.equal(done.forge_job_id, 'f1.job');
		assert.equal(done.source_glb_url, '/m/t.glb');
		assert.equal(done.preview_image_url, 'https://three.test/p.png');
		assert.equal(summary.submitted, 1);
		assert.equal(summary.polled, 2);
		assert.deepEqual(calls.map((c) => c.key), ['POST /api/forge', 'GET /api/forge?job=f1.job', 'GET /api/forge?job=f1.job', 'GET /m/t.glb']);
	});

	it('puts a busy-lane refusal back in the queue with the wait three.ws asked for', async () => {
		const { insert, read, store } = await setup();
		const row = await insert('a wooden chair');
		const { fetchImpl } = forgeFetch({ 'POST /api/forge': [{ status: 503, body: { error: 'provider_busy', message: 'Busy.', retry_after: 30 } }] });
		const before = Date.now();
		await run(store, fetchImpl, { budgetMs: 1500 });
		const after = await read(row.id);
		assert.equal(after.status, 'queued');
		assert.equal(after.attempts, 1);
		assert.equal(after.error_code, 'provider_busy');
		assert.equal(after.lease_until, null);
		const waitS = (after.next_attempt_at.getTime() - before) / 1000;
		assert.ok(waitS >= 29 && waitS <= 32, `waits ~30s, got ${waitS}`);
	});

	it('fails a row on a rejected key and explains where to get one', async () => {
		const { insert, read, store } = await setup();
		const row = await insert('a stone bench');
		const { fetchImpl } = forgeFetch({ 'POST /api/forge': [{ status: 401, body: { error: 'sign_in_required' } }] });
		await run(store, fetchImpl);
		const after = await read(row.id);
		assert.equal(after.status, 'failed');
		assert.equal(after.error_code, 'sign_in_required');
		assert.match(after.error, /dashboard\/api-keys/);
		assert.ok(after.completed_at);
	});

	it('gives up after the attempt limit', async () => {
		const { db, insert, read, store } = await setup();
		const row = await insert('a glass vase');
		await db.query('update public.three_ws_models set attempts = 11 where id = $1', [row.id]);
		const { fetchImpl } = forgeFetch({ 'POST /api/forge': [new TypeError('fetch failed')] });
		await run(store, fetchImpl);
		const after = await read(row.id);
		assert.equal(after.status, 'failed');
		assert.equal(after.error_code, 'network');
		assert.match(after.error, /Gave up after 12 attempts/);
	});

	it('fails a row whose job three.ws reports as failed', async () => {
		const { db, insert, read, store } = await setup();
		const row = await insert('a paper crane');
		await db.query(`update public.three_ws_models set status = 'generating', forge_job_id = 'f1.bad' where id = $1`, [row.id]);
		const { fetchImpl } = forgeFetch({ 'GET /api/forge?job=f1.bad': [{ body: { status: 'failed', error: 'No lane could read this prompt.' } }] });
		await run(store, fetchImpl);
		const after = await read(row.id);
		assert.equal(after.status, 'failed');
		assert.equal(after.error, 'No lane could read this prompt.');
	});

	it('refuses to store a file that is not a GLB', async () => {
		const { insert, read, store } = await setup();
		const row = await insert('a copper kettle');
		const { fetchImpl } = forgeFetch({
			'POST /api/forge': [{ body: { status: 'done', glb_url: `${BASE}/m/k.glb` } }],
			'GET /m/k.glb': [{ bytes: Buffer.from('<html>not a model</html>') }],
		});
		await run(store, fetchImpl);
		const after = await read(row.id);
		assert.equal(after.status, 'failed');
		assert.equal(after.error_code, 'invalid_glb');
	});

	it('finishes a row a crashed sweep left in storing, without asking three.ws again', async () => {
		const { db, insert, read, store } = await setup();
		const row = await insert('an oak barrel');
		await db.query(
			`update public.three_ws_models set status = 'storing', forge_job_id = 'f1.x', source_glb_url = $2, lease_until = now() - interval '1 second' where id = $1`,
			[row.id, `${BASE}/m/o.glb`],
		);
		const { fetchImpl, calls } = forgeFetch({ 'GET /m/o.glb': [{ bytes: glb() }] });
		await run(store, fetchImpl);
		assert.equal((await read(row.id)).status, 'done');
		assert.deepEqual(calls.map((c) => c.key), ['GET /m/o.glb']);
	});

	it('releases a row when the Storage upload fails, keeping it in storing for the next sweep', async () => {
		const { insert, read, store } = await setup();
		const row = await insert('a silver ring');
		const failing = { ...store, upload: async () => { throw new Error('Storage answered 500'); } };
		const { fetchImpl } = forgeFetch({
			'POST /api/forge': [{ body: { status: 'done', glb_url: `${BASE}/m/r.glb` } }],
			'GET /m/r.glb': [{ bytes: glb() }],
		});
		await run(failing, fetchImpl, { budgetMs: 1000 });
		const after = await read(row.id);
		assert.equal(after.status, 'storing');
		assert.equal(after.error_code, 'sweep_error');
		assert.match(after.error, /Storage answered 500/);
		assert.equal(after.lease_until, null);
		assert.ok(after.next_attempt_at > new Date());
	});

	it('fails a row that has been unfinished longer than the age limit', async () => {
		const { db, insert, read, store } = await setup();
		const row = await insert('a bronze statue');
		await db.query(`update public.three_ws_models set created_at = now() - interval '2 hours' where id = $1`, [row.id]);
		const { fetchImpl } = forgeFetch({});
		await run(store, fetchImpl);
		const after = await read(row.id);
		assert.equal(after.status, 'failed');
		assert.equal(after.error_code, 'timeout');
	});

	it('returns at once when nothing is waiting', async () => {
		const { store } = await setup();
		const started = Date.now();
		const summary = await run(store, forgeFetch({}).fetchImpl, { budgetMs: 30_000 });
		assert.equal(summary.claimed, 0);
		assert.ok(Date.now() - started < 2000);
	});
});
