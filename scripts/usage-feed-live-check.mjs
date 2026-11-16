#!/usr/bin/env node
// Live check of the OData usage feed and its Settings panel, on real usage
// data, without touching the production database.
//
//   node scripts/usage-feed-live-check.mjs [--port 3146] [--origin http://localhost:3145]
//
// What it does:
//   1. Reads (SELECT only) the last 30 days of usage_events and forge_creations
//      of the production accounts with the most MCP tool calls, LLM calls and
//      Forge generations, from the database DATABASE_URL in .env.local points
//      at. Nothing is written there.
//   2. Builds a throwaway in-process Postgres with the production schema
//      (scripts/lib/isolated-db.mjs) and copies those rows under two fresh
//      verification accounts, so no real email or name leaves production. The
//      first account owns a team; the second is an active person of it.
//   3. Starts the real Cloud Run server (server/index.mjs) on --port against
//      that database, and prints a session cookie for the team owner.
//
// Pair it with the Vite dev server for the Settings UI:
//   DEV_API_PROXY=http://localhost:3146 npx vite --port 3145 --strictPort
// then set the printed cookie on localhost:3145 and open
// /dashboard/settings#usage-feed. --origin is the origin feed URLs and
// @odata.nextLink point at (PUBLIC_APP_ORIGIN).
//
// Side channels are dropped from this process (Redis, so rate limits run in
// memory; email; push), and JWT_SECRET is random per run.

import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { neon } from '@neondatabase/serverless';

loadEnv({ path: '.env.local', override: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const PORT = Number(flag('--port', 3146));
const ORIGIN = flag('--origin', 'http://localhost:3145');
const DAYS = 30;
const MAX_EVENTS = 5000;

const say = (...lines) => process.stdout.write(`${lines.join('\n')}\n`);

// The source account for each verification person: the production account
// with the most rows of the kind that person demonstrates.
async function topUser(prod, query) {
	const [row] = await prod.query(query, [DAYS]);
	if (!row?.user_id) throw new Error('production has no account with usage of this kind in the window');
	return row.user_id;
}

async function readProduction() {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in .env.local; it is needed to read real usage rows');
	const prod = neon(process.env.DATABASE_URL);
	const byKind = (kind) => `select user_id from usage_events where kind = '${kind}' and user_id is not null
		and created_at > now() - make_interval(days => $1) group by user_id order by count(*) desc limit 1`;
	const toolUser = await topUser(prod, byKind('tool_call'));
	const llmUser = await topUser(prod, byKind('llm'));
	const forgeUser = await topUser(prod, `select user_id from forge_creations where user_id is not null and internal is not true
		and created_at > now() - make_interval(days => $1) group by user_id order by count(*) desc limit 1`);
	const events = (userId) => prod.query(
		`select kind, tool, status, bytes, latency_ms, client_id, provider, model, input_tokens, output_tokens,
			cost_micro_usd, meter_action, units, price_usdc_atomics, settlement_kind, created_at
		 from usage_events where user_id = $1 and created_at > now() - make_interval(days => $2)
		 order by created_at desc limit $3`,
		[userId, DAYS, MAX_EVENTS],
	);
	const creations = (userId) => prod.query(
		`select tier, path, backend, status, outcome, size_bytes, created_at, completed_at
		 from forge_creations where user_id = $1 and internal is not true
		 and created_at > now() - make_interval(days => $2) order by created_at desc limit 500`,
		[userId, DAYS],
	);
	return [
		{ events: await events(toolUser), creations: await creations(forgeUser) },
		{ events: llmUser === toolUser ? [] : await events(llmUser), creations: forgeUser === llmUser ? [] : await creations(llmUser) },
	];
}

async function load(sql, data) {
	const people = [
		{ id: randomUUID(), email: `usage-feed-owner-${Date.now()}@qa.three.ws`, name: 'Feed check owner' },
		{ id: randomUUID(), email: `usage-feed-member-${Date.now()}@qa.three.ws`, name: 'Feed check member' },
	];
	for (const p of people) await sql`insert into users (id, email, display_name) values (${p.id}, ${p.email}, ${p.name})`;
	const teamId = randomUUID();
	await sql`insert into teams (id, owner_user_id, name, status) values (${teamId}, ${people[0].id}, 'Analytics', 'active')`;
	await sql`insert into team_people (team_id, user_id, source, status) values (${teamId}, ${people[1].id}, 'tenant_join', 'active')`;

	for (let i = 0; i < people.length; i++) {
		const userId = people[i].id;
		for (const e of data[i].events) {
			await sql`insert into usage_events (user_id, kind, tool, status, bytes, latency_ms, client_id, provider, model,
				input_tokens, output_tokens, cost_micro_usd, meter_action, units, price_usdc_atomics, settlement_kind, created_at)
				values (${userId}, ${e.kind}, ${e.tool}, ${e.status}, ${e.bytes}, ${e.latency_ms}, ${e.client_id}, ${e.provider}, ${e.model},
				${e.input_tokens}, ${e.output_tokens}, ${e.cost_micro_usd}, ${e.meter_action}, ${e.units}, ${e.price_usdc_atomics},
				${e.settlement_kind}, ${e.created_at})`;
		}
		for (const c of data[i].creations) {
			await sql`insert into forge_creations (id, client_key, prompt, user_id, tier, path, backend, status, outcome, size_bytes, created_at, completed_at)
				values (${randomUUID()}, 'live-check', 'copied for the usage feed live check', ${userId}, ${c.tier}, ${c.path}, ${c.backend},
				${c.status}, ${c.outcome}, ${c.size_bytes}, ${c.created_at}, ${c.completed_at})`;
		}
	}
	return { people, teamId };
}

const data = await readProduction();
say(`read ${data[0].events.length} + ${data[1].events.length} usage events and ${data[0].creations.length} + ${data[1].creations.length} generations from production (select only)`);

for (const k of Object.keys(process.env)) {
	if (/^(UPSTASH_|REDIS_|KV_|RESEND_|SENDGRID_|SMTP_|VAPID_|WEB_PUSH)/.test(k)) delete process.env[k];
}
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.PORT = String(PORT);
process.env.PUBLIC_APP_ORIGIN = ORIGIN;
process.env.APP_ORIGIN = ORIGIN;

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const { sql } = await useIsolatedDb();
const { people, teamId } = await load(sql, data);
const { createSession } = await import('../api/_lib/auth.js');
const cookie = await createSession({ userId: people[0].id, userAgent: 'usage-feed-live-check', recordActivity: false });

await import('../server/index.mjs');
say(
	'',
	`team ${teamId} owned by ${people[0].email}, with ${people[1].email} as an active person`,
	`server on http://localhost:${PORT}; feed URL ${ORIGIN}/api/odata/v1/`,
	`session cookie for the owner: __Host-sid=${cookie}`,
);
