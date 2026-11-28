import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { asAnon, asUser, closeAll, createUser, supabaseDb } from './harness.mjs';

after(closeAll);

async function insertAs(db, userId, prompt, tier = 'standard') {
	return asUser(db, userId, async (tx) => {
		const { rows } = await tx.query('insert into public.three_ws_models (prompt, tier) values ($1, $2) returning *', [prompt, tier]);
		return rows[0];
	});
}

describe('three_ws_models schema and row level security', () => {
	it('fills user_id from the signed-in user and starts the row queued', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const row = await insertAs(db, alice, 'a brass telescope on a tripod');
		assert.equal(row.user_id, alice);
		assert.equal(row.status, 'queued');
		assert.equal(row.tier, 'standard');
		assert.equal(row.attempts, 0);
	});

	it('shows each user only their own rows', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const bob = await createUser(db, randomUUID());
		await insertAs(db, alice, 'a red fox figurine');
		await insertAs(db, bob, 'a ceramic teapot');
		const seen = await asUser(db, alice, async (tx) => (await tx.query('select prompt from public.three_ws_models')).rows);
		assert.deepEqual(seen.map((r) => r.prompt), ['a red fox figurine']);
		await assert.rejects(asAnon(db, (tx) => tx.query('select * from public.three_ws_models')), /permission denied/);
	});

	it('refuses a row inserted for someone else', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const bob = await createUser(db, randomUUID());
		await assert.rejects(
			asUser(db, alice, (tx) => tx.query('insert into public.three_ws_models (user_id, prompt) values ($1, $2)', [bob, 'a lamp'])),
			/permission denied/,
		);
	});

	it('lets a user write only prompt and tier, never status or URLs', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		await assert.rejects(
			asUser(db, alice, (tx) => tx.query(`insert into public.three_ws_models (prompt, status) values ('a lamp', 'done')`)),
			/permission denied/,
		);
		const row = await insertAs(db, alice, 'a desk lamp');
		await assert.rejects(
			asUser(db, alice, (tx) => tx.query(`update public.three_ws_models set status = 'done' where id = $1`, [row.id])),
			/permission denied/,
		);
	});

	it('lets a user delete their own row but not another user’s', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const bob = await createUser(db, randomUUID());
		const mine = await insertAs(db, alice, 'a wooden chair');
		const theirs = await insertAs(db, bob, 'a stone bench');
		const deleted = await asUser(db, alice, async (tx) => {
			await tx.query('delete from public.three_ws_models where id = $1', [theirs.id]);
			await tx.query('delete from public.three_ws_models where id = $1', [mine.id]);
			return (await tx.query('select count(*)::int as n from public.three_ws_models')).rows[0].n;
		});
		assert.equal(deleted, 0);
		const { rows } = await db.query('select id from public.three_ws_models');
		assert.deepEqual(rows.map((r) => r.id), [theirs.id]);
	});

	it('rejects prompts under 3 characters and unknown tiers', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		await assert.rejects(insertAs(db, alice, '  a '), /check constraint/);
		await assert.rejects(insertAs(db, alice, 'a valid prompt', 'ultra'), /check constraint/);
	});

	it('caps unfinished models per user and frees a slot when one finishes', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const first = await insertAs(db, alice, 'model one');
		await insertAs(db, alice, 'model two');
		await insertAs(db, alice, 'model three');
		await assert.rejects(insertAs(db, alice, 'model four'), /already have 3 models generating/);
		await db.query(`update public.three_ws_models set status = 'done' where id = $1`, [first.id]);
		const fourth = await insertAs(db, alice, 'model four');
		assert.equal(fourth.status, 'queued');
	});

	it('keeps the claim and due functions away from signed-in users', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		await assert.rejects(asUser(db, alice, (tx) => tx.query('select * from public.three_ws_claim_models(1, 60)')), /permission denied/);
		await assert.rejects(asUser(db, alice, (tx) => tx.query('select public.three_ws_next_due_seconds()')), /permission denied/);
	});

	it('bumps updated_at on every write', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const row = await insertAs(db, alice, 'a paper crane');
		await db.query(`update public.three_ws_models set updated_at = now() - interval '1 hour' where id = $1`, [row.id]);
		await db.query(`update public.three_ws_models set attempts = 1 where id = $1`, [row.id]);
		const { rows } = await db.query('select extract(epoch from now() - updated_at) as age from public.three_ws_models where id = $1', [row.id]);
		assert.ok(Number(rows[0].age) < 5);
	});

	it('adds the table to the supabase_realtime publication', async () => {
		const db = await supabaseDb();
		const { rows } = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime'`);
		assert.deepEqual(rows.map((r) => r.tablename), ['three_ws_models']);
	});
});

describe('claiming rows for a sweep', () => {
	it('moves queued rows to submitting under a lease and never hands one row out twice', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const a = await insertAs(db, alice, 'first prompt');
		const b = await insertAs(db, alice, 'second prompt');
		const first = (await db.query('select * from public.three_ws_claim_models(1, 120)')).rows;
		assert.equal(first.length, 1);
		assert.equal(first[0].id, a.id);
		assert.equal(first[0].status, 'submitting');
		assert.ok(first[0].lease_until > new Date());
		const second = (await db.query('select * from public.three_ws_claim_models(5, 120)')).rows;
		assert.deepEqual(second.map((r) => r.id), [b.id]);
		const third = (await db.query('select * from public.three_ws_claim_models(5, 120)')).rows;
		assert.equal(third.length, 0);
	});

	it('waits for next_attempt_at, keeps generating rows generating, and reclaims an expired lease', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const row = await insertAs(db, alice, 'a glass vase');
		await db.query(
			`update public.three_ws_models set status = 'generating', forge_job_id = 'job-1', next_attempt_at = now() + interval '30 seconds' where id = $1`,
			[row.id],
		);
		assert.equal((await db.query('select * from public.three_ws_claim_models(5, 120)')).rows.length, 0);
		const due = Number((await db.query('select public.three_ws_next_due_seconds() as s')).rows[0].s);
		assert.ok(due > 25 && due <= 30, `expected ~30s until due, got ${due}`);

		await db.query(`update public.three_ws_models set next_attempt_at = now() - interval '1 second' where id = $1`, [row.id]);
		const claimed = (await db.query('select * from public.three_ws_claim_models(5, 120)')).rows;
		assert.equal(claimed[0].status, 'generating');
		assert.equal((await db.query('select * from public.three_ws_claim_models(5, 120)')).rows.length, 0);

		await db.query(`update public.three_ws_models set lease_until = now() - interval '1 second' where id = $1`, [row.id]);
		assert.equal((await db.query('select * from public.three_ws_claim_models(5, 120)')).rows.length, 1);
	});

	it('reports nothing due once every row is finished', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const row = await insertAs(db, alice, 'a copper kettle');
		await db.query(`update public.three_ws_models set status = 'failed' where id = $1`, [row.id]);
		assert.equal((await db.query('select public.three_ws_next_due_seconds() as s')).rows[0].s, null);
	});
});

describe('the three-ws-models bucket', () => {
	it('is private, GLB-only and capped at 50 MB', async () => {
		const db = await supabaseDb();
		const { rows } = await db.query(`select * from storage.buckets where id = 'three-ws-models'`);
		assert.equal(rows[0].public, false);
		assert.equal(Number(rows[0].file_size_limit), 50 * 1024 * 1024);
		assert.deepEqual(rows[0].allowed_mime_types, ['model/gltf-binary']);
	});

	it('lets a user read only the objects in their own folder', async () => {
		const db = await supabaseDb();
		const alice = await createUser(db, randomUUID());
		const bob = await createUser(db, randomUUID());
		await db.query(`insert into storage.objects (bucket_id, name) values ('three-ws-models', $1), ('three-ws-models', $2)`, [
			`${alice}/a.glb`,
			`${bob}/b.glb`,
		]);
		const names = await asUser(db, alice, async (tx) => (await tx.query('select name from storage.objects')).rows.map((r) => r.name));
		assert.deepEqual(names, [`${alice}/a.glb`]);
	});

	it('runs twice without error, so a re-applied migration is safe', async () => {
		const db = await supabaseDb();
		const { readFileSync } = await import('node:fs');
		const { SCHEMA_MIGRATION } = await import('./harness.mjs');
		await db.exec(readFileSync(SCHEMA_MIGRATION, 'utf8'));
		const { rows } = await db.query(`select count(*)::int as n from pg_policies where tablename = 'three_ws_models'`);
		assert.equal(rows[0].n, 3);
	});
});

describe('the schedule migration', () => {
	it('calls the Edge Function with the Vault URL and secret on insert', async () => {
		const db = await supabaseDb({ schedule: true });
		await db.query(`insert into vault.decrypted_secrets values ('three_ws_project_url', 'https://abc.supabase.co/'), ('three_ws_forge_secret', 's3cret')`);
		const alice = await createUser(db, randomUUID());
		await insertAs(db, alice, 'a bronze statue');
		const { rows } = await db.query('select * from net.calls');
		assert.equal(rows.length, 1);
		assert.equal(rows[0].url, 'https://abc.supabase.co/functions/v1/three-ws-forge');
		assert.equal(rows[0].headers['x-three-ws-forge-secret'], 's3cret');
		assert.deepEqual(rows[0].body, { source: 'database' });
	});

	it('warns and makes no call when the Vault secrets are missing, and the insert still succeeds', async () => {
		const db = await supabaseDb({ schedule: true });
		const alice = await createUser(db, randomUUID());
		const row = await insertAs(db, alice, 'a silver ring');
		assert.equal(row.status, 'queued');
		assert.equal((await db.query('select count(*)::int as n from net.calls')).rows[0].n, 0);
	});

	it('schedules a per-minute tick that calls the function only while a model is unfinished', async () => {
		const db = await supabaseDb({ schedule: true });
		await db.query(`insert into vault.decrypted_secrets values ('three_ws_project_url', 'https://abc.supabase.co'), ('three_ws_forge_secret', 's')`);
		const { rows: jobs } = await db.query(`select * from cron.job where jobname = 'three-ws-forge-sweep'`);
		assert.equal(jobs[0].schedule, '* * * * *');
		const command = jobs[0].command;

		await db.exec(command);
		assert.equal((await db.query('select count(*)::int as n from net.calls')).rows[0].n, 0, 'idle project: no call');

		const alice = await createUser(db, randomUUID());
		await insertAs(db, alice, 'an oak barrel');
		await db.exec('delete from net.calls');
		await db.exec(command);
		assert.equal((await db.query('select count(*)::int as n from net.calls')).rows[0].n, 1, 'unfinished model: one call');
	});

	it('keeps the kick function away from signed-in users', async () => {
		const db = await supabaseDb({ schedule: true });
		const alice = await createUser(db, randomUUID());
		await assert.rejects(asUser(db, alice, (tx) => tx.query('select public.three_ws_kick_sweep()')), /permission denied/);
	});
});
