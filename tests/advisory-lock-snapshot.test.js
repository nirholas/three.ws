// Regression: a rolling-cap reservation must take its advisory lock in a
// SEPARATE statement ahead of the INSERT...SELECT that sums the window.
//
// Under READ COMMITTED a statement's snapshot is fixed when it starts, so a
// `WITH locked AS (SELECT pg_advisory_xact_lock(..)) ... INSERT ... SELECT sum()`
// single statement lets a request that waited on the lock read the pre-commit
// snapshot and miss the winner's reservation: two concurrent spends both pass
// the daily cap. Fixed by api/_lib/locked-sql.js (lock statement, then the
// reservation, inside one transaction).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const state = { txs: [], singles: [] };
vi.mock('../api/_lib/db.js', () => {
	const sql = vi.fn((strings, ...values) => {
		const text = strings.join('?');
		state.singles.push(text);
		return { __q: text, values };
	});
	sql.transaction = vi.fn(async (queries) => {
		state.txs.push(queries.map((q) => q.__q));
		return queries.map((q, i) => (i === queries.length - 1 ? [{ id: 'r1' }] : []));
	});
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

beforeEach(() => {
	state.txs = [];
	state.singles = [];
});

describe('reserveSpend lock ordering', () => {
	it('locks in its own statement before the reservation insert, in one transaction', async () => {
		const { reserveSpend } = await import('../api/_lib/agent-spend-policy.js');
		const r = await reserveSpend({
			agentId: 'agent-1',
			meta: { spend_policy: { daily_sol_cap: 5 } },
			mint: null,
			solAmount: 1,
			type: 'pumpfun.buy',
		});
		expect(r.ok).toBe(true);
		expect(state.txs).toHaveLength(1);
		const [lock, insert] = state.txs[0];
		expect(lock).toMatch(/pg_advisory_xact_lock/);
		expect(lock).not.toMatch(/insert/i);
		expect(insert).toMatch(/INSERT INTO agent_actions/);
		expect(insert).not.toMatch(/pg_advisory_xact_lock/);
	});
});

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (p.endsWith('.js')) out.push(p);
	}
	return out;
}

describe('no single statement mixes an advisory lock with a windowed-sum INSERT', () => {
	it('api/ has none', () => {
		const offenders = [];
		for (const file of walk('api')) {
			const src = readFileSync(file, 'utf8');
			if (!src.includes('pg_advisory_xact_lock')) continue;
			for (const m of src.matchAll(/sql`([^`]*)`/g)) {
				const t = m[1];
				if (/pg_advisory_xact_lock/.test(t) && /insert\s+into/i.test(t) && /sum\s*\(/i.test(t)) {
					offenders.push(file);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
