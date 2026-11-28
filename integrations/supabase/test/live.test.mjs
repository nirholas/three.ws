// Live end to end: a signed-in user inserts a row, the real sweep submits it
// to production three.ws Forge, polls the real job, downloads the real GLB and
// stores it, then the owner reads it back through the bucket policy.
//
//   THREE_WS_API_KEY=tws_... npm run test:live
//
// Spends one draft generation on the key's account.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import { sweep } from '../supabase/functions/three-ws-forge/sweep.ts';
import { asUser, closeAll, createUser, pgliteStore, supabaseDb } from './harness.mjs';

after(closeAll);

const apiKey = process.env.THREE_WS_API_KEY?.trim();
const baseUrl = process.env.THREE_WS_BASE_URL?.trim() || 'https://three.ws';

it('turns an inserted prompt into a stored GLB through production three.ws', { timeout: 15 * 60_000 }, async () => {
	assert.ok(apiKey, 'Set THREE_WS_API_KEY to a three.ws API key (three.ws/dashboard/api-keys) to run the live test.');

	const db = await supabaseDb();
	const user = await createUser(db, randomUUID());
	const dir = mkdtempSync(join(tmpdir(), 'three-ws-supabase-live-'));
	const prompt = `a small hand-carved wooden owl figurine, ${new Date().toISOString().slice(0, 10)}`;
	const row = await asUser(db, user, async (tx) =>
		(await tx.query(`insert into public.three_ws_models (prompt, tier) values ($1, 'draft') returning *`, [prompt])).rows[0],
	);

	const events = [];
	const deadline = Date.now() + 12 * 60_000;
	let final;
	while (Date.now() < deadline) {
		// Back to back sweeps, as the per-minute cron would run them.
		const summary = await sweep({
			store: pgliteStore(db, dir),
			forge: { apiKey, baseUrl, client: 'supabase-live-test' },
			budgetMs: 50_000,
			log: (e) => {
				events.push(e);
				console.log(JSON.stringify(e));
			},
		});
		console.log(JSON.stringify({ summary }));
		final = (await db.query('select * from public.three_ws_models where id = $1', [row.id])).rows[0];
		if (final.status === 'done' || final.status === 'failed') break;
	}

	assert.equal(final.status, 'done', `row ended ${final.status}: ${final.error_code} ${final.error}`);
	assert.equal(final.storage_path, `${user}/${row.id}.glb`);
	assert.match(final.source_glb_url, /\.glb/);
	assert.ok(final.submitted_at, 'records when three.ws accepted the job');
	const bytes = readFileSync(join(dir, final.storage_path));
	assert.equal(bytes.subarray(0, 4).toString('ascii'), 'glTF');
	assert.ok(bytes.byteLength > 10_000, `a real model, got ${bytes.byteLength} bytes`);
	console.log(JSON.stringify({ stored: final.storage_path, bytes: bytes.byteLength, backend: final.backend, job: final.forge_job_id, glb: final.source_glb_url }));

	const visible = await asUser(db, user, async (tx) => (await tx.query('select name from storage.objects')).rows.map((r) => r.name));
	assert.deepEqual(visible, [final.storage_path]);
});
