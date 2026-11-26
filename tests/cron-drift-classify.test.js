// Tests for how `scripts/check-cron-drift.mjs` explains a MISSING Cloud
// Scheduler job.
//
// "MISSING" has two causes that look identical in the report and need opposite
// actions, and picking the wrong one is expensive both ways: syncing a cron
// whose handler is not in the running revision schedules a 404 every run, while
// waiting for a deploy that a live handler does not need leaves a declared cron
// that has never fired once (that is exactly how /api/cron/retention-rollup and
// /api/cron/likeness-eval sat unscheduled on 2026-08-14). The classifier reads
// production's own answer on the cron path instead of guessing.

import { describe, it, expect } from 'vitest';
import { classifyMissing, compareToLive } from '../scripts/check-cron-drift.mjs';
import { TICK_JOB_ID } from '../scripts/create-gcp-scheduler.mjs';

describe('classifyMissing', () => {
	it('calls a 404 an undeployed handler, whose job belongs to the next deploy', () => {
		expect(classifyMissing(404)).toBe('handler not deployed');
	});

	it('treats every answering status as live, so the sync is the only thing missing', () => {
		// 401 is a real CRON_SECRET rejecting an unauthenticated probe and 503 is
		// the gate failing closed with the secret unset. Both prove the handler is
		// in the running revision, which is the only question being asked.
		expect(classifyMissing(401)).toBe('deployed, never synced');
		expect(classifyMissing(503)).toBe('deployed, never synced');
		expect(classifyMissing(200)).toBe('deployed, never synced');
		expect(classifyMissing(500)).toBe('deployed, never synced');
	});

	it('stays silent when the probe never answered rather than inventing a cause', () => {
		expect(classifyMissing(null)).toBe(null);
		expect(classifyMissing(undefined)).toBe(null);
	});
});

describe('compareToLive', () => {
	const declared = [
		{ path: '/api/cron/a', id: 'cron--api-cron-a', schedule: '*/5 * * * *' },
		{ path: '/api/cron/b', id: 'cron--api-cron-b', schedule: '0 * * * *' },
	];

	it('per-cron mode: reports missing, mismatched, paused and orphaned jobs', () => {
		const live = new Map([
			['cron--api-cron-a', { schedule: '*/10 * * * *', state: 'PAUSED' }],
			['cron--api-cron-gone', { schedule: '* * * * *', state: 'ENABLED' }],
		]);
		const out = compareToLive(declared, live);
		expect(out.mode).toBe('per-job');
		expect(out.missing.map((m) => m.path)).toEqual(['/api/cron/b']);
		expect(out.mismatched.map((m) => m.path)).toEqual(['/api/cron/a']);
		expect(out.paused.map((m) => m.path)).toEqual(['/api/cron/a']);
		expect(out.orphaned.map((m) => m.id)).toEqual(['cron--api-cron-gone']);
	});

	it('tick mode: one enabled every-minute tick covers every declared cron', () => {
		const live = new Map([[TICK_JOB_ID, { schedule: '* * * * *', state: 'ENABLED' }]]);
		const out = compareToLive(declared, live);
		expect(out).toMatchObject({ mode: 'tick', missing: [], mismatched: [], paused: [], doubleFire: [] });
	});

	it('tick mode: a paused tick stops every cron', () => {
		const live = new Map([[TICK_JOB_ID, { schedule: '* * * * *', state: 'PAUSED' }]]);
		expect(compareToLive(declared, live).paused.map((p) => p.path)).toEqual(['/api/cron/a', '/api/cron/b']);
	});

	it('tick mode: flags enabled per-cron jobs as double fire, but not paused ones', () => {
		const live = new Map([
			[TICK_JOB_ID, { schedule: '* * * * *', state: 'ENABLED' }],
			['cron--api-cron-a', { schedule: '*/5 * * * *', state: 'ENABLED' }],
			['cron--api-cron-b', { schedule: '0 * * * *', state: 'PAUSED' }],
		]);
		expect(compareToLive(declared, live).doubleFire.map((d) => d.id)).toEqual(['cron--api-cron-a']);
	});

	it('tick mode: a tick on any schedule but every minute is a mismatch', () => {
		const live = new Map([[TICK_JOB_ID, { schedule: '*/5 * * * *', state: 'ENABLED' }]]);
		expect(compareToLive(declared, live).mismatched.map((m) => m.id)).toEqual([TICK_JOB_ID]);
	});
});
