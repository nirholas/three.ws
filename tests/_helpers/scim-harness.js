// Shared harness for the SCIM suites (tests/scim.test.js,
// tests/scim-entra-conformance.test.js): the tables the teams and enterprise
// migrations reference but do not create, the migrations themselves, a fixture
// reset, and an in-process HTTP invoker for the real handlers.
//
// The vi.mock calls stay in each test file (vitest hoists them per file); this
// module only holds what is identical between the suites.

import { readFileSync } from 'node:fs';

export const PRE_DDL = `
	create table users (
		id uuid primary key default gen_random_uuid(), email text unique, email_verified boolean not null default false,
		display_name text, password_hash text, deleted_at timestamptz
	);
	create table avatars (id uuid primary key default gen_random_uuid(), storage_key text, thumbnail_key text, deleted_at timestamptz);
	create table agent_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid, name text, description text,
		avatar_id uuid, meta jsonb default '{}'::jsonb, deleted_at timestamptz
	);
	create table sessions (
		id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
		created_at timestamptz not null default now(), revoked_at timestamptz
	);
	create table user_identities (
		id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
		provider text not null, subject text not null, email text, email_verified boolean not null default false,
		display_name text, avatar_url text, linked_at timestamptz not null default now(), last_used_at timestamptz
	);
	create table audit_log (
		id bigserial primary key, user_id uuid, action text, resource_id text, meta jsonb, ip text, user_agent text,
		created_at timestamptz not null default now()
	);
`;

const MIGRATIONS = ['20261010120000_teams.sql', '20261111160232_enterprise_sso_scim.sql', '20261116150441_account_mfa.sql', '20261116160500_scim_oauth_clients.sql'];

/** Create the schema the SCIM code runs against on a fresh PGlite wrapper. */
export async function buildScimSchema(db) {
	await db.exec(PRE_DDL);
	for (const file of MIGRATIONS) {
		await db.exec(readFileSync(new URL(`../../api/_lib/migrations/${file}`, import.meta.url), 'utf8'));
	}
}

/** Empty every table the suites write to, children first. */
export async function resetScimTables(db) {
	await db.exec(`
		delete from team_enterprise_events; delete from team_scim_group_members; delete from team_scim_groups;
		delete from team_scim_access_tokens; delete from team_scim_clients;
		delete from team_scim_tokens; delete from team_people; delete from team_tenant_claims;
		delete from team_findings; delete from team_members; delete from teams;
		delete from sessions; delete from user_identities; delete from users;
	`);
}

/** Drive a handler with a minimal Node-style req/res and collect the answer. */
export function invoke(handler, { method = 'GET', url, body, headers = {}, query = {} }) {
	return new Promise((resolve, reject) => {
		const out = { status: 200, headers: {}, body: '' };
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
			getHeader(k) { return out.headers[k.toLowerCase()]; },
			removeHeader(k) { delete out.headers[k.toLowerCase()]; },
			writeHead(s, h) { this.statusCode = s; for (const [k, v] of Object.entries(h || {})) out.headers[k.toLowerCase()] = v; return this; },
			write(chunk) { out.body += chunk; },
			end(chunk) {
				if (chunk) out.body += chunk;
				out.status = this.statusCode;
				try { out.json = out.body ? JSON.parse(out.body) : null; } catch { out.json = null; }
				resolve(out);
			},
		};
		const req = {
			method,
			url,
			query,
			headers: { host: 'localhost', 'content-type': 'application/scim+json', ...headers },
			body,
		};
		Promise.resolve(handler(req, res)).catch(reject);
	});
}
