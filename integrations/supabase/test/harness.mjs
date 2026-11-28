// Test harness: the integration's real migrations on an in-process Postgres
// (PGlite, Postgres 18) shaped like a Supabase database.
//
// The prelude creates only what a fresh Supabase project already has and the
// migrations rely on: the anon/authenticated/service_role roles, auth.users
// and auth.uid() (same definition as Supabase), storage.buckets and
// storage.objects with storage.foldername(), and the supabase_realtime
// publication. pg_net, pg_cron and Vault do not exist in PGlite, so the
// schedule migration runs against recording stand-ins (see scheduleStandIns).

import { PGlite } from '@electric-sql/pglite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = join(here, '..', 'supabase', 'migrations');
export const SCHEMA_MIGRATION = join(MIGRATIONS, '20261128000000_three_ws_models.sql');
export const SCHEDULE_MIGRATION = join(MIGRATIONS, '20261128000100_three_ws_models_schedule.sql');

const PRELUDE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
	select coalesce(
		nullif(current_setting('request.jwt.claim.sub', true), ''),
		(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
	)::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
	id text primary key, name text not null, public boolean default false,
	file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
	id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
	name text not null, owner uuid, metadata jsonb, unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare parts text[];
begin
	select string_to_array(name, '/') into parts;
	return parts[1:array_length(parts, 1) - 1];
end
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;

create publication supabase_realtime;
`;

/** Recording stand-ins for pg_net, pg_cron and Vault, for the schedule migration. */
const SCHEDULE_STAND_INS = `
create schema extensions;
create schema net;
create table net.calls (id serial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds int);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
	insert into net.calls (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id::bigint
$$;
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
	insert into cron.job values (job_name, schedule, command)
	on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
	returning 1::bigint
$$;
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
`;

async function build(schedule) {
	const db = new PGlite();
	await db.exec(PRELUDE);
	await db.exec(readFileSync(SCHEMA_MIGRATION, 'utf8'));
	if (schedule) {
		await db.exec(SCHEDULE_STAND_INS);
		// The extensions are what the stand-ins replace; everything else runs as written.
		const sql = readFileSync(SCHEDULE_MIGRATION, 'utf8').replace(/^create extension[^;]*;\n/gm, '');
		await db.exec(sql);
	}
	return db;
}

// Booting PGlite and applying the migrations takes seconds, so each variant is
// built once and every test gets its own clone of it.
const templates = new Map();
const open = new Set();

export async function supabaseDb({ schedule = false } = {}) {
	if (!templates.has(schedule)) templates.set(schedule, build(schedule));
	const db = await (await templates.get(schedule)).clone();
	open.add(db);
	return db;
}

/** Close every database this file opened; an open PGlite keeps the test process alive. */
export async function closeAll() {
	const all = [...open, ...(await Promise.all(templates.values()))];
	open.clear();
	templates.clear();
	await Promise.all(all.map((db) => db.close()));
}

export async function createUser(db, id, email = `${id.slice(0, 8)}@example.test`) {
	await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
	return id;
}

/** Run fn inside a transaction as a signed-in Supabase user (PostgREST's role + JWT claims). */
export function asUser(db, userId, fn) {
	return db.transaction(async (tx) => {
		await tx.exec('set local role authenticated');
		await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
		return fn(tx);
	});
}

/** Run fn as the anon role (a request with only the publishable key). */
export function asAnon(db, fn) {
	return db.transaction(async (tx) => {
		await tx.exec('set local role anon');
		return fn(tx);
	});
}

const PATCH_COLUMNS = new Set([
	'status', 'forge_job_id', 'backend', 'source_glb_url', 'storage_path', 'preview_image_url',
	'error_code', 'error', 'attempts', 'next_attempt_at', 'lease_until', 'submitted_at', 'completed_at',
]);

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

/** Timestamps as ISO strings, the way PostgREST hands rows to the Edge Function. */
function toRow(row) {
	return { ...row, created_at: iso(row.created_at), submitted_at: iso(row.submitted_at) };
}

/**
 * The sweep's Store over PGlite, as the service role. Uploads land in a local
 * directory and as a storage.objects row, so the bucket policies can be tested
 * against what the sweep wrote.
 */
export function pgliteStore(db, uploadDir) {
	mkdirSync(uploadDir, { recursive: true });
	return {
		async claim(maxRows, leaseSeconds) {
			const { rows } = await db.query('select * from public.three_ws_claim_models($1, $2)', [maxRows, leaseSeconds]);
			return rows.map(toRow);
		},
		async nextDueSeconds() {
			const { rows } = await db.query('select public.three_ws_next_due_seconds() as s');
			return rows[0].s === null ? null : Number(rows[0].s);
		},
		async update(id, patch) {
			const keys = Object.keys(patch);
			for (const key of keys) if (!PATCH_COLUMNS.has(key)) throw new Error(`unexpected column in patch: ${key}`);
			const sets = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
			await db.query(`update public.three_ws_models set ${sets} where id = $1`, [id, ...keys.map((k) => patch[k])]);
		},
		async upload(path, bytes) {
			const file = join(uploadDir, path);
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, bytes);
			await db.query(
				`insert into storage.objects (bucket_id, name, metadata) values ('three-ws-models', $1, $2)
				 on conflict (bucket_id, name) do update set metadata = excluded.metadata`,
				[path, JSON.stringify({ size: bytes.byteLength, mimetype: 'model/gltf-binary' })],
			);
		},
	};
}
