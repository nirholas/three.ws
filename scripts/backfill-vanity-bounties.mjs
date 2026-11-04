#!/usr/bin/env node
/**
 * One-shot backfill: copy grind-bounty records from the legacy Redis hash
 * (vanity:bounty:rec) into Postgres (vanity_bounties). Run once after applying
 * migration 20261105120000_vanity_bounties.sql.
 *
 * DRY RUN BY DEFAULT: prints what it would insert and writes nothing. Pass
 * --apply to write. Idempotent: a bounty id already in Postgres is left alone
 * (Postgres is the source of truth), so re-running is a no-op.
 *
 *   node scripts/backfill-vanity-bounties.mjs            # dry run
 *   node scripts/backfill-vanity-bounties.mjs --apply
 *
 * Needs DATABASE_URL and the Upstash credentials the API uses (.env.local / .env
 * are loaded when a variable is unset).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const envFile of ['.env.local', '.env']) {
	try {
		for (const line of fs.readFileSync(path.resolve(ROOT, envFile), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/i);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
		}
		break;
	} catch {
		/* file not present */
	}
}

const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
	console.error('ERROR: DATABASE_URL is required.');
	process.exit(1);
}
const { getRedis } = await import('../api/_lib/redis.js');
const redis = getRedis();
if (!redis) {
	console.error('ERROR: Redis is not configured, so there is nothing to read.');
	process.exit(1);
}
const { sql } = await import('../api/_lib/db.js');

const all = (await redis.hgetall('vanity:bounty:rec')) || {};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
let seen = 0;
let inserted = 0;
let present = 0;
let skipped = 0;

for (const [id, raw] of Object.entries(all)) {
	seen += 1;
	let rec = raw;
	if (typeof raw === 'string') {
		try {
			rec = JSON.parse(raw);
		} catch {
			rec = null;
		}
	}
	if (!rec || typeof rec !== 'object' || !rec.status) {
		skipped += 1;
		console.warn(`skip ${id}: unreadable record`);
		continue;
	}
	const paid = rec.payoutTx && rec.winnerWorkerId && rec.amountAtomics;
	if (!APPLY) {
		const [exists] = await sql`select 1 as x from vanity_bounties where id = ${id}`;
		if (exists) present += 1;
		else inserted += 1;
		continue;
	}
	const rows = await sql`
		with ins as (
			insert into vanity_bounties (id, status, record, created_at, expires_at, amount_atomics,
				payout_tx, payout_worker_id, payout_amount_atomics, refund_tx)
			values (${id}, ${rec.status}, ${JSON.stringify(rec)}::jsonb, ${num(rec.createdAt)},
				${rec.expiresAt == null ? null : num(rec.expiresAt)}, ${num(rec.amountAtomics)},
				${rec.payoutTx || null}, ${paid ? String(rec.winnerWorkerId) : null}, ${paid ? num(rec.amountAtomics) : null},
				${rec.refundTx || null})
			on conflict (id) do nothing
			returning id
		)
		insert into vanity_bounty_events (bounty_id, kind, at, data)
		select id, 'backfilled', ${Date.now()}, jsonb_build_object('status', ${rec.status}::text) from ins
		returning bounty_id`;
	if (rows.length) inserted += 1;
	else present += 1;
}

console.log(
	`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${seen} Redis records, ${inserted} ${APPLY ? 'inserted' : 'would be inserted'}, ${present} already in Postgres, ${skipped} unreadable.`,
);
if (!APPLY) console.log('Re-run with --apply to write.');
