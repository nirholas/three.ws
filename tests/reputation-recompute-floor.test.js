/**
 * recompute-reputation re-scores an agent only once its stored score is old.
 *
 * Measured 2026-11-13: the cron scored 40 agents every 10 minutes (5,760 scores a
 * day) over 1,068 agents with a wallet, so every agent was re-scored about every
 * 4.4 hours, and each score cost about 11 Solana provider calls (43,283
 * getTokenAccountsByOwner plus 19,144 getBalance in 24h). A viewed agent already
 * refreshes its durable score on view, so the cron only needs to keep idle agents
 * from going stale. listStaleAgents now skips a current-version score younger
 * than REPUTATION_RECOMPUTE_MIN_AGE_H (default 12), while never-scored and
 * old-version agents stay eligible at once.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queries = vi.hoisted(() => []);
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		queries.push({ text: strings.join('$'), values });
		return [];
	}),
	isDbUnavailableError: () => false,
}));

const { listStaleAgents, recomputeMinAgeHours } = await import('../api/_lib/trust/reputation-store.js');

const staleQuery = () => queries.find((q) => /from agent_identities/.test(q.text));

describe('recompute age floor', () => {
	const orig = process.env.REPUTATION_RECOMPUTE_MIN_AGE_H;
	beforeEach(() => {
		queries.length = 0;
		delete process.env.REPUTATION_RECOMPUTE_MIN_AGE_H;
	});
	afterEach(() => {
		if (orig === undefined) delete process.env.REPUTATION_RECOMPUTE_MIN_AGE_H;
		else process.env.REPUTATION_RECOMPUTE_MIN_AGE_H = orig;
	});

	it('defaults to 12 hours and reads the env override, ignoring junk', () => {
		expect(recomputeMinAgeHours()).toBe(12);
		process.env.REPUTATION_RECOMPUTE_MIN_AGE_H = '6';
		expect(recomputeMinAgeHours()).toBe(6);
		process.env.REPUTATION_RECOMPUTE_MIN_AGE_H = '-1';
		expect(recomputeMinAgeHours()).toBe(12);
		process.env.REPUTATION_RECOMPUTE_MIN_AGE_H = 'soon';
		expect(recomputeMinAgeHours()).toBe(12);
	});

	it('filters out fresh current-version scores in the query itself', async () => {
		await listStaleAgents(40);
		const q = staleQuery();
		expect(q).toBeTruthy();
		const where = q.text.split(/order by/i)[0];
		expect(where).toMatch(/r\.agent_id is null/);
		expect(where).toMatch(/r\.version is distinct from/);
		expect(where).toMatch(/r\.computed_at\s*<\s*now\(\)\s*-\s*make_interval\(hours\s*=>/);
		expect(q.values).toContain(12);
	});

	it('passes the configured floor to the query', async () => {
		process.env.REPUTATION_RECOMPUTE_MIN_AGE_H = '3';
		await listStaleAgents(40);
		expect(staleQuery().values).toContain(3);
	});
});
