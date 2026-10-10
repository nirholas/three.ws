#!/usr/bin/env node
// Run every Event Markets resolver against a real, finished record in our own
// data and print the result and evidence. READ ONLY: it builds an in-memory market
// from the record and never writes. Usage:
//   node --env-file=.env.local scripts/event-markets-resolve-dry-run.mjs [kind ...]

import { sql } from '../api/_lib/db.js';
import { resolverFor, RESOLVER_KINDS } from '../api/_lib/event-markets/resolvers/index.js';

const want = process.argv.slice(2);
const kinds = want.length ? want : RESOLVER_KINDS;
const longAgo = new Date(Date.now() - 86_400_000).toISOString();

async function samples(kind) {
	if (kind === 'arena_tournament') {
		const rows = await sql`select id, status from tournaments where status in ('closed','settled','cancelled','ended') order by ends_at desc limit 3`;
		const out = [];
		for (const t of rows) {
			const entrants = await sql`select agent_id from tournament_entries where tournament_id = ${t.id} limit 8`.catch(() => []);
			out.push({ source_ref: t.id, outcomes: entrants.map((e) => ({ id: e.agent_id, ref_kind: 'agent', ref_id: e.agent_id })) });
		}
		return out;
	}
	if (kind === 'bounty') {
		const rows = await sql`select b.id, s.id as sid from bounties b join bounty_submissions s on s.bounty_id = b.id where b.status = 'closed' order by b.created_at desc limit 3`;
		return rows.map((r) => ({ source_ref: r.id, outcomes: [{ id: r.sid, ref_kind: 'project', ref_id: r.sid }] }));
	}
	if (kind === 'build_round') {
		const rows = await sql`select r.slug, s.id as sid, s.agent_id from program_rounds r join program_submissions s on s.round_id = r.id where r.status = 'closed' order by r.ends_at desc limit 3`;
		return rows.map((r) => ({ source_ref: r.slug, outcomes: [{ id: r.sid, ref_kind: 'project', ref_id: r.sid }] }));
	}
	if (kind === 'launch_cohort') {
		const rows = await sql`select mint, agent_id from pump_agent_mints where network = 'mainnet' order by created_at desc limit 4`;
		return [{ source_ref: 'recent', rule: { metric: 'volume', network: 'mainnet', window_from: '2020-01-01T00:00:00Z', measure_at: longAgo }, outcomes: rows.map((r) => ({ id: r.mint, ref_kind: 'project', ref_id: r.mint })) }];
	}
	return [{ source_ref: 'default', outcomes: [] }];
}

for (const kind of kinds) {
	const resolver = resolverFor(kind);
	if (!resolver) continue;
	console.log(`\n== ${kind}`);
	let list;
	try {
		list = await samples(kind);
	} catch (err) {
		console.log(`  could not list records: ${err.message}`);
		continue;
	}
	if (!list.length) console.log('  no finished record of this kind in the data yet');
	for (const s of list) {
		const market = { source_kind: kind, source_ref: s.source_ref, resolution_rule: s.rule || {}, resolves_at: longAgo, outcomes: s.outcomes.map((o) => ({ label: o.id, ...o })) };
		try {
			const result = await resolver.resolve(market, { now: Date.now() });
			console.log(' ', s.source_ref, JSON.stringify(result, null, 1).slice(0, 1400));
		} catch (err) {
			console.log(' ', s.source_ref, 'ERROR', err.message);
		}
	}
}
process.exit(0);
